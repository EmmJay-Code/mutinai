-- The subject, origin, environment and provenance of a result now live on its run (0006 backfilled them), so the
-- columns come off `benchmark_result`, which is left holding only the measured fact.
--
-- The views below replace the reading that took `max(value)` per model and benchmark: that silently mixed metrics,
-- configurations and origins, and always returned the most flattering number. Selection is now by an explicit,
-- value-independent precedence, and headline numbers are computed from the stored subtask facts rather than read
-- from a leaderboard's own average. See docs/adr/0010-benchmark-results.md.

ALTER TABLE "ecosystem"."benchmark_result" DROP CONSTRAINT "benchmark_result_variant_id_model_variant_id_fk";
--> statement-breakpoint
ALTER TABLE "ecosystem"."benchmark_result" DROP CONSTRAINT "benchmark_result_artifact_id_model_artifact_id_fk";
--> statement-breakpoint
ALTER TABLE "ecosystem"."benchmark_result" DROP CONSTRAINT "benchmark_result_environment_id_run_environment_id_fk";
--> statement-breakpoint
ALTER TABLE "ecosystem"."benchmark_result" DROP CONSTRAINT "benchmark_result_source_record_id_source_record_id_fk";
--> statement-breakpoint
DROP INDEX "ecosystem"."benchmark_result_variant_idx";--> statement-breakpoint
DROP INDEX "ecosystem"."benchmark_result_artifact_idx";--> statement-breakpoint
ALTER TABLE "ecosystem"."benchmark_result" ALTER COLUMN "run_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ecosystem"."benchmark_result" DROP COLUMN "variant_id";--> statement-breakpoint
ALTER TABLE "ecosystem"."benchmark_result" DROP COLUMN "artifact_id";--> statement-breakpoint
ALTER TABLE "ecosystem"."benchmark_result" DROP COLUMN "environment_id";--> statement-breakpoint
ALTER TABLE "ecosystem"."benchmark_result" DROP COLUMN "evaluation_setting";--> statement-breakpoint
ALTER TABLE "ecosystem"."benchmark_result" DROP COLUMN "origin";--> statement-breakpoint
ALTER TABLE "ecosystem"."benchmark_result" DROP COLUMN "measured_on";--> statement-breakpoint
ALTER TABLE "ecosystem"."benchmark_result" DROP COLUMN "citation_url";--> statement-breakpoint
ALTER TABLE "ecosystem"."benchmark_result" DROP COLUMN "source_record_id";
--> statement-breakpoint
-- Precedence between sources reporting the same measurement. Deliberately not derived from the values: an
-- independent run outranks a claim by the party the claim flatters, whichever number is higher.
CREATE FUNCTION "ecosystem"."result_origin_rank"(o "ecosystem"."result_origin") RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE o
    WHEN 'benchmark_operator' THEN 0   -- the benchmark's maintainers ran every subject themselves
    WHEN 'third_party'        THEN 1   -- an independent evaluator ran it
    WHEN 'editorial'          THEN 2   -- Mutinai measured it
    WHEN 'submitted_registry' THEN 3   -- produced by a submitter, published by the benchmark
    WHEN 'developer_reported' THEN 4   -- reported by the party it describes
  END
$$;--> statement-breakpoint

-- One preferred row per measurement, keeping every conflicting report in the tables behind it. Configuration is
-- part of the key: Aider at one attempt and at two, or BFCL in function-calling and prompt mode, are different
-- measurements rather than disagreements.
CREATE VIEW "ecosystem"."benchmark_result_canonical" AS
SELECT DISTINCT ON (r."benchmark_id", run."variant_id", run."artifact_id", r."metric_id", r."subtask_id", run."config_id")
  r."id" AS "result_id", run."id" AS "run_id", r."benchmark_id", run."variant_id", run."artifact_id",
  r."metric_id", r."subtask_id", run."config_id", r."value", r."sample_numerator", r."sample_count",
  run."origin", run."result_source_id", run."measured_on",
  (count(*) OVER (PARTITION BY r."benchmark_id", run."variant_id", run."artifact_id", r."metric_id", r."subtask_id", run."config_id") - 1)::int AS "conflicting_count"
FROM "ecosystem"."benchmark_result" r
JOIN "ecosystem"."benchmark_run" run ON run."id" = r."run_id"
JOIN "ecosystem"."result_source" src ON src."id" = run."result_source_id"
ORDER BY r."benchmark_id", run."variant_id", run."artifact_id", r."metric_id", r."subtask_id", run."config_id",
  "ecosystem"."result_origin_rank"(run."origin"), src."priority" DESC, run."measured_on" DESC NULLS LAST,
  run."created_at" DESC, run."id";--> statement-breakpoint

-- A run's headline number, computed from its stored subtask facts. Subtasks may nest one level and each node
-- declares how its own children combine, because sources mix methods within one benchmark: BFCL takes an
-- unweighted mean over its non-live categories, a sample-weighted one over its live categories, and then a fixed
-- percentage weighting across the groups. Reproducing that is the whole reason the leaderboard's own averages are
-- kept out of `benchmark_result` and parked on the run as `reported_rollup_value` for reconciliation.
CREATE VIEW "ecosystem"."benchmark_run_rollup" AS
WITH "leaf" AS (
  SELECT r."run_id", r."benchmark_id", r."metric_id", r."value", r."sample_numerator", r."sample_count",
    coalesce(st."parent_id", st."id") AS "group_id", st."weight" AS "leaf_weight"
  FROM "ecosystem"."benchmark_result" r
  JOIN "ecosystem"."benchmark_subtask" st ON st."id" = r."subtask_id"
), "grouped" AS (
  SELECT l."run_id", l."benchmark_id", l."metric_id", l."group_id",
    coalesce(p."weight", 1)::double precision AS "group_weight",
    CASE coalesce(p."rollup_method", b."rollup_method")
      WHEN 'pooled_samples' THEN CASE WHEN sum(l."sample_count") > 0
        THEN (CASE WHEN bm."unit" = '%' THEN 100.0 ELSE 1.0 END) * sum(l."sample_numerator") / sum(l."sample_count") END
      WHEN 'weighted_subtasks' THEN sum(l."value" * coalesce(l."leaf_weight", 1)::double precision) / nullif(sum(coalesce(l."leaf_weight", 1)::double precision), 0)
      ELSE avg(l."value")
    END AS "value",
    sum(l."sample_numerator") AS "numerator", sum(l."sample_count") AS "count", count(*) AS "leaves"
  FROM "leaf" l
  JOIN "ecosystem"."benchmark" b ON b."id" = l."benchmark_id"
  JOIN "ecosystem"."benchmark_metric" bm ON bm."id" = l."metric_id"
  LEFT JOIN "ecosystem"."benchmark_subtask" p ON p."id" = l."group_id"
  GROUP BY l."run_id", l."benchmark_id", l."metric_id", l."group_id", p."weight", p."rollup_method", b."rollup_method", bm."unit"
)
SELECT g."run_id", g."benchmark_id", g."metric_id", b."rollup_method",
  CASE b."rollup_method"
    WHEN 'mean_of_subtasks' THEN avg(g."value")
    WHEN 'weighted_subtasks' THEN sum(g."value" * g."group_weight") / nullif(sum(g."group_weight"), 0)
    WHEN 'pooled_samples' THEN CASE WHEN sum(g."count") > 0
      THEN (CASE WHEN bm."unit" = '%' THEN 100.0 ELSE 1.0 END) * sum(g."numerator") / sum(g."count") END
  END AS "value",
  sum(g."leaves")::int AS "subtask_count",
  sum(g."numerator") AS "sample_numerator",
  sum(g."count")::int AS "sample_count",
  run."reported_rollup_value"
FROM "grouped" g
JOIN "ecosystem"."benchmark_run" run ON run."id" = g."run_id"
JOIN "ecosystem"."benchmark" b ON b."id" = g."benchmark_id"
JOIN "ecosystem"."benchmark_metric" bm ON bm."id" = g."metric_id"
WHERE b."rollup_method" <> 'none'
GROUP BY g."run_id", g."benchmark_id", g."metric_id", b."rollup_method", bm."unit", run."reported_rollup_value";
--> statement-breakpoint

-- One number per subject and benchmark for the surfaces that can only show one: the computed rollup where the
-- benchmark has subtasks, the whole-benchmark fact where it does not. Which metric and which configuration count
-- are declared by the benchmark, never inferred from which of them scored best — so a benchmark that privileges
-- no metric (llama-bench reports prompt and generation throughput) has no headline at all rather than an
-- arbitrary one.
CREATE VIEW "ecosystem"."benchmark_headline_result" AS
WITH "candidate" AS (
  SELECT run."id" AS "run_id", run."benchmark_id", run."variant_id", run."artifact_id", run."config_id",
    run."origin", run."measured_on", run."result_source_id", r."metric_id", r."value",
    r."sample_numerator", r."sample_count", false AS "computed"
  FROM "ecosystem"."benchmark_result" r
  JOIN "ecosystem"."benchmark_run" run ON run."id" = r."run_id"
  JOIN "ecosystem"."benchmark" b ON b."id" = run."benchmark_id"
  WHERE r."subtask_id" IS NULL AND r."metric_id" = b."headline_metric_id"
  UNION ALL
  SELECT run."id", run."benchmark_id", run."variant_id", run."artifact_id", run."config_id",
    run."origin", run."measured_on", run."result_source_id", ro."metric_id", ro."value",
    ro."sample_numerator", ro."sample_count", true
  FROM "ecosystem"."benchmark_run_rollup" ro
  JOIN "ecosystem"."benchmark_run" run ON run."id" = ro."run_id"
  JOIN "ecosystem"."benchmark" b ON b."id" = run."benchmark_id"
  WHERE ro."value" IS NOT NULL AND ro."metric_id" = b."headline_metric_id"
)
SELECT DISTINCT ON (c."benchmark_id", c."variant_id", c."artifact_id")
  c."benchmark_id", c."variant_id", c."artifact_id", c."run_id", c."config_id", c."metric_id",
  c."value", c."sample_numerator", c."sample_count", c."origin", c."result_source_id", c."measured_on", c."computed"
FROM "candidate" c
JOIN "ecosystem"."benchmark" b ON b."id" = c."benchmark_id"
JOIN "ecosystem"."result_source" src ON src."id" = c."result_source_id"
JOIN "ecosystem"."evaluation_config" cfg ON cfg."id" = c."config_id"
LEFT JOIN "ecosystem"."evaluation_config" hcfg ON hcfg."id" = b."headline_config_id"
ORDER BY c."benchmark_id", c."variant_id", c."artifact_id",
  -- The benchmark's headline configuration is a pattern, not one exact row: it fixes the dimension that decides
  -- which number the leaderboard prints (Aider's two attempts) and leaves the rest of the harness alone, so an
  -- entry run with a different edit format still counts as the headline.
  (hcfg."id" IS NOT NULL
    AND (hcfg."prompt_mode" = 'unspecified' OR cfg."prompt_mode" = hcfg."prompt_mode")
    AND (hcfg."shots" IS NULL OR cfg."shots" IS NOT DISTINCT FROM hcfg."shots")
    AND (hcfg."chain_of_thought" IS NULL OR cfg."chain_of_thought" IS NOT DISTINCT FROM hcfg."chain_of_thought")
    AND (hcfg."reasoning_enabled" IS NULL OR cfg."reasoning_enabled" IS NOT DISTINCT FROM hcfg."reasoning_enabled")
    AND (hcfg."reasoning_effort" IS NULL OR cfg."reasoning_effort" IS NOT DISTINCT FROM hcfg."reasoning_effort")
    AND (hcfg."thinking_token_budget" IS NULL OR cfg."thinking_token_budget" IS NOT DISTINCT FROM hcfg."thinking_token_budget")
    AND (hcfg."attempts" IS NULL OR cfg."attempts" IS NOT DISTINCT FROM hcfg."attempts")
    AND cfg."harness_config" @> hcfg."harness_config") DESC,
  "ecosystem"."result_origin_rank"(c."origin"), src."priority" DESC, c."measured_on" DESC NULLS LAST,
  c."metric_id", c."run_id";
