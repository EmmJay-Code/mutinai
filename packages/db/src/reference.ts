/**
 * Reference vocabulary the catalog needs whether or not the fixture dataset is seeded: quantization schemes.
 * Idempotent. Runs in the seed and on every deploy (worker `bootstrap`), so production gains schemes added to the
 * repository without reseeding. Existing schemes are never modified; only missing ones and aliases are added.
 */
import { and, eq } from 'drizzle-orm';
import type { Executor } from './client';
import * as s from './schema';
import { schemes } from './seed/catalog';
import { addAliases, createEntity } from './writers';

export async function ensureQuantizationSchemes(db: Executor): Promise<{ ids: Map<string, string>; created: number }> {
  const ids = new Map<string, string>();
  let created = 0;
  for (const scheme of schemes) {
    const [existing] = await db.select({ id: s.entity.id }).from(s.entity).where(and(eq(s.entity.kind, 'quantization_scheme'), eq(s.entity.slug, scheme.slug)));
    let id = existing?.id;
    if (!id) {
      id = await createEntity(db, { kind: 'quantization_scheme', slug: scheme.slug, name: scheme.name, summary: scheme.summary });
      await db.insert(s.quantizationScheme).values({ id, method: scheme.method, format: scheme.format, bitsPerWeight: scheme.bitsPerWeight });
      created += 1;
    }
    if ('aliases' in scheme) await addAliases(db, id, [...scheme.aliases]);
    ids.set(scheme.slug, id);
  }
  return { ids, created };
}
