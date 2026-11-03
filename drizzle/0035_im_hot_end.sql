-- "I'm hot": when it ends and how the bed was before, so the 5-minute check can put it back (or turn it off)
ALTER TABLE "8slp_users" ADD COLUMN IF NOT EXISTS "hotUntil" timestamp;
ALTER TABLE "8slp_users" ADD COLUMN IF NOT EXISTS "hotSide" varchar(10);
ALTER TABLE "8slp_users" ADD COLUMN IF NOT EXISTS "hotPrev" varchar(200);
