ALTER TABLE "8slp_userTemperatureProfiles"
  ADD COLUMN IF NOT EXISTS "wakeupAlarmEnabled" boolean NOT NULL DEFAULT false;

ALTER TABLE "8slp_userTemperatureProfiles"
  ADD COLUMN IF NOT EXISTS "wakeupAlarmLevel" integer NOT NULL DEFAULT 0;

ALTER TABLE "8slp_userTemperatureProfiles"
  ADD COLUMN IF NOT EXISTS "wakeupAlarmLeadMinutes" integer NOT NULL DEFAULT 30;
