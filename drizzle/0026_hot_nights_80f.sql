-- Hot nights start at 80°F (26.5°C) instead of 77°F; one threshold for the room sensor and the forecast
ALTER TABLE "8slp_users" ALTER COLUMN "roomAwareC" SET DEFAULT 26.5;

-- once: accounts still on the old default move up; anyone who picked a number keeps it
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "8slp_appMigrations" WHERE "name" = 'hot_nights_80f') THEN
    RETURN;
  END IF;
  UPDATE "8slp_users" SET "roomAwareC" = 26.5 WHERE "roomAwareC" < 26.5;
  INSERT INTO "8slp_appMigrations" ("name") VALUES ('hot_nights_80f');
END $$;
