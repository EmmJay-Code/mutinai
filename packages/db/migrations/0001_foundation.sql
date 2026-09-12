CREATE SCHEMA "ecosystem";
--> statement-breakpoint
CREATE SCHEMA "ingest";
--> statement-breakpoint
CREATE SCHEMA "identity";
--> statement-breakpoint
CREATE SCHEMA "community";
--> statement-breakpoint
CREATE SCHEMA "jobs";
--> statement-breakpoint
CREATE TYPE "ecosystem"."architecture" AS ENUM('dense', 'moe');--> statement-breakpoint
CREATE TYPE "ecosystem"."benchmark_kind" AS ENUM('capability', 'performance');--> statement-breakpoint
CREATE TYPE "ecosystem"."capability" AS ENUM('chat', 'code', 'reasoning', 'vision', 'tool_use', 'long_context', 'multilingual');--> statement-breakpoint
CREATE TYPE "ecosystem"."commercial_use" AS ENUM('allowed', 'restricted', 'prohibited');--> statement-breakpoint
CREATE TYPE "ecosystem"."compute_backend" AS ENUM('cuda', 'rocm', 'metal', 'vulkan', 'cpu');--> statement-breakpoint
CREATE TYPE "ecosystem"."device_kind" AS ENUM('gpu', 'soc', 'cpu', 'accelerator');--> statement-breakpoint
CREATE TYPE "ecosystem"."entity_kind" AS ENUM('organization', 'model_family', 'model_release', 'model', 'model_variant', 'model_artifact', 'quantization_scheme', 'hardware_device', 'hardware_configuration', 'project', 'benchmark');--> statement-breakpoint
CREATE TYPE "ecosystem"."event_entity_role" AS ENUM('subject', 'related');--> statement-breakpoint
CREATE TYPE "ecosystem"."event_kind" AS ENUM('model_release', 'runtime_release', 'hardware_launch', 'benchmark_update', 'announcement');--> statement-breakpoint
CREATE TYPE "ecosystem"."memory_kind" AS ENUM('dedicated', 'unified', 'none');--> statement-breakpoint
CREATE TYPE "ecosystem"."organization_kind" AS ENUM('ai_lab', 'company', 'hardware_vendor', 'academic', 'community', 'individual');--> statement-breakpoint
CREATE TYPE "ecosystem"."project_category" AS ENUM('runtime', 'ui', 'agent', 'coding_assistant', 'fine_tuning', 'evaluation', 'gateway', 'library');--> statement-breakpoint
CREATE TYPE "ecosystem"."quantization_method" AS ENUM('native', 'k_quant', 'i_quant', 'legacy_gguf', 'awq', 'gptq', 'fp8', 'mlx', 'exl2');--> statement-breakpoint
CREATE TYPE "ecosystem"."relation_predicate" AS ENUM('fine_tuned_from', 'distilled_from', 'merged_from', 'successor_of', 'built_on', 'integrates_with', 'implements_benchmark');--> statement-breakpoint
CREATE TYPE "ecosystem"."result_origin" AS ENUM('developer_reported', 'third_party', 'editorial');--> statement-breakpoint
CREATE TYPE "ecosystem"."variant_kind" AS ENUM('base', 'instruct', 'reasoning', 'coder', 'vision', 'distill', 'fine_tune', 'merge');--> statement-breakpoint
CREATE TYPE "ecosystem"."weight_format" AS ENUM('safetensors', 'gguf', 'mlx', 'exl2');--> statement-breakpoint
CREATE TYPE "ingest"."ingestion_run_status" AS ENUM('running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "ingest"."source_kind" AS ENUM('huggingface', 'github', 'arxiv', 'rss', 'editorial', 'fixture');--> statement-breakpoint
CREATE TYPE "ingest"."source_record_status" AS ENUM('processed', 'unresolved', 'failed');--> statement-breakpoint
CREATE TYPE "identity"."role" AS ENUM('moderator', 'admin');--> statement-breakpoint
CREATE TYPE "community"."moderation_status" AS ENUM('pending', 'published', 'rejected', 'removed');--> statement-breakpoint
CREATE TYPE "community"."rating_dimension" AS ENUM('quality', 'coding', 'reasoning', 'agentic', 'speed', 'hardware_efficiency', 'reliability', 'ease_of_setup', 'value');--> statement-breakpoint
CREATE TYPE "community"."verification_state" AS ENUM('unverified', 'verified', 'disputed');--> statement-breakpoint
CREATE TYPE "community"."visibility" AS ENUM('public', 'unlisted', 'private');--> statement-breakpoint
CREATE TYPE "jobs"."job_status" AS ENUM('pending', 'running', 'succeeded', 'failed', 'dead');--> statement-breakpoint
CREATE TABLE "ecosystem"."benchmark" (
	"id" uuid PRIMARY KEY NOT NULL,
	"benchmark_kind" "ecosystem"."benchmark_kind" NOT NULL,
	"homepage_url" text,
	"methodology" text
);
--> statement-breakpoint
CREATE TABLE "ecosystem"."benchmark_metric" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"benchmark_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"unit" text NOT NULL,
	"higher_is_better" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ecosystem"."benchmark_result" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"benchmark_id" uuid NOT NULL,
	"metric_id" uuid NOT NULL,
	"variant_id" uuid,
	"artifact_id" uuid,
	"environment_id" uuid,
	"value" double precision NOT NULL,
	"evaluation_setting" text,
	"origin" "ecosystem"."result_origin" NOT NULL,
	"measured_on" date,
	"citation_url" text,
	"source_record_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "benchmark_result_one_subject" CHECK (num_nonnulls("ecosystem"."benchmark_result"."variant_id", "ecosystem"."benchmark_result"."artifact_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "ecosystem"."derived_content" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"content_kind" text NOT NULL,
	"body" text NOT NULL,
	"generator" text NOT NULL,
	"generator_version" text NOT NULL,
	"input_source_record_ids" uuid[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ecosystem"."entity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "ecosystem"."entity_kind" NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"summary" text,
	"search_text" text DEFAULT '' NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple', "ecosystem"."entity"."name"), 'A') || setweight(to_tsvector('simple', "ecosystem"."entity"."search_text"), 'B') || setweight(to_tsvector('english', coalesce("ecosystem"."entity"."summary", '')), 'C')) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ecosystem"."entity_alias" (
	"entity_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"normalized" text NOT NULL,
	CONSTRAINT "entity_alias_entity_id_normalized_pk" PRIMARY KEY("entity_id","normalized")
);
--> statement-breakpoint
CREATE TABLE "ecosystem"."entity_relation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" uuid NOT NULL,
	"predicate" "ecosystem"."relation_predicate" NOT NULL,
	"object_id" uuid NOT NULL,
	"source_record_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_relation_not_self" CHECK ("ecosystem"."entity_relation"."subject_id" <> "ecosystem"."entity_relation"."object_id")
);
--> statement-breakpoint
CREATE TABLE "ecosystem"."event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_kind" "ecosystem"."event_kind" NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"url" text,
	"dedupe_key" text,
	"source_record_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_dedupeKey_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "ecosystem"."event_entity" (
	"event_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"role" "ecosystem"."event_entity_role" DEFAULT 'subject' NOT NULL,
	CONSTRAINT "event_entity_event_id_entity_id_pk" PRIMARY KEY("event_id","entity_id")
);
--> statement-breakpoint
CREATE TABLE "ecosystem"."hardware_configuration" (
	"id" uuid PRIMARY KEY NOT NULL,
	"form_factor" text NOT NULL,
	"system_ram_gb" real DEFAULT 0 NOT NULL,
	"system_ram_bandwidth_gbps" real,
	"unified_memory_gb" real,
	"approx_price_usd" integer
);
--> statement-breakpoint
CREATE TABLE "ecosystem"."hardware_configuration_component" (
	"configuration_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "hardware_configuration_component_configuration_id_device_id_pk" PRIMARY KEY("configuration_id","device_id"),
	CONSTRAINT "component_count_positive" CHECK ("ecosystem"."hardware_configuration_component"."count" > 0)
);
--> statement-breakpoint
CREATE TABLE "ecosystem"."hardware_device" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vendor_org_id" uuid NOT NULL,
	"device_kind" "ecosystem"."device_kind" NOT NULL,
	"memory_kind" "ecosystem"."memory_kind" NOT NULL,
	"memory_gb" real,
	"memory_type" text,
	"memory_bandwidth_gbps" real,
	"unified_usable_fraction" real,
	"backends" "ecosystem"."compute_backend"[] NOT NULL,
	"tdp_watts" integer,
	"released_on" date,
	"launch_price_usd" integer,
	CONSTRAINT "hardware_device_dedicated_memory" CHECK (("ecosystem"."hardware_device"."memory_kind" = 'dedicated') = ("ecosystem"."hardware_device"."memory_gb" is not null))
);
--> statement-breakpoint
CREATE TABLE "ecosystem"."license" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"spdx_id" text,
	"osi_approved" boolean DEFAULT false NOT NULL,
	"commercial_use" "ecosystem"."commercial_use" NOT NULL,
	"url" text,
	CONSTRAINT "license_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "ecosystem"."model" (
	"id" uuid PRIMARY KEY NOT NULL,
	"release_id" uuid NOT NULL,
	"architecture" "ecosystem"."architecture" NOT NULL,
	"params_total" bigint NOT NULL,
	"params_active" bigint,
	"layers" integer NOT NULL,
	"attention_heads" integer NOT NULL,
	"kv_heads" integer NOT NULL,
	"head_dim" integer NOT NULL,
	"kv_bytes_per_token_override" integer,
	"context_length" integer NOT NULL,
	CONSTRAINT "model_moe_active_params" CHECK (("ecosystem"."model"."architecture" = 'moe') = ("ecosystem"."model"."params_active" is not null)),
	CONSTRAINT "model_positive_dims" CHECK ("ecosystem"."model"."params_total" > 0 and "ecosystem"."model"."layers" > 0 and "ecosystem"."model"."kv_heads" > 0 and "ecosystem"."model"."head_dim" > 0 and "ecosystem"."model"."context_length" > 0)
);
--> statement-breakpoint
CREATE TABLE "ecosystem"."model_artifact" (
	"id" uuid PRIMARY KEY NOT NULL,
	"variant_id" uuid NOT NULL,
	"scheme_id" uuid NOT NULL,
	"publisher_org_id" uuid NOT NULL,
	"format" "ecosystem"."weight_format" NOT NULL,
	"size_bytes" bigint,
	"source_repo" text
);
--> statement-breakpoint
CREATE TABLE "ecosystem"."model_family" (
	"id" uuid PRIMARY KEY NOT NULL,
	"developer_org_id" uuid NOT NULL,
	"parent_family_id" uuid
);
--> statement-breakpoint
CREATE TABLE "ecosystem"."model_release" (
	"id" uuid PRIMARY KEY NOT NULL,
	"family_id" uuid NOT NULL,
	"released_on" date,
	"default_license_id" uuid,
	"announcement_url" text
);
--> statement-breakpoint
CREATE TABLE "ecosystem"."model_variant" (
	"id" uuid PRIMARY KEY NOT NULL,
	"model_id" uuid NOT NULL,
	"variant_kind" "ecosystem"."variant_kind" NOT NULL,
	"publisher_org_id" uuid NOT NULL,
	"license_id" uuid,
	"capabilities" "ecosystem"."capability"[] DEFAULT '{}' NOT NULL,
	"released_on" date
);
--> statement-breakpoint
CREATE TABLE "ecosystem"."organization" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_kind" "ecosystem"."organization_kind" NOT NULL,
	"website_url" text,
	"country" text
);
--> statement-breakpoint
CREATE TABLE "ecosystem"."project" (
	"id" uuid PRIMARY KEY NOT NULL,
	"category" "ecosystem"."project_category" NOT NULL,
	"maintainer_org_id" uuid,
	"license_id" uuid,
	"repo_url" text,
	"homepage_url" text,
	"primary_language" text
);
--> statement-breakpoint
CREATE TABLE "ecosystem"."quantization_scheme" (
	"id" uuid PRIMARY KEY NOT NULL,
	"method" "ecosystem"."quantization_method" NOT NULL,
	"format" "ecosystem"."weight_format" NOT NULL,
	"bits_per_weight" real NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ecosystem"."run_environment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hardware_configuration_id" uuid,
	"user_hardware_config_id" uuid,
	"runtime_id" uuid NOT NULL,
	"runtime_version" text,
	"backend" "ecosystem"."compute_backend" NOT NULL,
	"context_length" integer,
	"prompt_tokens" integer,
	"generation_tokens" integer,
	"batch_size" integer,
	"gpu_layers" integer,
	"kv_cache_type" text,
	"flash_attention" boolean,
	"os" text,
	"driver_version" text,
	"parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_environment_one_hardware" CHECK (num_nonnulls("ecosystem"."run_environment"."hardware_configuration_id", "ecosystem"."run_environment"."user_hardware_config_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "ecosystem"."runtime" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"formats" "ecosystem"."weight_format"[] NOT NULL,
	"backends" "ecosystem"."compute_backend"[] NOT NULL,
	"supports_offload" boolean NOT NULL,
	"supports_multi_gpu" boolean NOT NULL,
	"openai_compatible_api" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingest"."external_identifier" (
	"namespace" text NOT NULL,
	"value" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"url" text,
	"first_seen_record_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_identifier_namespace_value_pk" PRIMARY KEY("namespace","value")
);
--> statement-breakpoint
CREATE TABLE "ingest"."field_assertion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"field" text NOT NULL,
	"value" jsonb NOT NULL,
	"source_record_id" uuid NOT NULL,
	"applied" integer DEFAULT 0 NOT NULL,
	"asserted_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingest"."ingestion_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"status" "ingest"."ingestion_run_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "ingest"."source" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"kind" "ingest"."source_kind" NOT NULL,
	"base_url" text,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "ingest"."source_record" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"content_hash" text NOT NULL,
	"object_key" text NOT NULL,
	"content_type" text NOT NULL,
	"url" text,
	"fetched_at" timestamp with time zone NOT NULL,
	"status" "ingest"."source_record_status" NOT NULL,
	"status_detail" text,
	"run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_provider" text NOT NULL,
	"auth_subject" text NOT NULL,
	"email" text,
	"email_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."account_preference" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"allow_ai_training_use" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."account_role" (
	"account_id" uuid NOT NULL,
	"role" "identity"."role" NOT NULL,
	CONSTRAINT "account_role_account_id_role_pk" PRIMARY KEY("account_id","role")
);
--> statement-breakpoint
CREATE TABLE "identity"."session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "session_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "community"."benchmark_submission" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submitter_profile_id" uuid NOT NULL,
	"artifact_id" uuid NOT NULL,
	"benchmark_id" uuid NOT NULL,
	"environment_id" uuid NOT NULL,
	"notes" text,
	"visibility" "community"."visibility" DEFAULT 'public' NOT NULL,
	"status" "community"."moderation_status" DEFAULT 'published' NOT NULL,
	"verification" "community"."verification_state" DEFAULT 'unverified' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "benchmark_submission_environmentId_unique" UNIQUE("environment_id")
);
--> statement-breakpoint
CREATE TABLE "community"."profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"handle" text NOT NULL,
	"display_name" text NOT NULL,
	"bio" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_accountId_unique" UNIQUE("account_id")
);
--> statement-breakpoint
CREATE TABLE "community"."review" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_profile_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"hardware_configuration_id" uuid,
	"visibility" "community"."visibility" DEFAULT 'public' NOT NULL,
	"status" "community"."moderation_status" DEFAULT 'published' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community"."review_rating" (
	"review_id" uuid NOT NULL,
	"dimension" "community"."rating_dimension" NOT NULL,
	"score" smallint NOT NULL,
	CONSTRAINT "review_rating_review_id_dimension_pk" PRIMARY KEY("review_id","dimension"),
	CONSTRAINT "review_rating_range" CHECK ("community"."review_rating"."score" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "community"."submission_measurement" (
	"submission_id" uuid NOT NULL,
	"metric_id" uuid NOT NULL,
	"value" double precision NOT NULL,
	CONSTRAINT "submission_measurement_submission_id_metric_id_pk" PRIMARY KEY("submission_id","metric_id")
);
--> statement-breakpoint
CREATE TABLE "community"."user_hardware_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_profile_id" uuid NOT NULL,
	"name" text NOT NULL,
	"system_ram_gb" real DEFAULT 0 NOT NULL,
	"system_ram_bandwidth_gbps" real,
	"unified_memory_gb" real,
	"visibility" "community"."visibility" DEFAULT 'private' NOT NULL,
	"status" "community"."moderation_status" DEFAULT 'published' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community"."user_hardware_config_component" (
	"config_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "user_hardware_config_component_config_id_device_id_pk" PRIMARY KEY("config_id","device_id"),
	CONSTRAINT "user_component_count_positive" CHECK ("community"."user_hardware_config_component"."count" > 0)
);
--> statement-breakpoint
CREATE TABLE "community"."vote" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"voter_profile_id" uuid NOT NULL,
	"review_id" uuid,
	"submission_id" uuid,
	"value" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vote_one_target" CHECK (num_nonnulls("community"."vote"."review_id", "community"."vote"."submission_id") = 1),
	CONSTRAINT "vote_value" CHECK ("community"."vote"."value" in (-1, 1))
);
--> statement-breakpoint
CREATE TABLE "jobs"."job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"queue" text DEFAULT 'default' NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "jobs"."job_status" DEFAULT 'pending' NOT NULL,
	"dedupe_key" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ecosystem"."benchmark" ADD CONSTRAINT "benchmark_id_entity_id_fk" FOREIGN KEY ("id") REFERENCES "ecosystem"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."benchmark_metric" ADD CONSTRAINT "benchmark_metric_benchmark_id_benchmark_id_fk" FOREIGN KEY ("benchmark_id") REFERENCES "ecosystem"."benchmark"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."benchmark_result" ADD CONSTRAINT "benchmark_result_benchmark_id_benchmark_id_fk" FOREIGN KEY ("benchmark_id") REFERENCES "ecosystem"."benchmark"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."benchmark_result" ADD CONSTRAINT "benchmark_result_metric_id_benchmark_metric_id_fk" FOREIGN KEY ("metric_id") REFERENCES "ecosystem"."benchmark_metric"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."benchmark_result" ADD CONSTRAINT "benchmark_result_variant_id_model_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "ecosystem"."model_variant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."benchmark_result" ADD CONSTRAINT "benchmark_result_artifact_id_model_artifact_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "ecosystem"."model_artifact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."benchmark_result" ADD CONSTRAINT "benchmark_result_environment_id_run_environment_id_fk" FOREIGN KEY ("environment_id") REFERENCES "ecosystem"."run_environment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."benchmark_result" ADD CONSTRAINT "benchmark_result_source_record_id_source_record_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "ingest"."source_record"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."derived_content" ADD CONSTRAINT "derived_content_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "ecosystem"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."entity_alias" ADD CONSTRAINT "entity_alias_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "ecosystem"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."entity_relation" ADD CONSTRAINT "entity_relation_subject_id_entity_id_fk" FOREIGN KEY ("subject_id") REFERENCES "ecosystem"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."entity_relation" ADD CONSTRAINT "entity_relation_object_id_entity_id_fk" FOREIGN KEY ("object_id") REFERENCES "ecosystem"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."entity_relation" ADD CONSTRAINT "entity_relation_source_record_id_source_record_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "ingest"."source_record"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."event" ADD CONSTRAINT "event_source_record_id_source_record_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "ingest"."source_record"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."event_entity" ADD CONSTRAINT "event_entity_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "ecosystem"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."event_entity" ADD CONSTRAINT "event_entity_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "ecosystem"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."hardware_configuration" ADD CONSTRAINT "hardware_configuration_id_entity_id_fk" FOREIGN KEY ("id") REFERENCES "ecosystem"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."hardware_configuration_component" ADD CONSTRAINT "hardware_configuration_component_configuration_id_hardware_configuration_id_fk" FOREIGN KEY ("configuration_id") REFERENCES "ecosystem"."hardware_configuration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."hardware_configuration_component" ADD CONSTRAINT "hardware_configuration_component_device_id_hardware_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "ecosystem"."hardware_device"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."hardware_device" ADD CONSTRAINT "hardware_device_id_entity_id_fk" FOREIGN KEY ("id") REFERENCES "ecosystem"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."hardware_device" ADD CONSTRAINT "hardware_device_vendor_org_id_organization_id_fk" FOREIGN KEY ("vendor_org_id") REFERENCES "ecosystem"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."model" ADD CONSTRAINT "model_id_entity_id_fk" FOREIGN KEY ("id") REFERENCES "ecosystem"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."model" ADD CONSTRAINT "model_release_id_model_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "ecosystem"."model_release"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."model_artifact" ADD CONSTRAINT "model_artifact_id_entity_id_fk" FOREIGN KEY ("id") REFERENCES "ecosystem"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."model_artifact" ADD CONSTRAINT "model_artifact_variant_id_model_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "ecosystem"."model_variant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."model_artifact" ADD CONSTRAINT "model_artifact_scheme_id_quantization_scheme_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "ecosystem"."quantization_scheme"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."model_artifact" ADD CONSTRAINT "model_artifact_publisher_org_id_organization_id_fk" FOREIGN KEY ("publisher_org_id") REFERENCES "ecosystem"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."model_family" ADD CONSTRAINT "model_family_id_entity_id_fk" FOREIGN KEY ("id") REFERENCES "ecosystem"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."model_family" ADD CONSTRAINT "model_family_developer_org_id_organization_id_fk" FOREIGN KEY ("developer_org_id") REFERENCES "ecosystem"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."model_family" ADD CONSTRAINT "model_family_parent_family_id_model_family_id_fk" FOREIGN KEY ("parent_family_id") REFERENCES "ecosystem"."model_family"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."model_release" ADD CONSTRAINT "model_release_id_entity_id_fk" FOREIGN KEY ("id") REFERENCES "ecosystem"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."model_release" ADD CONSTRAINT "model_release_family_id_model_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "ecosystem"."model_family"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."model_release" ADD CONSTRAINT "model_release_default_license_id_license_id_fk" FOREIGN KEY ("default_license_id") REFERENCES "ecosystem"."license"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."model_variant" ADD CONSTRAINT "model_variant_id_entity_id_fk" FOREIGN KEY ("id") REFERENCES "ecosystem"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."model_variant" ADD CONSTRAINT "model_variant_model_id_model_id_fk" FOREIGN KEY ("model_id") REFERENCES "ecosystem"."model"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."model_variant" ADD CONSTRAINT "model_variant_publisher_org_id_organization_id_fk" FOREIGN KEY ("publisher_org_id") REFERENCES "ecosystem"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."model_variant" ADD CONSTRAINT "model_variant_license_id_license_id_fk" FOREIGN KEY ("license_id") REFERENCES "ecosystem"."license"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."organization" ADD CONSTRAINT "organization_id_entity_id_fk" FOREIGN KEY ("id") REFERENCES "ecosystem"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."project" ADD CONSTRAINT "project_id_entity_id_fk" FOREIGN KEY ("id") REFERENCES "ecosystem"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."project" ADD CONSTRAINT "project_maintainer_org_id_organization_id_fk" FOREIGN KEY ("maintainer_org_id") REFERENCES "ecosystem"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."project" ADD CONSTRAINT "project_license_id_license_id_fk" FOREIGN KEY ("license_id") REFERENCES "ecosystem"."license"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."quantization_scheme" ADD CONSTRAINT "quantization_scheme_id_entity_id_fk" FOREIGN KEY ("id") REFERENCES "ecosystem"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."run_environment" ADD CONSTRAINT "run_environment_hardware_configuration_id_hardware_configuration_id_fk" FOREIGN KEY ("hardware_configuration_id") REFERENCES "ecosystem"."hardware_configuration"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."run_environment" ADD CONSTRAINT "run_environment_user_hardware_config_id_user_hardware_config_id_fk" FOREIGN KEY ("user_hardware_config_id") REFERENCES "community"."user_hardware_config"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."run_environment" ADD CONSTRAINT "run_environment_runtime_id_runtime_project_id_fk" FOREIGN KEY ("runtime_id") REFERENCES "ecosystem"."runtime"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem"."runtime" ADD CONSTRAINT "runtime_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "ecosystem"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest"."external_identifier" ADD CONSTRAINT "external_identifier_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "ecosystem"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest"."external_identifier" ADD CONSTRAINT "external_identifier_first_seen_record_id_source_record_id_fk" FOREIGN KEY ("first_seen_record_id") REFERENCES "ingest"."source_record"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest"."field_assertion" ADD CONSTRAINT "field_assertion_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "ecosystem"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest"."field_assertion" ADD CONSTRAINT "field_assertion_source_record_id_source_record_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "ingest"."source_record"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest"."ingestion_run" ADD CONSTRAINT "ingestion_run_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest"."source_record" ADD CONSTRAINT "source_record_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest"."source_record" ADD CONSTRAINT "source_record_run_id_ingestion_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "ingest"."ingestion_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."account_preference" ADD CONSTRAINT "account_preference_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "identity"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."account_role" ADD CONSTRAINT "account_role_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "identity"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."session" ADD CONSTRAINT "session_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "identity"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community"."benchmark_submission" ADD CONSTRAINT "benchmark_submission_submitter_profile_id_profile_id_fk" FOREIGN KEY ("submitter_profile_id") REFERENCES "community"."profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community"."benchmark_submission" ADD CONSTRAINT "benchmark_submission_artifact_id_model_artifact_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "ecosystem"."model_artifact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community"."benchmark_submission" ADD CONSTRAINT "benchmark_submission_benchmark_id_benchmark_id_fk" FOREIGN KEY ("benchmark_id") REFERENCES "ecosystem"."benchmark"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community"."benchmark_submission" ADD CONSTRAINT "benchmark_submission_environment_id_run_environment_id_fk" FOREIGN KEY ("environment_id") REFERENCES "ecosystem"."run_environment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community"."profile" ADD CONSTRAINT "profile_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "identity"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community"."review" ADD CONSTRAINT "review_author_profile_id_profile_id_fk" FOREIGN KEY ("author_profile_id") REFERENCES "community"."profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community"."review" ADD CONSTRAINT "review_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "ecosystem"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community"."review" ADD CONSTRAINT "review_hardware_configuration_id_hardware_configuration_id_fk" FOREIGN KEY ("hardware_configuration_id") REFERENCES "ecosystem"."hardware_configuration"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community"."review_rating" ADD CONSTRAINT "review_rating_review_id_review_id_fk" FOREIGN KEY ("review_id") REFERENCES "community"."review"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community"."submission_measurement" ADD CONSTRAINT "submission_measurement_submission_id_benchmark_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "community"."benchmark_submission"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community"."submission_measurement" ADD CONSTRAINT "submission_measurement_metric_id_benchmark_metric_id_fk" FOREIGN KEY ("metric_id") REFERENCES "ecosystem"."benchmark_metric"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community"."user_hardware_config" ADD CONSTRAINT "user_hardware_config_owner_profile_id_profile_id_fk" FOREIGN KEY ("owner_profile_id") REFERENCES "community"."profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community"."user_hardware_config_component" ADD CONSTRAINT "user_hardware_config_component_config_id_user_hardware_config_id_fk" FOREIGN KEY ("config_id") REFERENCES "community"."user_hardware_config"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community"."user_hardware_config_component" ADD CONSTRAINT "user_hardware_config_component_device_id_hardware_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "ecosystem"."hardware_device"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community"."vote" ADD CONSTRAINT "vote_voter_profile_id_profile_id_fk" FOREIGN KEY ("voter_profile_id") REFERENCES "community"."profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community"."vote" ADD CONSTRAINT "vote_review_id_review_id_fk" FOREIGN KEY ("review_id") REFERENCES "community"."review"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community"."vote" ADD CONSTRAINT "vote_submission_id_benchmark_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "community"."benchmark_submission"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "benchmark_metric_key" ON "ecosystem"."benchmark_metric" USING btree ("benchmark_id","key");--> statement-breakpoint
CREATE INDEX "benchmark_result_variant_idx" ON "ecosystem"."benchmark_result" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "benchmark_result_artifact_idx" ON "ecosystem"."benchmark_result" USING btree ("artifact_id");--> statement-breakpoint
CREATE INDEX "derived_content_entity_idx" ON "ecosystem"."derived_content" USING btree ("entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_kind_slug_key" ON "ecosystem"."entity" USING btree ("kind","slug");--> statement-breakpoint
CREATE INDEX "entity_search_vector_idx" ON "ecosystem"."entity" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "entity_name_trgm_idx" ON "ecosystem"."entity" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "entity_alias_normalized_idx" ON "ecosystem"."entity_alias" USING btree ("normalized");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_relation_key" ON "ecosystem"."entity_relation" USING btree ("subject_id","predicate","object_id");--> statement-breakpoint
CREATE INDEX "entity_relation_object_idx" ON "ecosystem"."entity_relation" USING btree ("object_id");--> statement-breakpoint
CREATE INDEX "event_occurred_idx" ON "ecosystem"."event" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "event_entity_entity_idx" ON "ecosystem"."event_entity" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "model_release_idx" ON "ecosystem"."model" USING btree ("release_id");--> statement-breakpoint
CREATE UNIQUE INDEX "model_artifact_variant_scheme_publisher_key" ON "ecosystem"."model_artifact" USING btree ("variant_id","scheme_id","publisher_org_id");--> statement-breakpoint
CREATE INDEX "model_artifact_variant_idx" ON "ecosystem"."model_artifact" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "model_release_family_idx" ON "ecosystem"."model_release" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "model_variant_model_idx" ON "ecosystem"."model_variant" USING btree ("model_id");--> statement-breakpoint
CREATE INDEX "run_environment_hw_idx" ON "ecosystem"."run_environment" USING btree ("hardware_configuration_id");--> statement-breakpoint
CREATE INDEX "external_identifier_entity_idx" ON "ingest"."external_identifier" USING btree ("entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "field_assertion_key" ON "ingest"."field_assertion" USING btree ("entity_id","field","source_record_id");--> statement-breakpoint
CREATE INDEX "field_assertion_entity_field_idx" ON "ingest"."field_assertion" USING btree ("entity_id","field");--> statement-breakpoint
CREATE UNIQUE INDEX "source_record_snapshot_key" ON "ingest"."source_record" USING btree ("source_id","external_id","content_hash");--> statement-breakpoint
CREATE INDEX "source_record_latest_idx" ON "ingest"."source_record" USING btree ("source_id","external_id","fetched_at");--> statement-breakpoint
CREATE UNIQUE INDEX "account_auth_key" ON "identity"."account" USING btree ("auth_provider","auth_subject");--> statement-breakpoint
CREATE INDEX "submission_artifact_idx" ON "community"."benchmark_submission" USING btree ("artifact_id");--> statement-breakpoint
CREATE INDEX "submission_submitter_idx" ON "community"."benchmark_submission" USING btree ("submitter_profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "profile_handle_key" ON "community"."profile" USING btree (lower("handle"));--> statement-breakpoint
CREATE UNIQUE INDEX "review_author_entity_key" ON "community"."review" USING btree ("author_profile_id","entity_id");--> statement-breakpoint
CREATE INDEX "review_entity_idx" ON "community"."review" USING btree ("entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vote_voter_review_key" ON "community"."vote" USING btree ("voter_profile_id","review_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vote_voter_submission_key" ON "community"."vote" USING btree ("voter_profile_id","submission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_active_dedupe_key" ON "jobs"."job" USING btree ("dedupe_key") WHERE status in ('pending', 'running');--> statement-breakpoint
CREATE INDEX "job_claim_idx" ON "jobs"."job" USING btree ("queue","status","run_after");