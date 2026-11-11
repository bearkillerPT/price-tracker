ALTER TABLE "custom_stores" ADD COLUMN "price_selector" text;--> statement-breakpoint
ALTER TABLE "custom_stores" ADD COLUMN "fetch_method" text DEFAULT 'http' NOT NULL;