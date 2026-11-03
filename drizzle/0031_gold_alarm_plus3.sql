-- One-time: the two built-in "Alarm +3" presets wake at +3 again (the 0030 change set every preset to +2).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "8slp_appMigrations" WHERE "name" = 'gold_alarm_plus3_again') THEN
    RETURN;
  END IF;

  UPDATE "8slp_profilePresets"
     SET "wakeupAlarmLevel" = 30, "updated_at" = now()
   WHERE "name" IN ('Gold · Alarm +3', 'Gold · Deep -3 · Alarm +3');

  INSERT INTO "8slp_appMigrations" ("name") VALUES ('gold_alarm_plus3_again');
END $$;
