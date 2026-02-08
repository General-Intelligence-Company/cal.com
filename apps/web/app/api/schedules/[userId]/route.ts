import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import prisma from "@calcom/prisma";

/**
 * GET /api/schedules/:userId
 * Returns the user's schedule and availability (unchanged by overrides).
 * This endpoint returns the base recurring schedule without any overrides applied.
 */
async function getHandler(_req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const { userId } = await params;

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

    // Get all schedules with their base availability (NOT overrides)
    const schedules = await prisma.schedule.findMany({
      where: { userId: user.id },
      include: {
        availability: true,
      },
      orderBy: { id: "asc" },
    });

    const formattedSchedules = schedules.map((schedule) => {
      const workingHours = schedule.availability
        .filter((a) => a.days.length > 0 && !a.date)
        .map((a) => ({
          days: a.days,
          startTime: formatTime(a.startTime),
          endTime: formatTime(a.endTime),
        }));

      const dateOverrides = schedule.availability
        .filter((a) => a.date !== null)
        .map((a) => ({
          date: a.date ? a.date.toISOString().split("T")[0] : null,
          startTime: formatTime(a.startTime),
          endTime: formatTime(a.endTime),
        }));

      return {
        id: schedule.id,
        name: schedule.name,
        timeZone: schedule.timeZone,
        isDefault: schedule.id === user!.defaultScheduleId,
        availability: schedule.availability.map((a) => ({
          id: a.id,
          days: a.days,
          startTime: formatTime(a.startTime),
          endTime: formatTime(a.endTime),
          date: a.date ? a.date.toISOString().split("T")[0] : null,
        })),
        workingHours,
        dateOverrides,
      };
    });

    return NextResponse.json({
      userId: user.id,
      username: user.username,
      timeZone: user.timeZone,
      defaultScheduleId: user.defaultScheduleId,
      schedules: formattedSchedules,
    });
  } catch (error) {
    console.error("Error fetching user schedules:", error);
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
