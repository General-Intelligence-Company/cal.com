-- Seed test data for availability override feature testing
-- This is idempotent - uses ON CONFLICT to avoid duplicates

-- Create seed user (seed-user-001)
-- The "created" column is the DB column name for Prisma's "createdDate" field (via @map)
INSERT INTO "users" ("username", "email", "name", "timeZone", "completedOnboarding", "locale", "created")
VALUES ('seed-user-001', 'seed-user-001@example.com', 'Seed User', 'UTC', true, 'en', NOW())
ON CONFLICT ("email") DO UPDATE SET "username" = 'seed-user-001';

-- Create schedule for seed user
INSERT INTO "Schedule" ("userId", "name", "timeZone")
SELECT u.id, 'Working Hours', 'UTC'
FROM "users" u
WHERE u."username" = 'seed-user-001'
AND NOT EXISTS (
  SELECT 1 FROM "Schedule" s WHERE s."userId" = u.id AND s."name" = 'Working Hours'
);

-- Set defaultScheduleId on user
UPDATE "users" SET "defaultScheduleId" = (
  SELECT s.id FROM "Schedule" s
  JOIN "users" u ON s."userId" = u.id
  WHERE u."username" = 'seed-user-001' AND s."name" = 'Working Hours'
  LIMIT 1
)
WHERE "username" = 'seed-user-001';

-- Create availability entries (Mon-Fri 9am-5pm UTC)
-- Monday (day 1)
INSERT INTO "Availability" ("userId", "scheduleId", "days", "startTime", "endTime")
SELECT u.id, s.id, ARRAY[1], '09:00:00'::time, '17:00:00'::time
FROM "users" u
JOIN "Schedule" s ON s."userId" = u.id AND s."name" = 'Working Hours'
WHERE u."username" = 'seed-user-001'
AND NOT EXISTS (
  SELECT 1 FROM "Availability" a WHERE a."scheduleId" = s.id AND a."days" = ARRAY[1]
);

-- Tuesday (day 2)
INSERT INTO "Availability" ("userId", "scheduleId", "days", "startTime", "endTime")
SELECT u.id, s.id, ARRAY[2], '09:00:00'::time, '17:00:00'::time
FROM "users" u
JOIN "Schedule" s ON s."userId" = u.id AND s."name" = 'Working Hours'
WHERE u."username" = 'seed-user-001'
AND NOT EXISTS (
  SELECT 1 FROM "Availability" a WHERE a."scheduleId" = s.id AND a."days" = ARRAY[2]
);

-- Wednesday (day 3)
INSERT INTO "Availability" ("userId", "scheduleId", "days", "startTime", "endTime")
SELECT u.id, s.id, ARRAY[3], '09:00:00'::time, '17:00:00'::time
FROM "users" u
JOIN "Schedule" s ON s."userId" = u.id AND s."name" = 'Working Hours'
WHERE u."username" = 'seed-user-001'
AND NOT EXISTS (
  SELECT 1 FROM "Availability" a WHERE a."scheduleId" = s.id AND a."days" = ARRAY[3]
);

-- Thursday (day 4)
INSERT INTO "Availability" ("userId", "scheduleId", "days", "startTime", "endTime")
SELECT u.id, s.id, ARRAY[4], '09:00:00'::time, '17:00:00'::time
FROM "users" u
JOIN "Schedule" s ON s."userId" = u.id AND s."name" = 'Working Hours'
WHERE u."username" = 'seed-user-001'
AND NOT EXISTS (
  SELECT 1 FROM "Availability" a WHERE a."scheduleId" = s.id AND a."days" = ARRAY[4]
);

-- Friday (day 5)
INSERT INTO "Availability" ("userId", "scheduleId", "days", "startTime", "endTime")
SELECT u.id, s.id, ARRAY[5], '09:00:00'::time, '17:00:00'::time
FROM "users" u
JOIN "Schedule" s ON s."userId" = u.id AND s."name" = 'Working Hours'
WHERE u."username" = 'seed-user-001'
AND NOT EXISTS (
  SELECT 1 FROM "Availability" a WHERE a."scheduleId" = s.id AND a."days" = ARRAY[5]
);

-- Create event type for seed user
INSERT INTO "EventType" ("title", "slug", "length", "userId", "scheduleId", "slotInterval", "updatedAt")
SELECT 'Seed Event Type', 'seed-event-type-001', 30, u.id, s.id, 30, NOW()
FROM "users" u
JOIN "Schedule" s ON s."userId" = u.id AND s."name" = 'Working Hours'
WHERE u."username" = 'seed-user-001'
AND NOT EXISTS (
  SELECT 1 FROM "EventType" e WHERE e."slug" = 'seed-event-type-001' AND e."userId" = u.id
);
