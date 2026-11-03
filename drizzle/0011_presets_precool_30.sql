-- One-time: every saved preset pre-cools / pre-heats 30 minutes before bed (was 60).
-- Only presets change; the current schedule is left as it is.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "8slp_appMigrations" WHERE "name" = 'presets_precool_30') THEN
    RETURN;
  END IF;

  UPDATE "8slp_profilePresets"
     SET "preheatLeadMinutes" = 30, "updated_at" = now();

  INSERT INTO "8slp_appMigrations" ("name") VALUES ('presets_precool_30');
END $$;
