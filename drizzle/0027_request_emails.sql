-- Join requests the owner was already emailed about (one combined email per schedule check)
ALTER TABLE "8slp_accessRequests" ADD COLUMN IF NOT EXISTS "emailedAt" timestamp;
