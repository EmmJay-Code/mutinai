CREATE TYPE "ecosystem"."derived_review_status" AS ENUM('unreviewed', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "ecosystem"."price_kind" AS ENUM('launch_msrp', 'retail_new', 'used', 'editorial_estimate');--> statement-breakpoint
ALTER TYPE "ecosystem"."event_kind" ADD VALUE 'research_paper';--> statement-breakpoint
CREATE TABLE "ecosystem"."price_observation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"price_kind" "ecosystem"."price_kind" NOT NULL,
	"amount" double precision NOT NULL,
	"currency" text NOT NULL,
	"region" text,
	"observed_at" timestamp with time zone NOT NULL,
	"source_name" text NOT NULL,
	"source_url" text,
	"source_record_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_observation_amount_positive" CHECK ("ecosystem"."price_observation"."amount" > 0),
	CONSTRAINT "price_observation_currency_code" CHECK ("ecosystem"."price_observation"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "ecosystem"."derived_content" ALTER COLUMN "entity_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ecosystem"."derived_content" ADD COLUMN "event_id" uuid;--> statement-breakpoint
ALTER TABLE "ecosystem"."derived_content" ADD COLUMN "provider" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "ecosystem"."derived_content" ADD COLUMN "model" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "ecosystem"."derived_content" ADD COLUMN "input_hash" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "ecosystem"."derived_content" ADD COLUMN "review_status" "ecosystem"."derived_review_status" DEFAULT 'unreviewed' NOT NULL;--> statement-breakpoint
ALTER TABLE "ecosystem"."price_observation" ADD CONSTRAINT "price_observation_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "ecosystem"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."price_observation" ADD CONSTRAINT "price_observation_source_record_id_source_record_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "ingest"."source_record"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "price_observation_latest_idx" ON "ecosystem"."price_observation" USING btree ("entity_id","price_kind","observed_at");--> statement-breakpoint
ALTER TABLE "ecosystem"."derived_content" ADD CONSTRAINT "derived_content_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "ecosystem"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "derived_content_event_idx" ON "ecosystem"."derived_content" USING btree ("event_id");--> statement-breakpoint
ALTER TABLE "ecosystem"."derived_content" ADD CONSTRAINT "derived_content_one_subject" CHECK (num_nonnulls("ecosystem"."derived_content"."entity_id", "ecosystem"."derived_content"."event_id") = 1);