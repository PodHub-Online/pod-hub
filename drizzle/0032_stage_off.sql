-- Off for a stage: one bit per stage (1 falling asleep and pre-cool, 2 deep sleep, 4 late sleep, 8 Pre-wake).
-- The stage's level stays saved, so switching Off back off brings it back.
ALTER TABLE "8slp_userTemperatureProfiles" ADD COLUMN IF NOT EXISTS "offStages" integer NOT NULL DEFAULT 0;
ALTER TABLE "8slp_profilePresets" ADD COLUMN IF NOT EXISTS "offStages" integer NOT NULL DEFAULT 0;
