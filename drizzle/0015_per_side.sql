-- One schedule per side of the bed: (email, side) instead of email.
-- "Follow schedule" and the manual pause move onto each side's schedule.
ALTER TABLE "8slp_userTemperatureProfiles" ADD COLUMN IF NOT EXISTS "side" varchar(10) DEFAULT 'left' NOT NULL;
ALTER TABLE "8slp_userTemperatureProfiles" ADD COLUMN IF NOT EXISTS "scheduleEnabled" boolean DEFAULT true NOT NULL;
ALTER TABLE "8slp_userTemperatureProfiles" ADD COLUMN IF NOT EXISTS "manualHoldUntil" timestamp;
ALTER TABLE "8slp_cronRuns" ADD COLUMN IF NOT EXISTS "side" varchar(10);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "8slp_appMigrations" WHERE "name" = 'schedule_per_side') THEN
    -- the existing schedule belongs to the side the owner sleeps on
    UPDATE "8slp_userTemperatureProfiles" p
       SET "side" = CASE WHEN u."homeSide" = 'right' THEN 'right' ELSE 'left' END,
           "scheduleEnabled" = u."scheduleEnabled",
           "manualHoldUntil" = u."manualHoldUntil"
      FROM "8slp_users" u
     WHERE u."email" = p."email";
    INSERT INTO "8slp_appMigrations" ("name") VALUES ('schedule_per_side');
  END IF;

  -- primary key: email -> (email, side)
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = '8slp_userTemperatureProfiles_pkey' AND array_length(conkey, 1) = 1
  ) THEN
    ALTER TABLE "8slp_userTemperatureProfiles" DROP CONSTRAINT "8slp_userTemperatureProfiles_pkey";
    ALTER TABLE "8slp_userTemperatureProfiles" ADD CONSTRAINT "8slp_userTemperatureProfiles_pkey" PRIMARY KEY ("email", "side");
  END IF;
END $$;
