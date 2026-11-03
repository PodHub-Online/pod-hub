-- Who may sign in besides the owner (managed in Settings → Invites)
CREATE TABLE IF NOT EXISTS "8slp_invites" (
  "email" varchar(255) PRIMARY KEY NOT NULL,
  "addedAt" timestamp DEFAULT now() NOT NULL
);

-- People who proved they own an Eight Sleep account and asked to get in. No tokens are kept.
CREATE TABLE IF NOT EXISTS "8slp_accessRequests" (
  "email" varchar(255) PRIMARY KEY NOT NULL,
  "firstName" varchar(80),
  "requestedAt" timestamp DEFAULT now() NOT NULL
);

-- Failed sign-ins and access requests, to slow down password guessing. Keys are hashed; pruned after a day.
CREATE TABLE IF NOT EXISTS "8slp_signInAttempts" (
  "id" serial PRIMARY KEY NOT NULL,
  "key" varchar(80) NOT NULL,
  "at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "8slp_signInAttempts_key_at_idx" ON "8slp_signInAttempts" ("key", "at");

-- same lockdown as 0018 for the new tables (the public web API gets nothing)
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['8slp_invites', '8slp_accessRequests', '8slp_signInAttempts'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', t);
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    -- the owner's laptop login can use the new tables like the old ones
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hub_local') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO hub_local', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hub_local')
       AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = 'hub_local_all') THEN
      EXECUTE format('CREATE POLICY hub_local_all ON public.%I FOR ALL TO hub_local USING (true) WITH CHECK (true)', t);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON SEQUENCE public."8slp_signInAttempts_id_seq" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON SEQUENCE public."8slp_signInAttempts_id_seq" FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hub_local') THEN
    GRANT USAGE, SELECT ON SEQUENCE public."8slp_signInAttempts_id_seq" TO hub_local;
  END IF;
END $$;
