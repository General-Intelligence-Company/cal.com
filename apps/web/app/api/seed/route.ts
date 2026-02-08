import { NextResponse } from "next/server";

import prisma from "@calcom/prisma";

/**
 * POST /api/seed
 * Creates seed data for testing - user, schedule, availability, and event type.
 * Idempotent - safe to call multiple times.
 */
async function postHandler() {
  try {
    const result = await seedData();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error seeding data:", error);
    return NextResponse.json(
      { message: "Error seeding data", error: String(error) },
      { status: 500 }
    );
  }
}

async function getHandler() {
  try {
    const result = await seedData();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error seeding data:", error);
    return NextResponse.json(
      { message: "Error seeding data", error: String(error) },
      { status: 500 }
    );
  }
}

async function seedData() {
  // Check if seed user already exists
  let user = await prisma.user.findFirst({
    where: { username: "seed-user-001" },
  });

  if (!user) {
    // Create the seed user
    user = await prisma.user.create({
      data: {
        username: "seed-user-001",
        email: "seed-user-001@example.com",
        name: "Seed User",
        timeZone: "UTC",
        completedOnboarding: true,
        locale: "en",
      },
    });
  }

  // Check if schedule exists
  let schedule = await prisma.schedule.findFirst({
    where: { userId: user.id, name: "Working Hours" },
  });

  if (!schedule) {
    // Create a Mon-Fri 9am-5pm schedule
    schedule = await prisma.schedule.create({
      data: {
        userId: user.id,
        name: "Working Hours",
        timeZone: "UTC",
      },
    });

    // Create availability entries for Mon(1) through Fri(5), 9am-5pm UTC
    // Days: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
    for (const day of [1, 2, 3, 4, 5]) {
      await prisma.availability.create({
        data: {
          scheduleId: schedule.id,
          userId: user.id,
          days: [day],
          startTime: new Date("1970-01-01T09:00:00.000Z"),
          endTime: new Date("1970-01-01T17:00:00.000Z"),
        },
      });
    }

    // Set as default schedule
    await prisma.user.update({
      where: { id: user.id },
      data: { defaultScheduleId: schedule.id },
    });
  }

  // Check if event type exists
  let eventType = await prisma.eventType.findFirst({
    where: { slug: "seed-event-type-001", userId: user.id },
  });

  if (!eventType) {
    eventType = await prisma.eventType.create({
      data: {
        title: "Seed Event Type",
        slug: "seed-event-type-001",
        length: 30,
        userId: user.id,
        scheduleId: schedule.id,
        slotInterval: 30,
      },
    });
  }

  return {
    message: "Seed data created successfully",
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
    },
    schedule: {
      id: schedule.id,
      name: schedule.name,
    },
    eventType: {
      id: eventType.id,
      slug: eventType.slug,
      title: eventType.title,
    },
  };
}

export const POST = postHandler;
export const GET = getHandler;
