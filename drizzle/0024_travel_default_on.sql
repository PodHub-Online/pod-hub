-- Smart travel is on by default (it only does something once Home is saved)
ALTER TABLE "8slp_users" ALTER COLUMN "travelEnabled" SET DEFAULT true;

-- turn it on once for the accounts that already exist; later choices are kept
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "8slp_appMigrations" WHERE "name" = 'travel_default_on') THEN
    RETURN;
  END IF;
  UPDATE "8slp_users" SET "travelEnabled" = true;
  INSERT INTO "8slp_appMigrations" ("name") VALUES ('travel_default_on');
END $$;
