-- Weekend schedule, room-aware cooling, weekly digest, per-stage night levels, in-app feedback
ALTER TABLE "8slp_userTemperatureProfiles" ADD COLUMN IF NOT EXISTS "weekendDays" integer DEFAULT 0 NOT NULL;
ALTER TABLE "8slp_userTemperatureProfiles" ADD COLUMN IF NOT EXISTS "weekendBedTime" time;
ALTER TABLE "8slp_userTemperatureProfiles" ADD COLUMN IF NOT EXISTS "weekendWakeupTime" time;
ALTER TABLE "8slp_users" ADD COLUMN IF NOT EXISTS "roomAware" boolean DEFAULT false NOT NULL;
ALTER TABLE "8slp_users" ADD COLUMN IF NOT EXISTS "roomAwareC" real DEFAULT 25 NOT NULL;
ALTER TABLE "8slp_users" ADD COLUMN IF NOT EXISTS "roomCache" text;
ALTER TABLE "8slp_users" ADD COLUMN IF NOT EXISTS "lastDigestAt" timestamp;
ALTER TABLE "8slp_nightLevels" ADD COLUMN IF NOT EXISTS "stageLevels" text;

-- Notes people send from Settings → Send feedback (the owner reads them under Invites)
CREATE TABLE IF NOT EXISTS "8slp_feedback" (
  "id" serial PRIMARY KEY NOT NULL,
  "email" varchar(255) NOT NULL,
  "kind" varchar(20) NOT NULL,
  "text" varchar(2000) NOT NULL,
  "meta" varchar(300),
  "status" varchar(20) DEFAULT 'new' NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

-- same lockdown as 0018 for the new table (the public web API gets nothing)
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['8slp_feedback'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', t);
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hub_local') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO hub_local', t);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.%I TO hub_local', t || '_id_seq');
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hub_local')
       AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = 'hub_local_all') THEN
      EXECUTE format('CREATE POLICY hub_local_all ON public.%I FOR ALL TO hub_local USING (true) WITH CHECK (true)', t);
    END IF;
  END LOOP;
END $$;
