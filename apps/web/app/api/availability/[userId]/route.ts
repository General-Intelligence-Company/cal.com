import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import prisma from "@calcom/prisma";

/**
 * GET /api/availability/:userId?dateFrom=...&dateTo=...
 * Returns availability for a user, reflecting any overrides for specific dates.
 */
async function getHandler(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const { userId } = await params;
    const { searchParams } = new URL(req.url);
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");

    // Look up user by username or numeric ID
    let user;
    if (!isNaN(Number(userId))) {
      user = await prisma.user.findUnique({
        where: { id: Number(userId) },
        select: {
          id: true,
          username: true,
          timeZone: true,
          defaultScheduleId: true,
        },
      });
    } else {
      user = await prisma.user.findFirst({
        where: { username: userId },
        select: {
          id: true,
          username: true,
          timeZone: true,
          defaultScheduleId: true,
        },
      });
    }

    if (!user) {
      return NextResponse.json({ message: "User not found" }, { status: 404 });
    }

    // Get the user's schedule and availability
    const schedules = await prisma.schedule.findMany({
      where: { userId: user.id },
      include: {
        availability: true,
      },
    });

    // Get the default schedule
    const defaultSchedule = user.defaultScheduleId
      ? schedules.find((s) => s.id === user.defaultScheduleId)
      : schedules[0];

    // Build working hours from the schedule's availability entries
    const workingHours = defaultSchedule
      ? defaultSchedule.availability
          .filter((a) => a.days.length > 0 && !a.date)
          .map((a) => ({
            days: a.days,
            startTime: a.startTime,
            endTime: a.endTime,
          }))
      : [];

    // Get date overrides from the existing schedule
    const dateOverrides = defaultSchedule
      ? defaultSchedule.availability
          .filter((a) => a.date !== null)
          .map((a) => ({
            date: a.date,
            startTime: a.startTime,
            endTime: a.endTime,
          }))
      : [];

    // Now get our custom availability overrides for the date range
    let overrides: Array<{
      id: number;
      date: Date;
      type: string;
      startTime: string;
      endTime: string;
      reason: string | null;
    }> = [];

    if (dateFrom && dateTo) {
      overrides = await prisma.$queryRawUnsafe<typeof overrides>(
        `SELECT "id", "date", "type", "startTime", "endTime", "reason"
         FROM "AvailabilityOverride"
         WHERE "userId" = $1 AND "date" >= $2::date AND "date" <= $3::date
         ORDER BY "date" ASC`,
        user.id,
        dateFrom,
        dateTo
      );
    } else {
      overrides = await prisma.$queryRawUnsafe<typeof overrides>(
        `SELECT "id", "date", "type", "startTime", "endTime", "reason"
         FROM "AvailabilityOverride"
         WHERE "userId" = $1
         ORDER BY "date" ASC`,
        user.id
      );
    }

    // Build date ranges for the requested period
    const dateRanges: Array<{
      date: string;
      startTime: string;
      endTime: string;
      status?: string;
      override?: boolean;
    }> = [];

    if (dateFrom && dateTo) {
      const start = new Date(dateFrom);
      const end = new Date(dateTo);

      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split("T")[0];
        const dayOfWeek = d.getDay(); // 0 = Sunday

        // Check if there's an override for this date
        const dateOverride = overrides.find((o) => {
          const overrideDate =
            typeof o.date === "object" ? o.date.toISOString().split("T")[0] : String(o.date);
          return overrideDate === dateStr;
        });

        if (dateOverride) {
          if (dateOverride.type === "block") {
            // This is a blocked period - mark as blocked/unavailable/override
            dateRanges.push({
              date: dateStr,
              startTime: dateOverride.startTime,
              endTime: dateOverride.endTime,
              status: "blocked",
              override: true,
            });

            // Also include the remaining available time if it's a working day
            const hasWorkingHours = workingHours.some((wh) => wh.days.includes(dayOfWeek));
            if (hasWorkingHours) {
              for (const wh of workingHours) {
                if (!wh.days.includes(dayOfWeek)) continue;
                const whStart = formatTime(wh.startTime);
                const whEnd = formatTime(wh.endTime);

                // Add time before the block
                if (whStart < dateOverride.startTime) {
                  dateRanges.push({
                    date: dateStr,
                    startTime: whStart,
                    endTime: dateOverride.startTime,
                  });
                }
                // Add time after the block
                if (whEnd > dateOverride.endTime) {
                  dateRanges.push({
                    date: dateStr,
                    startTime: dateOverride.endTime,
                    endTime: whEnd,
                  });
                }
              }
            }
          } else {
            // This is a custom override (replacement availability)
            dateRanges.push({
              date: dateStr,
              startTime: dateOverride.startTime,
              endTime: dateOverride.endTime,
              status: "override",
              override: true,
            });
          }
        } else {
          // Normal working hours
          for (const wh of workingHours) {
            if (wh.days.includes(dayOfWeek)) {
              dateRanges.push({
                date: dateStr,
                startTime: formatTime(wh.startTime),
                endTime: formatTime(wh.endTime),
              });
            }
          }
        }
      }
    }

    return NextResponse.json({
      userId: user.id,
      username: user.username,
      timeZone: user.timeZone,
      schedule: {
        id: defaultSchedule?.id,
        name: defaultSchedule?.name,
        workingHours,
      },
      dateRanges,
      overrides: overrides.map((o) => ({
        id: o.id,
        date: typeof o.date === "object" ? o.date.toISOString().split("T")[0] : o.date,
        type: o.type,
        startTime: o.startTime,
        endTime: o.endTime,
        reason: o.reason,
        status: o.type === "block" ? "blocked" : "override",
      })),
    });
  } catch (error) {
    console.error("Error fetching user availability:", error);
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
