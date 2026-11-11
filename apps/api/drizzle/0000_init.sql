CREATE TABLE "alert_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"rule_id" integer,
	"product_id" integer,
	"triggered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"delivered" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"type" text NOT NULL,
	"threshold" numeric(12, 2),
	"enabled" boolean DEFAULT true NOT NULL,
	"reference_price" numeric(12, 2),
	"last_triggered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_account" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_account_single_row" CHECK ("app_account"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "app_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"currency" text PRIMARY KEY NOT NULL,
	"per_eur" numeric(14, 6) NOT NULL,
	"rate_date" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"store" text NOT NULL,
	"marketplace" text NOT NULL,
	"external_id" text NOT NULL,
	"url" text NOT NULL,
	"condition" text DEFAULT 'new' NOT NULL,
	"interval_minutes" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"guard_include" text[] DEFAULT '{}'::text[] NOT NULL,
	"guard_exclude" text[] DEFAULT '{}'::text[] NOT NULL,
	"last_checked_at" timestamp with time zone,
	"next_check_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_channels" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"token" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "observations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"listing_id" integer NOT NULL,
	"store" text NOT NULL,
	"marketplace" text NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"signed_in" boolean DEFAULT false NOT NULL,
	"title" text,
	"variant_label" text,
	"currency" text,
	"price" numeric(12, 2),
	"shipping" numeric(12, 2),
	"delivered_price" numeric(12, 2),
	"headline_price" numeric(12, 2),
	"headline_eur" numeric(12, 2),
	"in_stock" boolean,
	"availability_text" text,
	"delivery_location" text,
	"delivery_location_source" text,
	"delivery_text" text,
	"seller" text,
	"ships_from" text,
	"offers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"http_status" integer,
	"duration_ms" integer,
	"request_count" integer DEFAULT 0 NOT NULL,
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"ean" text,
	"notes" text,
	"accepted_conditions" text[] DEFAULT '{new}'::text[] NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"daily_summary_enabled" boolean DEFAULT true NOT NULL,
	"daily_summary_hour" integer DEFAULT 10 NOT NULL,
	"last_daily_summary_date" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_single_row" CHECK ("settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "store_state" (
	"rate_group" text PRIMARY KEY NOT NULL,
	"paused_until" timestamp with time zone,
	"pause_reason" text,
	"consecutive_blocks" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_rule_id_alert_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."alert_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "listings_unique_page" ON "listings" USING btree ("product_id","store","marketplace","external_id");--> statement-breakpoint
CREATE INDEX "listings_next_check" ON "listings" USING btree ("next_check_at");--> statement-breakpoint
CREATE INDEX "observations_listing_time" ON "observations" USING btree ("listing_id","checked_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "observations_store_time" ON "observations" USING btree ("store","checked_at");