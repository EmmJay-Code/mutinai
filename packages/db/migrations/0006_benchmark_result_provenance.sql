-- Benchmark results gain explicit provenance: where they came from, what we are allowed to do with them, how the
-- subject was configured, and what the number is a fraction of. See docs/adr/0010-benchmark-results.md.
--
-- Structure first, then the backfill: every existing result becomes a single-result run attributed to the sample
-- catalog. The uniqueness key over (run, metric, subtask) is added last, because it cannot hold while run_id is
-- still null on every row. 0007 drops the columns that moved onto the run.

CREATE TYPE "ecosystem"."evaluation_prompt_mode" AS ENUM('unspecified', 'prompt', 'function_calling', 'agentic');--> statement-breakpoint
CREATE TYPE "ecosystem"."redistribution_permission" AS ENUM('permitted', 'attribution_required', 'unverified', 'prohibited');--> statement-breakpoint
CREATE TYPE "ecosystem"."rollup_method" AS ENUM('none', 'mean_of_subtasks', 'weighted_subtasks', 'pooled_samples');--> statement-breakpoint
CREATE TABLE "ecosystem"."benchmark_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"benchmark_id" uuid NOT NULL,
	"variant_id" uuid,
	"artifact_id" uuid,
	"config_id" uuid NOT NULL,
	"result_source_id" uuid NOT NULL,
	"source_ingestion_enabled" boolean DEFAULT true NOT NULL,
	"origin" "ecosystem"."result_origin" NOT NULL,
	"environment_id" uuid,
	"benchmark_version" text,
	"harness_name" text,
	"harness_version" text,
	"harness_commit" text,
	"measured_on" date,
	"citation_url" text,
	"reported_rollup_value" double precision,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text,
	"source_record_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "benchmark_run_dedupeKey_unique" UNIQUE("dedupe_key"),
	CONSTRAINT "benchmark_run_id_benchmark_key" UNIQUE("id","benchmark_id"),
	CONSTRAINT "benchmark_run_one_subject" CHECK (num_nonnulls("ecosystem"."benchmark_run"."variant_id", "ecosystem"."benchmark_run"."artifact_id") = 1),
	CONSTRAINT "benchmark_run_source_enabled" CHECK ("ecosystem"."benchmark_run"."source_ingestion_enabled")
);
--> statement-breakpoint
CREATE TABLE "ecosystem"."benchmark_subtask" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"benchmark_id" uuid NOT NULL,
	"parent_id" uuid,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"weight" real,
	"rollup_method" "ecosystem"."rollup_method",
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "benchmark_subtask_id_benchmark_key" UNIQUE("id","benchmark_id"),
	CONSTRAINT "benchmark_subtask_not_self" CHECK ("ecosystem"."benchmark_subtask"."parent_id" is null or "ecosystem"."benchmark_subtask"."parent_id" <> "ecosystem"."benchmark_subtask"."id"),
	CONSTRAINT "benchmark_subtask_weight_positive" CHECK ("ecosystem"."benchmark_subtask"."weight" is null or "ecosystem"."benchmark_subtask"."weight" > 0)
);
--> statement-breakpoint
CREATE TABLE "ecosystem"."evaluation_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text,
	"prompt_mode" "ecosystem"."evaluation_prompt_mode" DEFAULT 'unspecified' NOT NULL,
	"shots" integer,
	"chain_of_thought" boolean,
	"reasoning_enabled" boolean,
	"reasoning_effort" text,
	"thinking_token_budget" integer,
	"attempts" integer,
	"harness_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evaluation_config_key" UNIQUE NULLS NOT DISTINCT("prompt_mode","shots","chain_of_thought","reasoning_enabled","reasoning_effort","thinking_token_budget","attempts","harness_config"),
	CONSTRAINT "evaluation_config_shots_nonnegative" CHECK ("ecosystem"."evaluation_config"."shots" is null or "ecosystem"."evaluation_config"."shots" >= 0),
	CONSTRAINT "evaluation_config_attempts_positive" CHECK ("ecosystem"."evaluation_config"."attempts" is null or "ecosystem"."evaluation_config"."attempts" >= 1),
	CONSTRAINT "evaluation_config_thinking_budget_positive" CHECK ("ecosystem"."evaluation_config"."thinking_token_budget" is null or "ecosystem"."evaluation_config"."thinking_token_budget" > 0)
);
--> statement-breakpoint
CREATE TABLE "ecosystem"."result_source" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"publisher_org_id" uuid,
	"homepage_url" text,
	"dataset_url" text,
	"license_id" uuid,
	"license_url" text,
	"redistribution" "ecosystem"."redistribution_permission" DEFAULT 'unverified' NOT NULL,
	"attribution" text,
	"permission_note" text,
	"permission_checked_on" date,
	"ingestion_enabled" boolean DEFAULT false NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "result_source_key_unique" UNIQUE("key"),
	CONSTRAINT "result_source_id_enabled_key" UNIQUE("id","ingestion_enabled"),
	CONSTRAINT "result_source_permission_checked" CHECK ("ecosystem"."result_source"."ingestion_enabled" = false or "ecosystem"."result_source"."redistribution" in ('permitted', 'attribution_required')),
	CONSTRAINT "result_source_attribution_present" CHECK ("ecosystem"."result_source"."redistribution" <> 'attribution_required' or "ecosystem"."result_source"."attribution" is not null)
);
--> statement-breakpoint
ALTER TABLE "ecosystem"."benchmark_result" DROP CONSTRAINT "benchmark_result_one_subject";--> statement-breakpoint
ALTER TABLE "ecosystem"."benchmark_result" ALTER COLUMN "origin" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "ecosystem"."benchmark_run" ALTER COLUMN "origin" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "ecosystem"."result_origin";--> statement-breakpoint
CREATE TYPE "ecosystem"."result_origin" AS ENUM('benchmark_operator', 'third_party', 'submitted_registry', 'developer_reported', 'editorial');--> statement-breakpoint
ALTER TABLE "ecosystem"."benchmark_result" ALTER COLUMN "origin" SET DATA TYPE "ecosystem"."result_origin" USING "origin"::"ecosystem"."result_origin";--> statement-breakpoint
ALTER TABLE "ecosystem"."benchmark_run" ALTER COLUMN "origin" SET DATA TYPE "ecosystem"."result_origin" USING "origin"::"ecosystem"."result_origin";--> statement-breakpoint
ALTER TABLE "ecosystem"."benchmark_result" ALTER COLUMN "origin" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ecosystem"."benchmark" ADD COLUMN "headline_metric_id" uuid;--> statement-breakpoint
ALTER TABLE "ecosystem"."benchmark" ADD COLUMN "headline_config_id" uuid;--> statement-breakpoint
ALTER TABLE "ecosystem"."benchmark" ADD COLUMN "rollup_method" "ecosystem"."rollup_method" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "ecosystem"."benchmark_result" ADD COLUMN "run_id" uuid;--> statement-breakpoint
ALTER TABLE "ecosystem"."benchmark_result" ADD COLUMN "subtask_id" uuid;--> statement-breakpoint
ALTER TABLE "ecosystem"."benchmark_result" ADD COLUMN "sample_numerator" double precision;--> statement-breakpoint
ALTER TABLE "ecosystem"."benchmark_result" ADD COLUMN "sample_count" integer;--> statement-breakpoint
ALTER TABLE "ecosystem"."benchmark_metric" ADD CONSTRAINT "benchmark_metric_id_benchmark_key" UNIQUE("id","benchmark_id");--> statement-breakpoint
ALTER TABLE "ecosystem"."benchmark_run" ADD CONSTRAINT "benchmark_run_benchmark_id_benchmark_id_fk" FOREIGN KEY ("benchmark_id") REFERENCES "ecosystem"."benchmark"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."benchmark_run" ADD CONSTRAINT "benchmark_run_variant_id_model_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "ecosystem"."model_variant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."benchmark_run" ADD CONSTRAINT "benchmark_run_artifact_id_model_artifact_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "ecosystem"."model_artifact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."benchmark_run" ADD CONSTRAINT "benchmark_run_config_id_evaluation_config_id_fk" FOREIGN KEY ("config_id") REFERENCES "ecosystem"."evaluation_config"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."benchmark_run" ADD CONSTRAINT "benchmark_run_environment_id_run_environment_id_fk" FOREIGN KEY ("environment_id") REFERENCES "ecosystem"."run_environment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."benchmark_run" ADD CONSTRAINT "benchmark_run_source_record_id_source_record_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "ingest"."source_record"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."benchmark_run" ADD CONSTRAINT "benchmark_run_source_enabled_fk" FOREIGN KEY ("result_source_id","source_ingestion_enabled") REFERENCES "ecosystem"."result_source"("id","ingestion_enabled") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."benchmark_subtask" ADD CONSTRAINT "benchmark_subtask_benchmark_id_benchmark_id_fk" FOREIGN KEY ("benchmark_id") REFERENCES "ecosystem"."benchmark"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."benchmark_subtask" ADD CONSTRAINT "benchmark_subtask_parent_id_benchmark_subtask_id_fk" FOREIGN KEY ("parent_id") REFERENCES "ecosystem"."benchmark_subtask"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."result_source" ADD CONSTRAINT "result_source_publisher_org_id_organization_id_fk" FOREIGN KEY ("publisher_org_id") REFERENCES "ecosystem"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."result_source" ADD CONSTRAINT "result_source_license_id_license_id_fk" FOREIGN KEY ("license_id") REFERENCES "ecosystem"."license"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "benchmark_run_variant_idx" ON "ecosystem"."benchmark_run" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "benchmark_run_artifact_idx" ON "ecosystem"."benchmark_run" USING btree ("artifact_id");--> statement-breakpoint
CREATE INDEX "benchmark_run_benchmark_idx" ON "ecosystem"."benchmark_run" USING btree ("benchmark_id");--> statement-breakpoint
CREATE UNIQUE INDEX "benchmark_subtask_key" ON "ecosystem"."benchmark_subtask" USING btree ("benchmark_id","key");--> statement-breakpoint
CREATE INDEX "benchmark_subtask_parent_idx" ON "ecosystem"."benchmark_subtask" USING btree ("parent_id");--> statement-breakpoint
ALTER TABLE "ecosystem"."benchmark" ADD CONSTRAINT "benchmark_headline_metric_id_benchmark_metric_id_fk" FOREIGN KEY ("headline_metric_id") REFERENCES "ecosystem"."benchmark_metric"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."benchmark" ADD CONSTRAINT "benchmark_headline_config_id_evaluation_config_id_fk" FOREIGN KEY ("headline_config_id") REFERENCES "ecosystem"."evaluation_config"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."benchmark_result" ADD CONSTRAINT "benchmark_result_run_id_benchmark_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "ecosystem"."benchmark_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."benchmark_result" ADD CONSTRAINT "benchmark_result_subtask_id_benchmark_subtask_id_fk" FOREIGN KEY ("subtask_id") REFERENCES "ecosystem"."benchmark_subtask"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."benchmark_result" ADD CONSTRAINT "benchmark_result_run_benchmark_fk" FOREIGN KEY ("run_id","benchmark_id") REFERENCES "ecosystem"."benchmark_run"("id","benchmark_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."benchmark_result" ADD CONSTRAINT "benchmark_result_metric_benchmark_fk" FOREIGN KEY ("metric_id","benchmark_id") REFERENCES "ecosystem"."benchmark_metric"("id","benchmark_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."benchmark_result" ADD CONSTRAINT "benchmark_result_subtask_benchmark_fk" FOREIGN KEY ("subtask_id","benchmark_id") REFERENCES "ecosystem"."benchmark_subtask"("id","benchmark_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "benchmark_result_run_idx" ON "ecosystem"."benchmark_result" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "benchmark_result_metric_idx" ON "ecosystem"."benchmark_result" USING btree ("metric_id");--> statement-breakpoint
ALTER TABLE "ecosystem"."benchmark_result" ADD CONSTRAINT "benchmark_result_samples_paired" CHECK (("ecosystem"."benchmark_result"."sample_numerator" is null) = ("ecosystem"."benchmark_result"."sample_count" is null));--> statement-breakpoint
ALTER TABLE "ecosystem"."benchmark_result" ADD CONSTRAINT "benchmark_result_samples_in_range" CHECK ("ecosystem"."benchmark_result"."sample_count" is null or ("ecosystem"."benchmark_result"."sample_count" > 0 and "ecosystem"."benchmark_result"."sample_numerator" between 0 and "ecosystem"."benchmark_result"."sample_count"));
--> statement-breakpoint
-- The catalog's own results (the sample dataset, and anything measured editorially) get a source of their own, so
-- that every run points at a permission that has actually been established. Ranked below real sources.
INSERT INTO "ecosystem"."result_source" ("key", "name", "redistribution", "attribution", "permission_note", "ingestion_enabled", "priority")
VALUES (
  'mutinai-catalog',
  'Mutinai catalog',
  'permitted',
  NULL,
  'Results Mutinai holds itself: the sample catalog and editorial measurements. Nothing here is redistributed from a third party.',
  true,
  -100
)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint

-- One evaluation configuration per distinct legacy `evaluation_setting`. The free-text string is parsed once, here,
-- and is never parsed again: adapters write the structured columns directly.
INSERT INTO "ecosystem"."evaluation_config" ("label", "prompt_mode") VALUES (NULL, 'unspecified') ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "ecosystem"."evaluation_config" ("label", "prompt_mode", "shots", "chain_of_thought", "reasoning_enabled")
SELECT min(x."setting"), 'unspecified', x."shots", x."cot", x."thinking"
FROM (
  SELECT DISTINCT
    br."evaluation_setting" AS "setting",
    (regexp_match(br."evaluation_setting", '(\d+)[- ]shot'))[1]::int AS "shots",
    CASE WHEN br."evaluation_setting" ~* '(^|[^a-z])cot([^a-z]|$)|chain.of.thought' THEN true END AS "cot",
    CASE WHEN br."evaluation_setting" ~* 'thinking|reasoning' THEN true END AS "thinking"
  FROM "ecosystem"."benchmark_result" br
) x
GROUP BY x."shots", x."cot", x."thinking"
ON CONFLICT DO NOTHING;--> statement-breakpoint

-- Every existing result becomes part of a run. Results that shared a subject, environment, origin, setting and
-- snapshot were one measurement all along (llama-bench reports prompt and generation throughput together), so they
-- are grouped rather than split.
INSERT INTO "ecosystem"."benchmark_run" (
  "benchmark_id", "variant_id", "artifact_id", "config_id", "result_source_id", "origin", "environment_id",
  "measured_on", "citation_url", "raw", "source_record_id", "created_at")
SELECT g."benchmark_id", g."variant_id", g."artifact_id", c."id", src."id", g."origin", g."environment_id",
  g."measured_on", g."citation_url",
  CASE WHEN g."evaluation_setting" IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('evaluation_setting', g."evaluation_setting") END,
  g."source_record_id", g."created_at"
FROM (
  SELECT br."benchmark_id", br."variant_id", br."artifact_id", br."environment_id", br."origin",
    br."evaluation_setting", br."measured_on", br."citation_url", br."source_record_id", min(br."created_at") AS "created_at"
  FROM "ecosystem"."benchmark_result" br
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9
) g
CROSS JOIN LATERAL (SELECT "id" FROM "ecosystem"."result_source" WHERE "key" = 'mutinai-catalog') src
JOIN "ecosystem"."evaluation_config" c
  ON c."prompt_mode" = 'unspecified'
 AND c."shots" IS NOT DISTINCT FROM (regexp_match(g."evaluation_setting", '(\d+)[- ]shot'))[1]::int
 AND c."chain_of_thought" IS NOT DISTINCT FROM (CASE WHEN g."evaluation_setting" ~* '(^|[^a-z])cot([^a-z]|$)|chain.of.thought' THEN true END)
 AND c."reasoning_enabled" IS NOT DISTINCT FROM (CASE WHEN g."evaluation_setting" ~* 'thinking|reasoning' THEN true END)
 AND c."reasoning_effort" IS NULL AND c."thinking_token_budget" IS NULL AND c."attempts" IS NULL AND c."harness_config" = '{}'::jsonb;--> statement-breakpoint

UPDATE "ecosystem"."benchmark_result" br SET "run_id" = r."id"
FROM "ecosystem"."benchmark_run" r
WHERE br."run_id" IS NULL
  AND r."benchmark_id" = br."benchmark_id"
  AND r."variant_id" IS NOT DISTINCT FROM br."variant_id"
  AND r."artifact_id" IS NOT DISTINCT FROM br."artifact_id"
  AND r."environment_id" IS NOT DISTINCT FROM br."environment_id"
  AND r."origin" = br."origin"
  AND r."measured_on" IS NOT DISTINCT FROM br."measured_on"
  AND r."citation_url" IS NOT DISTINCT FROM br."citation_url"
  AND r."source_record_id" IS NOT DISTINCT FROM br."source_record_id"
  AND coalesce(r."raw"->>'evaluation_setting', '') = coalesce(br."evaluation_setting", '');--> statement-breakpoint

-- A benchmark that measures one thing can say which metric that is; llama-bench reports two and privileges neither.
UPDATE "ecosystem"."benchmark" b SET "headline_metric_id" = m."id"
FROM "ecosystem"."benchmark_metric" m
WHERE m."benchmark_id" = b."id"
  AND b."headline_metric_id" IS NULL
  AND (SELECT count(*) FROM "ecosystem"."benchmark_metric" m2 WHERE m2."benchmark_id" = b."id") = 1;--> statement-breakpoint

ALTER TABLE "ecosystem"."benchmark_result" ADD CONSTRAINT "benchmark_result_run_metric_subtask_key" UNIQUE NULLS NOT DISTINCT("run_id","metric_id","subtask_id");
