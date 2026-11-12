CREATE TABLE "store_icons" (
	"store" text PRIMARY KEY NOT NULL,
	"ok" boolean NOT NULL,
	"content_type" text,
	"data" text,
	"source_url" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
