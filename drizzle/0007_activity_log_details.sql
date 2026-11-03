-- Richer activity log: where the event came from and the pod's state before it
ALTER TABLE "8slp_cronRuns" ADD COLUMN IF NOT EXISTS "source" varchar(20) NOT NULL DEFAULT 'cron';
ALTER TABLE "8slp_cronRuns" ADD COLUMN IF NOT EXISTS "podWasOn" boolean;
ALTER TABLE "8slp_cronRuns" ADD COLUMN IF NOT EXISTS "levelBefore" integer;
ALTER TABLE "8slp_cronRuns" ADD COLUMN IF NOT EXISTS "targetBefore" integer;
ALTER TABLE "8slp_cronRuns" ADD COLUMN IF NOT EXISTS "durationMs" integer;
