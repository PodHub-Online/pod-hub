-- The name shown after sign-in ("Pod Hub", the headboard engraving, the nightstand title)
ALTER TABLE "8slp_users" ADD COLUMN IF NOT EXISTS "displayName" varchar(40);

-- the owner (first account) keeps the name the app always showed, once
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "8slp_appMigrations" WHERE "name" = 'owner_display_name') THEN
    UPDATE "8slp_users" SET "displayName" = NULL
    WHERE "displayName" IS NULL
      AND "email" = (SELECT "email" FROM "8slp_users" ORDER BY "created_at" ASC LIMIT 1);
    INSERT INTO "8slp_appMigrations" ("name") VALUES ('owner_display_name');
  END IF;
END $$;
