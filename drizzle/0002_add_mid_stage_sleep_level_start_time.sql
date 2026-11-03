ALTER TABLE "8slp_userTemperatureProfiles"
  ADD COLUMN IF NOT EXISTS "midStageSleepLevelStartTime" time;

UPDATE "8slp_userTemperatureProfiles"
SET "midStageSleepLevelStartTime" = (("bedTime" + interval '1 hour')::time)
WHERE "midStageSleepLevelStartTime" IS NULL;

ALTER TABLE "8slp_userTemperatureProfiles"
  ALTER COLUMN "midStageSleepLevelStartTime" SET DEFAULT '23:00',
  ALTER COLUMN "midStageSleepLevelStartTime" SET NOT NULL;
