-- The owner's email reply to a feedback note, and when it was sent
ALTER TABLE "8slp_feedback" ADD COLUMN IF NOT EXISTS "reply" varchar(4000);
ALTER TABLE "8slp_feedback" ADD COLUMN IF NOT EXISTS "repliedAt" timestamp;
