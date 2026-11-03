-- "Follow schedule" switch, and a temporary hold after a manual change
ALTER TABLE "8slp_users" ADD COLUMN IF NOT EXISTS "scheduleEnabled" boolean NOT NULL DEFAULT true;
ALTER TABLE "8slp_users" ADD COLUMN IF NOT EXISTS "manualHoldUntil" timestamp;
