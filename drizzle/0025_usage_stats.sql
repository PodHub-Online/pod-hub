-- Owner statistics: a light usage log (no health data, kept 90 days) and daily counters
ALTER TABLE "8slp_users" ADD COLUMN IF NOT EXISTS "lastSeenAt" timestamp;
ALTER TABLE "8slp_users" ADD COLUMN IF NOT EXISTS "lastClient" text;
ALTER TABLE "8slp_users" ADD COLUMN IF NOT EXISTS "podState" text;
ALTER TABLE "8slp_users" ADD COLUMN IF NOT EXISTS "authError" boolean DEFAULT false NOT NULL;

CREATE TABLE IF NOT EXISTS "8slp_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "email" varchar(255),
  "kind" varchar(40) NOT NULL,
  "meta" varchar(300),
  "at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "8slp_events_at_idx" ON "8slp_events" ("at");
CREATE INDEX IF NOT EXISTS "8slp_events_email_at_idx" ON "8slp_events" ("email", "at");

-- one row per day and counter ("eight_calls", "eight_error_429", "push_sent", ...)
CREATE TABLE IF NOT EXISTS "8slp_dailyCounters" (
  "day" varchar(10) NOT NULL,
  "key" varchar(40) NOT NULL,
  "n" integer DEFAULT 0 NOT NULL,
  PRIMARY KEY ("day", "key")
);

-- same lockdown as 0018 for the new tables (the public web API gets nothing)
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['8slp_events', '8slp_dailyCounters'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', t);
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hub_local') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO hub_local', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hub_local')
       AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = 'hub_local_all') THEN
      EXECUTE format('CREATE POLICY hub_local_all ON public.%I FOR ALL TO hub_local USING (true) WITH CHECK (true)', t);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hub_local') THEN
    GRANT USAGE, SELECT ON SEQUENCE public."8slp_events_id_seq" TO hub_local;
  END IF;
END $$;
