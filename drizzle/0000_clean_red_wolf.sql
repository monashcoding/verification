CREATE TYPE "public"."enrollment_status" AS ENUM('ENROLLED', 'INACTIVE');--> statement-breakpoint
CREATE TYPE "public"."linked_via" AS ENUM('email_auto', 'student_id', 'manual_review');--> statement-breakpoint
CREATE TYPE "public"."msa_membership_status" AS ENUM('MSA+', 'Non-MSA+');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor_mac_user_id" text,
	"action" text NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "events" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"humanitix_event_url" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "member_event_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"roster_id" integer NOT NULL,
	"event_id" integer NOT NULL,
	"code" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"max_use_per_order" integer DEFAULT 1 NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"exported_at" timestamp with time zone,
	CONSTRAINT "member_event_codes_roster_event_unique" UNIQUE("roster_id","event_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "member_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"mac_user_id" text NOT NULL,
	"roster_id" integer NOT NULL,
	"linked_via" "linked_via" NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_links_mac_user_id_unique" UNIQUE("mac_user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "roster" (
	"id" serial PRIMARY KEY NOT NULL,
	"last_name" text,
	"first_name" text,
	"card_number" text,
	"email" text,
	"msa_membership_status" "msa_membership_status",
	"enrollment_status" "enrollment_status",
	"study_location" text,
	"purchase_date" text,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"import_batch_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "roster_link_attempts" (
	"mac_user_id" text PRIMARY KEY NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "member_event_codes" ADD CONSTRAINT "member_event_codes_roster_id_roster_id_fk" FOREIGN KEY ("roster_id") REFERENCES "public"."roster"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "member_event_codes" ADD CONSTRAINT "member_event_codes_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "member_links" ADD CONSTRAINT "member_links_roster_id_roster_id_fk" FOREIGN KEY ("roster_id") REFERENCES "public"."roster"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
