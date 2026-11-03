-- One-time: the built-in Gold Standard preset family gets Pre-wake +1 for 30 minutes before the wake-up warmth.
-- Only these presets change; your own presets and the current schedule are left as they are.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "8slp_appMigrations" WHERE "name" = 'gold_presets_pre_wake') THEN
    RETURN;
  END IF;

  UPDATE "8slp_profilePresets"
     SET "preWakeLevel" = 10, "preWakeLeadMinutes" = 30, "updated_at" = now()
   WHERE "name" ILIKE 'gold%';

  UPDATE "8slp_profilePresets"
     SET "description" = 'Start -1 · Deep -2 · Late 0 · Pre-wake +1 · Alarm +2'
   WHERE "name" = 'Gold Standard' AND "description" = 'Start -1 · Deep -2 · Late 0 · Alarm +2';

  INSERT INTO "8slp_appMigrations" ("name") VALUES ('gold_presets_pre_wake');
END $$;
