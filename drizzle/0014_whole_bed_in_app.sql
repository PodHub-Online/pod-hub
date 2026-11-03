-- Whole bed handled by the app (both sides get the same commands), instead of Eight Sleep's
-- "solo" mode, which removes the other account from the pod
ALTER TABLE "8slp_users" ADD COLUMN IF NOT EXISTS "wholeBedApp" boolean DEFAULT false NOT NULL;
