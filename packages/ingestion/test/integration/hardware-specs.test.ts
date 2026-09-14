import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { catalog, type DatabaseHandle } from '@mutinai/db';
import { createTestDatabase, resetAndSeed } from '@mutinai/db/testing';
import { createHardwareSpecsAdapter, type HardwareSpecRow } from '../../src/adapters/hardware-specs';
import { MemoryObjectStore } from '../../src/object-store';
import { runAdapter } from '../../src/pipeline';

let h: DatabaseHandle;
const store = new MemoryObjectStore();

const NVIDIA_SPECS = 'https://www.nvidia.com/en-us/geforce/graphics-cards/50-series/rtx-5080/';
const NVIDIA_LAUNCH = 'https://www.nvidia.com/en-us/geforce/news/rtx-50-series-graphics-cards-gpu-laptop-announcements/';

const importRows = (rows: HardwareSpecRow[]) => runAdapter({ db: h.db, store }, createHardwareSpecsAdapter({ rows }));
const device = async (slug: string) => (await catalog.listDevices(h.db)).find((d) => d.slug === slug);

/** Every assertion for an entity, with the page it was read from. */
const provenanceOf = (slug: string) =>
  h.db.execute<{ field: string; value: unknown; url: string | null; applied: number }>(sql`
    select fa.field, fa.value, sr.url, fa.applied
    from ingest.field_assertion fa
    join ingest.source_record sr on sr.id = fa.source_record_id
    join ecosystem.entity e on e.id = fa.entity_id
    where e.slug = ${slug} order by fa.field`);

beforeAll(async () => {
  h = createTestDatabase();
  await resetAndSeed(h.db, { community: false });
});
afterAll(() => h.close());

describe('importing researched hardware specifications', () => {
  it('creates a device the editor classified, and cites the page for every field', async () => {
    const { stats } = await importRows([{
      name: 'GeForce RTX 5080', manufacturer: 'NVIDIA',
      deviceKind: 'gpu', memoryKind: 'dedicated', backends: 'cuda,vulkan',
      memoryGb: '16', memoryType: 'GDDR7', tdpWatts: '360', sourceUrl: NVIDIA_SPECS,
    }]);
    expect(stats).toMatchObject({ seen: 1, new: 1, failed: 0, entitiesCreated: 1 });

    expect(await device('geforce-rtx-5080')).toMatchObject({
      name: 'GeForce RTX 5080', memoryGb: 16, memoryType: 'GDDR7', tdpWatts: 360,
      deviceKind: 'gpu', memoryKind: 'dedicated', backends: ['cuda', 'vulkan'],
      memoryBandwidthGbps: null, releasedOn: null, launchPriceUsd: null,
    });

    const provenance = await provenanceOf('geforce-rtx-5080');
    expect(provenance.map((p) => p.field)).toEqual(['memoryGb', 'memoryType', 'tdpWatts']);
    expect(provenance.every((p) => p.url === NVIDIA_SPECS)).toBe(true);
  });

  it('takes a second page as a second citation, so each field points at where it was read', async () => {
    await importRows([{
      name: 'GeForce RTX 5080', manufacturer: 'NVIDIA',
      bandwidthGbps: '960', releaseDate: '01/30/2025', launchPriceUsd: '$999', sourceUrl: NVIDIA_LAUNCH,
    }]);

    expect(await device('geforce-rtx-5080')).toMatchObject({ memoryGb: 16, memoryBandwidthGbps: 960, releasedOn: '2025-01-30', launchPriceUsd: 999 });
    const applied = (await provenanceOf('geforce-rtx-5080')).filter((p) => p.applied === 1);
    expect(Object.fromEntries(applied.map((p) => [p.field, p.url]))).toEqual({
      memoryGb: NVIDIA_SPECS,
      memoryType: NVIDIA_SPECS,
      tdpWatts: NVIDIA_SPECS,
      memoryBandwidthGbps: NVIDIA_LAUNCH,
      releasedOn: NVIDIA_LAUNCH,
      launchPriceUsd: NVIDIA_LAUNCH,
    });
  });

  it('updates a device that already exists without needing it reclassified', async () => {
    const before = await device('nvidia-rtx-4090');
    expect(before?.tdpWatts).toBe(450);
    await importRows([{ name: 'NVIDIA GeForce RTX 4090', manufacturer: 'NVIDIA', tdpWatts: '452', sourceUrl: 'https://www.nvidia.com/en-us/geforce/graphics-cards/40-series/rtx-4090/' }]);
    expect((await device('nvidia-rtx-4090'))?.tdpWatts).toBe(452);
  });

  it('refuses to invent a device it has no classification for, and leaves it for review', async () => {
    const { stats } = await importRows([{ name: 'Mystery Accelerator 9000', manufacturer: 'NVIDIA', memoryGb: '48', sourceUrl: 'https://www.nvidia.com/mystery' }]);
    expect(stats).toMatchObject({ entitiesCreated: 0, reviewItems: 1 });
    expect(await device('mystery-accelerator-9000')).toBeUndefined();
    const [review] = await h.db.execute<{ reason: string }>(sql`select reason::text from ingest.review_item where status = 'open' and reason = 'unclassified_device'`);
    expect(review?.reason).toBe('unclassified_device');
  });

  it('skips rows it cannot trust rather than importing part of one', async () => {
    const { stats } = await importRows([
      { name: 'Uncited Card', manufacturer: 'NVIDIA', memoryGb: '16', deviceKind: 'gpu', memoryKind: 'dedicated', backends: 'cuda', sourceUrl: '' },
      { name: 'Impossible Card', manufacturer: 'NVIDIA', memoryGb: '999999', deviceKind: 'gpu', memoryKind: 'dedicated', backends: 'cuda', sourceUrl: 'https://www.nvidia.com/x' },
    ]);
    expect(stats).toMatchObject({ seen: 0, entitiesCreated: 0 });
    expect(await device('uncited-card')).toBeUndefined();
    expect(await device('impossible-card')).toBeUndefined();
  });
});
