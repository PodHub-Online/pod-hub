-- Who triggered a schedule check (IP, approximate location, user agent, host), as JSON
ALTER TABLE "8slp_cronRuns" ADD COLUMN IF NOT EXISTS "meta" text;
