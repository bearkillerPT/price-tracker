CREATE TABLE "custom_stores" (
	"id" text PRIMARY KEY NOT NULL,
	"host" text NOT NULL,
	"label" text NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"default_interval_minutes" integer DEFAULT 180 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
