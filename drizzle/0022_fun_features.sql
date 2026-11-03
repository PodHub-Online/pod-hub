-- Nap mode, accent color, weather, travel, phone notifications
ALTER TABLE "8slp_users" ADD COLUMN IF NOT EXISTS "napUntil" timestamp;
ALTER TABLE "8slp_users" ADD COLUMN IF NOT EXISTS "napSide" varchar(10);
ALTER TABLE "8slp_users" ADD COLUMN IF NOT EXISTS "napLevel" integer;
ALTER TABLE "8slp_users" ADD COLUMN IF NOT EXISTS "napWarmLevel" integer;
ALTER TABLE "8slp_users" ADD COLUMN IF NOT EXISTS "accentColor" varchar(16);
ALTER TABLE "8slp_users" ADD COLUMN IF NOT EXISTS "homeLat" real;
ALTER TABLE "8slp_users" ADD COLUMN IF NOT EXISTS "homeLon" real;
ALTER TABLE "8slp_users" ADD COLUMN IF NOT EXISTS "weatherEnabled" boolean DEFAULT false NOT NULL;
ALTER TABLE "8slp_users" ADD COLUMN IF NOT EXISTS "weatherCache" text;
ALTER TABLE "8slp_users" ADD COLUMN IF NOT EXISTS "travelEnabled" boolean DEFAULT false NOT NULL;
ALTER TABLE "8slp_users" ADD COLUMN IF NOT EXISTS "notifyPrefs" text;
ALTER TABLE "8slp_users" ADD COLUMN IF NOT EXISTS "notifyState" text;
ALTER TABLE "8slp_users" ADD COLUMN IF NOT EXISTS "lastNotification" text;

-- One row per night and side: what the pod did, kept longer than the 7-day activity log
CREATE TABLE IF NOT EXISTS "8slp_nightLevels" (
  "email" varchar(255) NOT NULL,
  "night" varchar(10) NOT NULL,
  "side" varchar(10) NOT NULL,
  "avgLevel" real,
  "minLevel" integer,
  "maxLevel" integer,
  "onMinutes" integer DEFAULT 0 NOT NULL,
  "manualChanges" integer DEFAULT 0 NOT NULL,
  "scheduleRan" boolean DEFAULT false NOT NULL,
  "firstOn" timestamp,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  PRIMARY KEY ("email", "night", "side")
);

-- Phones that asked for notifications
CREATE TABLE IF NOT EXISTS "8slp_pushSubscriptions" (
  "endpoint" text PRIMARY KEY NOT NULL,
  "email" varchar(255) NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

-- same lockdown as 0018 for the new tables (the public web API gets nothing)
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['8slp_nightLevels', '8slp_pushSubscriptions'] LOOP
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
END $$;
