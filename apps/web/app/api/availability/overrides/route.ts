import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import prisma from "@calcom/prisma";

/**
 * POST /api/availability/overrides
 * Create a new availability override for a specific date.
 */
async function postHandler(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId, scheduleId, date, type, startTime, endTime, reason } = body;

    if (!userId || !date || !startTime || !endTime) {
      return NextResponse.json(
        { message: "Missing required fields: userId, date, startTime, endTime" },
        { status: 400 }
      );
    }

    const overrideType = type || "block";

    // Look up user by string ID or numeric ID
    let numericUserId: number;
    if (typeof userId === "number") {
      numericUserId = userId;
    } else {
      // Try to find user by username first
      const user = await prisma.user.findFirst({
        where: {
          OR: [
            { username: String(userId) },
            ...(isNaN(Number(userId)) ? [] : [{ id: Number(userId) }]),
          ],
        },
        select: { id: true },
      });
      if (!user) {
        return NextResponse.json({ message: "User not found" }, { status: 404 });
      }
      numericUserId = user.id;
    }

    // Use raw query to insert the override (works without regenerated Prisma client)
    const result = await prisma.$queryRawUnsafe<
      Array<{
        id: number;
        userId: number;
        scheduleId: number | null;
        date: Date;
        type: string;
        startTime: string;
        endTime: string;
        reason: string | null;
        createdAt: Date;
        updatedAt: Date;
      }>
    >(
      `INSERT INTO "AvailabilityOverride" ("userId", "scheduleId", "date", "type", "startTime", "endTime", "reason", "createdAt", "updatedAt")
       VALUES ($1, $2, $3::date, $4, $5, $6, $7, NOW(), NOW())
       RETURNING *`,
      numericUserId,
      scheduleId ? Number(scheduleId) : null,
      date,
      overrideType,
      startTime,
      endTime,
      reason || null
    );

    const override = result[0];

    return NextResponse.json(
      {
        id: override.id,
        userId: override.userId,
        scheduleId: override.scheduleId,
        date: typeof override.date === "object" ? override.date.toISOString().split("T")[0] : override.date,
        type: override.type,
        startTime: override.startTime,
        endTime: override.endTime,
        reason: override.reason,
        createdAt: override.createdAt,
        updatedAt: override.updatedAt,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creating availability override:", error);
    return NextResponse.json(
      { message: "Internal server error", error: String(error) },
      { status: 500 }
    );
  }
}

/**
 * GET /api/availability/overrides?userId=...
 * Get all overrides for a user.
 */
async function getHandler(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("userId");

    if (!userId) {
      return NextResponse.json({ message: "Missing userId query parameter" }, { status: 400 });
    }

    // Look up user by string ID or numeric ID
    let numericUserId: number;
    if (!isNaN(Number(userId))) {
      numericUserId = Number(userId);
    } else {
      const user = await prisma.user.findFirst({
        where: { username: userId },
        select: { id: true },
      });
      if (!user) {
        return NextResponse.json({ message: "User not found" }, { status: 404 });
      }
      numericUserId = user.id;
    }

    const overrides = await prisma.$queryRawUnsafe<
      Array<{
        id: number;
        userId: number;
        scheduleId: number | null;
        date: Date;
        type: string;
        startTime: string;
        endTime: string;
        reason: string | null;
        createdAt: Date;
        updatedAt: Date;
      }>
    >(`SELECT * FROM "AvailabilityOverride" WHERE "userId" = $1 ORDER BY "date" ASC`, numericUserId);

    const formattedOverrides = overrides.map((override) => ({
      id: override.id,
      userId: override.userId,
      scheduleId: override.scheduleId,
      date: typeof override.date === "object" ? override.date.toISOString().split("T")[0] : override.date,
      type: override.type,
      startTime: override.startTime,
      endTime: override.endTime,
      reason: override.reason,
      createdAt: override.createdAt,
      updatedAt: override.updatedAt,
    }));

    return NextResponse.json(formattedOverrides);
  } catch (error) {
    console.error("Error fetching availability overrides:", error);
    return NextResponse.json(
      { message: "Internal server error", error: String(error) },
      { status: 500 }
    );
  }
}

export const POST = postHandler;
export const GET = getHandler;
