CREATE TABLE "store_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"store" text NOT NULL,
	"marketplace" text NOT NULL,
	"state_encrypted" text NOT NULL,
	"user_agent" text NOT NULL,
	"account_name" text,
	"status" text DEFAULT 'active' NOT NULL,
	"signed_in_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "store_sessions_store_marketplace" ON "store_sessions" USING btree ("store","marketplace");