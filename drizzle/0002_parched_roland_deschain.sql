ALTER TABLE "events" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "banner_image_url" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "venue_name" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "start_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "end_date" timestamp with time zone;