ALTER TABLE "8slp_users"
  ADD COLUMN IF NOT EXISTS "vacationMode" boolean NOT NULL DEFAULT false;

ALTER TABLE "8slp_users"
  ADD COLUMN IF NOT EXISTS "vacationUntil" timestamp;

ALTER TABLE "8slp_users"
  ADD COLUMN IF NOT EXISTS "lastCronRunAt" timestamp;

CREATE TABLE IF NOT EXISTS "8slp_profilePresets" (
  "id" serial PRIMARY KEY NOT NULL,
  "email" varchar(255) NOT NULL REFERENCES "8slp_users"("email"),
  "name" varchar(60) NOT NULL,
  "description" varchar(160) DEFAULT '' NOT NULL,
  "bedTime" time NOT NULL,
  "wakeupTime" time NOT NULL,
  "initialSleepLevel" integer NOT NULL,
  "midStageSleepLevel" integer NOT NULL,
  "midStageSleepLevelStartTime" time NOT NULL,
  "finalSleepLevel" integer NOT NULL,
  "finalSleepLevelStartTime" time NOT NULL,
  "wakeupAlarmEnabled" boolean DEFAULT false NOT NULL,
  "wakeupAlarmLevel" integer DEFAULT 0 NOT NULL,
  "wakeupAlarmLeadMinutes" integer DEFAULT 30 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "8slp_profilePresets_email_idx" ON "8slp_profilePresets" ("email");
