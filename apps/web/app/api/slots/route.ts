import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import prisma from "@calcom/prisma";

/**
 * GET /api/slots?eventTypeId=...&startTime=...&endTime=...
 * Returns available time slots, excluding any override-blocked periods.
 */
async function getHandler(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const eventTypeIdParam = searchParams.get("eventTypeId");
    const startTime = searchParams.get("startTime");
    const endTime = searchParams.get("endTime");
    const timeZone = searchParams.get("timeZone") || "UTC";

    if (!startTime || !endTime) {
      return NextResponse.json({ message: "Missing startTime or endTime" }, { status: 400 });
    }

    // Resolve event type - could be numeric ID or slug
    let eventType;
    if (eventTypeIdParam) {
      if (!isNaN(Number(eventTypeIdParam))) {
        eventType = await prisma.eventType.findUnique({
          where: { id: Number(eventTypeIdParam) },
          select: {
            id: true,
            slug: true,
            title: true,
            length: true,
            slotInterval: true,
            userId: true,
            teamId: true,
            users: { select: { id: true, username: true, timeZone: true, defaultScheduleId: true } },
            schedule: { include: { availability: true } },
          },
        });
      } else {
        // Try slug match
        eventType = await prisma.eventType.findFirst({
          where: { slug: eventTypeIdParam },
          select: {
            id: true,
            slug: true,
            title: true,
            length: true,
            slotInterval: true,
            userId: true,
            teamId: true,
            users: { select: { id: true, username: true, timeZone: true, defaultScheduleId: true } },
            schedule: { include: { availability: true } },
          },
        });
      }
    }

    if (!eventType) {
      return NextResponse.json({ message: "Event type not found" }, { status: 404 });
    }

    // Get the primary user for this event type
    const userId = eventType.userId || eventType.users?.[0]?.id;
    if (!userId) {
      return NextResponse.json({ message: "No user associated with event type" }, { status: 404 });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, timeZone: true, defaultScheduleId: true },
    });

    if (!user) {
      return NextResponse.json({ message: "User not found" }, { status: 404 });
    }

    // Get the schedule for this event type or user's default
    const scheduleId = eventType.schedule?.id || user.defaultScheduleId;
    let schedule;
    if (scheduleId) {
      schedule = await prisma.schedule.findUnique({
        where: { id: scheduleId },
        include: { availability: true },
      });
    }
    if (!schedule) {
      // Fall back to user's first schedule
      schedule = await prisma.schedule.findFirst({
        where: { userId: user.id },
        include: { availability: true },
      });
    }

    if (!schedule) {
      return NextResponse.json({ slots: {} });
    }

    // Get availability overrides for the date range
    const overrides = await prisma.$queryRawUnsafe<
      Array<{
        id: number;
        date: Date;
        type: string;
        startTime: string;
        endTime: string;
      }>
    >(
      `SELECT "id", "date", "type", "startTime", "endTime"
       FROM "AvailabilityOverride"
       WHERE "userId" = $1 AND "date" >= $2::date AND "date" <= $3::date`,
      user.id,
      startTime.split("T")[0],
      endTime.split("T")[0]
    );

    // Build override lookup by date
    const overridesByDate = new Map<
      string,
      Array<{ type: string; startTime: string; endTime: string }>
    >();
    for (const o of overrides) {
      const dateStr =
        typeof o.date === "object" ? o.date.toISOString().split("T")[0] : String(o.date);
      if (!overridesByDate.has(dateStr)) {
        overridesByDate.set(dateStr, []);
      }
      overridesByDate.get(dateStr)!.push({
        type: o.type,
        startTime: o.startTime,
        endTime: o.endTime,
      });
    }

    // Get working hours from schedule
    const workingHours = schedule.availability
      .filter((a) => a.days.length > 0 && !a.date)
      .map((a) => ({
        days: a.days,
        startTime: formatTime(a.startTime),
        endTime: formatTime(a.endTime),
      }));

    // Generate slots for the requested date range
    const eventLength = eventType.length || 30;
    const slotInterval = eventType.slotInterval || eventLength;
    const requestedStartTime = new Date(startTime);
    const requestedEndTime = new Date(endTime);
    const userTimezone = user.timeZone || "UTC";

    const slots: Record<string, Array<{ time: string }>> = {};

    // Iterate through each day in the range
    const currentDate = new Date(requestedStartTime);
    currentDate.setUTCHours(0, 0, 0, 0);

    const lastDate = new Date(requestedEndTime);
    lastDate.setUTCHours(23, 59, 59, 999);

    while (currentDate <= lastDate) {
      const dateStr = currentDate.toISOString().split("T")[0];
      const dayOfWeek = currentDate.getUTCDay(); // 0 = Sunday

      // Find applicable working hours for this day
      const applicableHours = workingHours.filter((wh) => wh.days.includes(dayOfWeek));

      if (applicableHours.length > 0) {
        const daySlots: Array<{ time: string }> = [];

        for (const wh of applicableHours) {
          const [startH, startM] = wh.startTime.split(":").map(Number);
          const [endH, endM] = wh.endTime.split(":").map(Number);

          let slotTime = new Date(currentDate);
          slotTime.setUTCHours(startH, startM, 0, 0);

          const endOfWorkingHours = new Date(currentDate);
          endOfWorkingHours.setUTCHours(endH, endM, 0, 0);

          while (slotTime.getTime() + eventLength * 60 * 1000 <= endOfWorkingHours.getTime()) {
            const slotTimeStr = slotTime.toISOString();
            const slotHH = slotTime.getUTCHours().toString().padStart(2, "0");
            const slotMM = slotTime.getUTCMinutes().toString().padStart(2, "0");
            const slotTimeFormatted = `${slotHH}:${slotMM}`;

            // Check if this slot falls within a blocked override
            let isBlocked = false;
            const dateOverrides = overridesByDate.get(dateStr) || [];
            for (const override of dateOverrides) {
              if (override.type === "block") {
                // Check if slot overlaps with the blocked period
                if (slotTimeFormatted >= override.startTime && slotTimeFormatted < override.endTime) {
                  isBlocked = true;
                  break;
                }
                // Also check if slot end time overlaps
                const slotEndTime = new Date(slotTime.getTime() + eventLength * 60 * 1000);
                const slotEndHH = slotEndTime.getUTCHours().toString().padStart(2, "0");
                const slotEndMM = slotEndTime.getUTCMinutes().toString().padStart(2, "0");
                const slotEndFormatted = `${slotEndHH}:${slotEndMM}`;
                if (slotTimeFormatted < override.endTime && slotEndFormatted > override.startTime) {
                  isBlocked = true;
                  break;
                }
              }
            }

            if (!isBlocked) {
              daySlots.push({ time: slotTimeStr });
            }

            slotTime = new Date(slotTime.getTime() + slotInterval * 60 * 1000);
          }
        }

        if (daySlots.length > 0) {
          slots[dateStr] = daySlots;
        }
      }

      currentDate.setUTCDate(currentDate.getUTCDate() + 1);
    }

    return NextResponse.json({ slots });
  } catch (error) {
    console.error("Error fetching slots:", error);
    return NextResponse.json(
      { message: "Internal server error", error: String(error) },
      { status: 500 }
    );
  }
}

function formatTime(dateTime: Date | string): string {
  if (typeof dateTime === "string") return dateTime;
  const hours = dateTime.getUTCHours().toString().padStart(2, "0");
  const minutes = dateTime.getUTCMinutes().toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

export const GET = getHandler;
