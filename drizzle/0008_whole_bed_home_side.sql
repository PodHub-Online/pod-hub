-- Remembers which side was the user's before switching the pod to whole-bed (solo) mode
ALTER TABLE "8slp_users" ADD COLUMN IF NOT EXISTS "homeSide" varchar(10);
