-- Pre-cool / pre-heat lead (minutes before bedtime the pod turns on; 0 = at bedtime)
ALTER TABLE "8slp_userTemperatureProfiles"
  ADD COLUMN IF NOT EXISTS "preheatLeadMinutes" integer NOT NULL DEFAULT 60;

ALTER TABLE "8slp_profilePresets"
  ADD COLUMN IF NOT EXISTS "preheatLeadMinutes" integer NOT NULL DEFAULT 60;

-- Cron run history
CREATE TABLE IF NOT EXISTS "8slp_cronRuns" (
  "id" serial PRIMARY KEY NOT NULL,
  "email" varchar(255) NOT NULL,
  "ranAt" timestamp DEFAULT now() NOT NULL,
  "stage" varchar(20) NOT NULL,
  "action" varchar(30) NOT NULL,
  "level" integer,
  "message" text
);

CREATE INDEX IF NOT EXISTS "8slp_cronRuns_email_ranAt_idx" ON "8slp_cronRuns" ("email", "ranAt");

-- One-time data migrations (this file is re-applied on every deploy)
CREATE TABLE IF NOT EXISTS "8slp_appMigrations" (
  "name" varchar(100) PRIMARY KEY NOT NULL,
  "applied_at" timestamp DEFAULT now() NOT NULL
);

-- Seed the "Gold Standard" preset family once. Deleting one later won't bring it back.
DO $$
DECLARE
  u record;
  base record;
BEGIN
  IF EXISTS (SELECT 1 FROM "8slp_appMigrations" WHERE "name" = 'seed_gold_standard_presets') THEN
    RETURN;
  END IF;

  FOR u IN SELECT "email" FROM "8slp_users" LOOP
    -- Base times: an existing "Gold Standard" preset, otherwise the current schedule
    SELECT "bedTime", "wakeupTime", "midStageSleepLevelStartTime", "finalSleepLevelStartTime",
           "wakeupAlarmLeadMinutes", "preheatLeadMinutes"
      INTO base
      FROM "8slp_profilePresets"
     WHERE "email" = u."email" AND "name" ILIKE 'gold%standard%'
     ORDER BY "id"
     LIMIT 1;

    IF NOT FOUND THEN
      SELECT "bedTime", "wakeupTime", "midStageSleepLevelStartTime", "finalSleepLevelStartTime",
             "wakeupAlarmLeadMinutes", "preheatLeadMinutes"
        INTO base
        FROM "8slp_userTemperatureProfiles"
       WHERE "email" = u."email";

      IF NOT FOUND THEN
        CONTINUE;
      END IF;

      INSERT INTO "8slp_profilePresets"
        ("email", "name", "description", "bedTime", "wakeupTime", "midStageSleepLevelStartTime",
         "finalSleepLevelStartTime", "initialSleepLevel", "midStageSleepLevel", "finalSleepLevel",
         "wakeupAlarmEnabled", "wakeupAlarmLevel", "wakeupAlarmLeadMinutes", "preheatLeadMinutes")
      VALUES
        (u."email", 'Gold Standard', 'Start -1 · Deep -2 · Late 0 · Alarm +2',
         base."bedTime", base."wakeupTime", base."midStageSleepLevelStartTime",
         base."finalSleepLevelStartTime", -10, -20, 0, true, 20, base."wakeupAlarmLeadMinutes",
         base."preheatLeadMinutes");
    END IF;

    INSERT INTO "8slp_profilePresets"
      ("email", "name", "description", "bedTime", "wakeupTime", "midStageSleepLevelStartTime",
       "finalSleepLevelStartTime", "initialSleepLevel", "midStageSleepLevel", "finalSleepLevel",
       "wakeupAlarmEnabled", "wakeupAlarmLevel", "wakeupAlarmLeadMinutes", "preheatLeadMinutes")
    SELECT u."email", v.name, v.description, base."bedTime", base."wakeupTime",
           base."midStageSleepLevelStartTime", base."finalSleepLevelStartTime",
           v.initial, v.mid, v.final, true, v.alarm, base."wakeupAlarmLeadMinutes",
           base."preheatLeadMinutes"
      FROM (VALUES
        ('Gold · Deep -3',           'Gold Standard with a colder deep stage',         -10, -30, 0, 20),
        ('Gold · Alarm +3',          'Gold Standard with a warmer wake-up',            -10, -20, 0, 30),
        ('Gold · Deep -3 · Alarm +3','Colder deep stage and warmer wake-up',           -10, -30, 0, 30),
        ('Gold · Start -2',          'Gold Standard with a cooler start',              -20, -20, 0, 20)
      ) AS v(name, description, initial, mid, final, alarm)
     WHERE NOT EXISTS (
       SELECT 1 FROM "8slp_profilePresets" p WHERE p."email" = u."email" AND p."name" = v.name
     );
  END LOOP;

  INSERT INTO "8slp_appMigrations" ("name") VALUES ('seed_gold_standard_presets');
END $$;
