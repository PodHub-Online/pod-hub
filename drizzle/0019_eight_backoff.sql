-- The cron leaves a person alone until this time after Eight Sleep refuses (429 / dead sign-in)
ALTER TABLE "8slp_users" ADD COLUMN IF NOT EXISTS "eightBackoffUntil" timestamp;
