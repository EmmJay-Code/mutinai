import { compatQueries, getDb } from '@mutinai/db';
import type { NextRequest } from 'next/server';
import { notFoundJson, publicJson } from '@/lib/api';
import { measurementPolicy } from '@/lib/community-visibility';

/** Public compatibility for reference systems: GET /api/v1/compat?system=<slug>&ctx=8192 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const db = getDb();
  const hardware = await compatQueries.loadReferenceHardware(db, p.get('system') ?? '');
  if (!hardware) return notFoundJson();
  const ctx = Math.min(Math.max(Number(p.get('ctx') ?? 8192) || 8192, 512), 1_048_576);
  const results = await compatQueries.runCompatibility(db, hardware, { contextLength: ctx, capability: p.get('capability') ?? undefined, ...measurementPolicy() });
  return publicJson({
    system: { slug: hardware.slug, name: hardware.label, components: hardware.components },
    contextLength: ctx,
    variants: results.map((r) => ({
      variant: r.variantSlug,
      model: r.modelSlug,
      recommended: r.recommended && {
        artifact: r.recommended.row.artifactSlug,
        quantization: r.recommended.row.schemeName,
        runtime: r.recommended.runtime.slug,
        fit: r.recommended.result.fit,
        placement: r.recommended.result.placement,
        memory: r.recommended.result.memory,
        speed: r.recommended.result.speed,
      },
    })),
  });
}
