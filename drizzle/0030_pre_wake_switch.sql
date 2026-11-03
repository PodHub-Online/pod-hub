-- Pre-wake gets its own on/off switch, and its minutes now count back from wake-up (like the alarm's).
ALTER TABLE "8slp_userTemperatureProfiles" ADD COLUMN IF NOT EXISTS "preWakeEnabled" boolean NOT NULL DEFAULT false;
ALTER TABLE "8slp_profilePresets" ADD COLUMN IF NOT EXISTS "preWakeEnabled" boolean NOT NULL DEFAULT false;

-- One-time, for everyone:
--  * schedules that match one of the person's presets get the same new preset values, so they stay on that preset
--  * every schedule: the warmth starts 15 min before wake-up and Pre-wake 1 hour before (Pre-wake stays off unless it was on)
--  * every preset: Pre-wake on at +1 from 1 hour before wake-up, then Waking up at +2 from 15 min before
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "8slp_appMigrations" WHERE "name" = 'pre_wake_switch_15_60') THEN
    RETURN;
  END IF;

  UPDATE "8slp_userTemperatureProfiles" s
     SET "preWakeEnabled" = true, "preWakeLevel" = 10, "wakeupAlarmEnabled" = true, "wakeupAlarmLevel" = 20
   WHERE EXISTS (
     SELECT 1 FROM "8slp_profilePresets" p
      WHERE p."email" = s."email"
        AND p."bedTime" = s."bedTime" AND p."wakeupTime" = s."wakeupTime"
        AND p."midStageSleepLevelStartTime" = s."midStageSleepLevelStartTime"
        AND p."finalSleepLevelStartTime" = s."finalSleepLevelStartTime"
        AND p."initialSleepLevel" = s."initialSleepLevel" AND p."midStageSleepLevel" = s."midStageSleepLevel"
        AND p."finalSleepLevel" = s."finalSleepLevel" AND p."preheatLeadMinutes" = s."preheatLeadMinutes"
        AND p."wakeupAlarmEnabled" = s."wakeupAlarmEnabled"
        AND (NOT s."wakeupAlarmEnabled" OR (p."wakeupAlarmLevel" = s."wakeupAlarmLevel" AND p."wakeupAlarmLeadMinutes" = s."wakeupAlarmLeadMinutes"))
   );

  -- Pre-wake that was on (minutes > 0, counted from the warmth) stays on
  UPDATE "8slp_userTemperatureProfiles" SET "preWakeEnabled" = true WHERE "preWakeLeadMinutes" > 0;

  UPDATE "8slp_userTemperatureProfiles"
     SET "wakeupAlarmLeadMinutes" = 15, "preWakeLeadMinutes" = 60, "updated_at" = now();

  UPDATE "8slp_profilePresets"
     SET "preWakeEnabled" = true, "preWakeLevel" = 10, "preWakeLeadMinutes" = 60,
         "wakeupAlarmEnabled" = true, "wakeupAlarmLevel" = 20, "wakeupAlarmLeadMinutes" = 15, "updated_at" = now();

  UPDATE "8slp_profilePresets"
     SET "description" = 'Start -1 · Deep -2 · Late 0 · Pre-wake +1 · Waking up +2'
   WHERE "name" = 'Gold Standard';

  INSERT INTO "8slp_appMigrations" ("name") VALUES ('pre_wake_switch_15_60');
END $$;
