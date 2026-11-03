-- App settings entered in the app itself (e.g. the WHOOP developer app keys)
CREATE TABLE IF NOT EXISTS "8slp_appConfig" (
  "key" varchar(64) PRIMARY KEY NOT NULL,
  "value" text NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
