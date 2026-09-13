CREATE TYPE "ingest"."review_status" AS ENUM('open', 'resolved', 'dismissed', 'superseded');--> statement-breakpoint
ALTER TYPE "ingest"."ingestion_run_status" ADD VALUE 'abandoned';--> statement-breakpoint
CREATE TABLE "ecosystem"."entity_metric" (
	"entity_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"source_id" uuid NOT NULL,
	"observed_on" date NOT NULL,
	"value" double precision NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "entity_metric_entity_id_metric_source_id_observed_on_pk" PRIMARY KEY("entity_id","metric","source_id","observed_on")
);
--> statement-breakpoint
CREATE TABLE "ingest"."http_validator" (
	"source_id" uuid NOT NULL,
	"url" text NOT NULL,
	"etag" text,
	"last_modified" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "http_validator_source_id_url_pk" PRIMARY KEY("source_id","url")
);
--> statement-breakpoint
CREATE TABLE "ingest"."review_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"reason" text NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"detail" text NOT NULL,
	"blocking" integer DEFAULT 1 NOT NULL,
	"candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"suggestion" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "ingest"."review_status" DEFAULT 'open' NOT NULL,
	"resolution" text,
	"first_source_record_id" uuid NOT NULL,
	"last_source_record_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ingest"."ingestion_run" ADD COLUMN "options" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ingest"."source_record" ADD COLUMN "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "ecosystem"."entity_metric" ADD CONSTRAINT "entity_metric_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "ecosystem"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."entity_metric" ADD CONSTRAINT "entity_metric_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest"."http_validator" ADD CONSTRAINT "http_validator_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest"."review_item" ADD CONSTRAINT "review_item_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest"."review_item" ADD CONSTRAINT "review_item_first_source_record_id_source_record_id_fk" FOREIGN KEY ("first_source_record_id") REFERENCES "ingest"."source_record"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest"."review_item" ADD CONSTRAINT "review_item_last_source_record_id_source_record_id_fk" FOREIGN KEY ("last_source_record_id") REFERENCES "ingest"."source_record"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entity_metric_latest_idx" ON "ecosystem"."entity_metric" USING btree ("entity_id","metric","observed_on");--> statement-breakpoint
CREATE UNIQUE INDEX "review_item_key" ON "ingest"."review_item" USING btree ("source_id","external_id","reason","subject");--> statement-breakpoint
CREATE INDEX "review_item_status_idx" ON "ingest"."review_item" USING btree ("status","reason");--> statement-breakpoint
CREATE UNIQUE INDEX "ingestion_run_one_running" ON "ingest"."ingestion_run" USING btree ("source_id") WHERE status = 'running';