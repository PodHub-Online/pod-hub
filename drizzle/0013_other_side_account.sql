-- The other Eight Sleep account on the bed, saved before Whole bed so it can be put back
ALTER TABLE "8slp_users" ADD COLUMN IF NOT EXISTS "otherSideUserId" varchar(64);
