-- Nights the schedule runs, as a bitmask of the bedtime's weekday (bit 0 = Sunday … bit 6 = Saturday). 127 = every night.
ALTER TABLE "8slp_userTemperatureProfiles" ADD COLUMN IF NOT EXISTS "activeDays" integer NOT NULL DEFAULT 127;
