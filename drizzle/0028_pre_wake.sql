-- Pre-wake: a gentle step between Late sleep and the wake-up warmth (0 minutes = off, so nobody's night changes)
ALTER TABLE "8slp_userTemperatureProfiles" ADD COLUMN IF NOT EXISTS "preWakeLevel" integer NOT NULL DEFAULT 10;
ALTER TABLE "8slp_userTemperatureProfiles" ADD COLUMN IF NOT EXISTS "preWakeLeadMinutes" integer NOT NULL DEFAULT 0;
ALTER TABLE "8slp_profilePresets" ADD COLUMN IF NOT EXISTS "preWakeLevel" integer NOT NULL DEFAULT 10;
ALTER TABLE "8slp_profilePresets" ADD COLUMN IF NOT EXISTS "preWakeLeadMinutes" integer NOT NULL DEFAULT 0;
