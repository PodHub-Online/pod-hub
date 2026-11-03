-- One-time: move the Gold Standard preset family's bedtime to 00:00.
-- Only bedTime changes; every other time and level stays as it is.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "8slp_appMigrations" WHERE "name" = 'gold_presets_midnight_bedtime') THEN
    RETURN;
  END IF;

  UPDATE "8slp_profilePresets"
     SET "bedTime" = '00:00', "updated_at" = now()
   WHERE "name" ILIKE 'gold%';

  INSERT INTO "8slp_appMigrations" ("name") VALUES ('gold_presets_midnight_bedtime');
END $$;
