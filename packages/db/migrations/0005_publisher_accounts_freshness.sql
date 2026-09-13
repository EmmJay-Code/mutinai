ALTER TABLE "ecosystem"."organization" ADD COLUMN "recognized" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Recognized organizations: the editorial catalog's, and any organization that develops a model family, makes hardware
-- or maintains a project. Accounts recorded by ingestion as publishers of derivatives stay unrecognized (ADR-0009).
UPDATE "ecosystem"."organization" o SET "recognized" = true
WHERE EXISTS (
    SELECT 1 FROM "ingest"."external_identifier" x
    JOIN "ingest"."source_record" sr ON sr."id" = x."first_seen_record_id"
    JOIN "ingest"."source" s ON s."id" = sr."source_id"
    WHERE x."entity_id" = o."id" AND s."key" = 'mutinai-fixtures')
  OR EXISTS (SELECT 1 FROM "ecosystem"."model_family" f WHERE f."developer_org_id" = o."id")
  OR EXISTS (SELECT 1 FROM "ecosystem"."hardware_device" d WHERE d."vendor_org_id" = o."id")
  OR EXISTS (SELECT 1 FROM "ecosystem"."project" p WHERE p."maintainer_org_id" = o."id");--> statement-breakpoint
-- Community "fine-tunes" that repeat their base's repository name are re-uploads, not new variants. Remove the ones live
-- ingestion created that nothing else references, and mark their snapshots unresolved so the next scheduled run
-- re-evaluates them under the re-upload rule. The snapshots themselves (provenance) are kept.
WITH reupload AS (
  SELECT v."id" AS variant_id, x."first_seen_record_id" AS record_id
  FROM "ecosystem"."model_variant" v
  JOIN "ingest"."external_identifier" x ON x."entity_id" = v."id" AND x."namespace" = 'huggingface'
  JOIN "ingest"."source_record" sr ON sr."id" = x."first_seen_record_id"
  JOIN "ingest"."source" s ON s."id" = sr."source_id" AND s."kind" <> 'fixture'
  JOIN "ecosystem"."entity_relation" rel ON rel."subject_id" = v."id" AND rel."predicate" IN ('fine_tuned_from', 'merged_from', 'distilled_from')
  JOIN "ingest"."external_identifier" bx ON bx."entity_id" = rel."object_id" AND bx."namespace" = 'huggingface'
  WHERE regexp_replace(lower(split_part(x."value", '/', 2)), '[^a-z0-9]', '', 'g') = regexp_replace(lower(split_part(bx."value", '/', 2)), '[^a-z0-9]', '', 'g')
    AND lower(split_part(x."value", '/', 1)) <> lower(split_part(bx."value", '/', 1))
    AND NOT EXISTS (SELECT 1 FROM "ecosystem"."model_artifact" a WHERE a."variant_id" = v."id")
    AND NOT EXISTS (SELECT 1 FROM "ecosystem"."benchmark_result" br WHERE br."variant_id" = v."id")
    AND NOT EXISTS (SELECT 1 FROM "community"."review" rv WHERE rv."entity_id" = v."id")
), marked AS (
  UPDATE "ingest"."source_record" sr SET "status" = 'unresolved', "status_detail" = 'Re-upload of its declared base; re-evaluated by the next run'
  FROM reupload WHERE sr."id" = reupload.record_id RETURNING sr."id"
)
DELETE FROM "ecosystem"."entity" e USING reupload WHERE e."id" = reupload.variant_id;--> statement-breakpoint
-- GitHub release titles and summaries are now composed differently. Dropping the stored validators makes the next run
-- fetch every repository again, so its events are rewritten by the pipeline instead of by hand.
DELETE FROM "ingest"."http_validator" WHERE "source_id" IN (SELECT "id" FROM "ingest"."source" WHERE "key" = 'github');
