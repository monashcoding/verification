ALTER TABLE "events" ADD COLUMN "humanitix_event_id" text;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_humanitix_event_id_unique" UNIQUE("humanitix_event_id");