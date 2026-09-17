import { catalog, compatQueries, getDb } from '@mutinai/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Empty, LicenseShort, PageHead } from '@/components/ui';
import { CapabilityBars, MemoryScale, SystemsMeter } from '@/components/viz';
import { CAPABILITY_LABEL, formatContext, formatDate, formatParams, humanize } from '@/lib/format';
import { hideSampleCommunityContent, measurementPolicy } from '@/lib/community-visibility';

export const metadata: Metadata = { title: 'Compare models' };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function ComparePage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const slugs = [...new Set((Array.isArray(sp.m) ? sp.m : sp.m ? [sp.m] : []).slice(0, 4))];
  const db = getDb();
  if (slugs.length < 2) {
    return (
      <>
        <PageHead crumbs={[{ href: '/models', label: 'Models' }]} title="Compare models" />
        <Empty>Choose at least two models to compare from the <Link className="link" href="/models">models directory</Link>.</Empty>
      </>
    );
  }
  const [details, list, profiles, summary, bestScores] = await Promise.all([
    Promise.all(slugs.map((s) => catalog.getModelDetail(db, s))),
    catalog.listModels(db),
    catalog.listCapabilityProfiles(db),
    compatQueries.compatSummaryByModel(db, { contextLength: 8192, ...measurementPolicy() }),
    catalog.listBenchmarkScores(db),
  ]);
  const models = details.flatMap((d) => (d ? [{ detail: d, item: list.find((m) => m.slug === d.slug)! }] : []));
  const benchmarks = [...new Map(bestScores.filter((b) => slugs.includes(b.modelSlug)).map((b) => [b.benchmarkSlug, b.benchmarkName] as const)).entries()];
  const topOf = (slug: string) => Math.max(...bestScores.filter((b) => b.benchmarkSlug === slug).map((b) => b.value));
  const score = (model: string, bench: string) => bestScores.find((b) => b.modelSlug === model && b.benchmarkSlug === bench)?.value ?? null;

  type Row = [string, (m: (typeof models)[number]) => React.ReactNode];
  const rows: Row[] = [
    ['Developer', (m) => m.detail.developer.name],
    ['Released', (m) => formatDate(m.detail.release.releasedOn)],
    ['Size', (m) => <span className="num">{formatParams(m.detail.paramsTotal)}{m.detail.paramsActive ? ` · ${formatParams(m.detail.paramsActive)} active` : ''}</span>],
    ['Capability', (m) => <CapabilityBars profile={profiles[m.detail.slug]} legend />],
    ['Memory to run', (m) => <div style={{ maxWidth: 180 }}><MemoryScale gb={m.item.minMemoryGb} label="from" /></div>],
    ['Runs well on', (m) => (summary[m.detail.slug] ? <SystemsMeter runsWell={summary[m.detail.slug]!.runsWell} slow={summary[m.detail.slug]!.slow} of={summary[m.detail.slug]!.of} /> : '—')],
    ['Context', (m) => <span className="num">{formatContext(m.detail.contextLength)}</span>],
    ['Capabilities', (m) => m.item.capabilities.map((c) => CAPABILITY_LABEL[c] ?? humanize(c)).join(', ')],
    ['License', (m) => <LicenseShort commercialUse={m.item.licenses.some((l) => l.commercialUse === 'allowed') ? 'allowed' : m.item.licenses[0]?.commercialUse} name={m.item.licenses.map((l) => l.name).join('; ')} />],
    ['Variants', (m) => `${m.detail.variants.length} · ${m.item.artifactCount} downloads`],
    // Member run and review tallies are a claim about the model; seeded ones never appear beside a real name.
    ...(hideSampleCommunityContent() ? [] : [['Community', (m) => `${m.item.runCount} runs · ${m.item.reviewCount} reviews`] as Row]),
  ];

  return (
    <>
      <PageHead crumbs={[{ href: '/models', label: 'Models' }]} title="Compare models" />
      <div className="table-wrap surface" style={{ padding: '4px 14px' }}>
        <table className="data">
          <thead>
            <tr>
              <th />
              {models.map((m) => <th key={m.detail.slug} style={{ font: '600 16px/1.2 var(--serif)', textTransform: 'none', letterSpacing: 0, color: 'var(--ink)' }}><span className="glyph g-model" aria-hidden="true" /> <Link href={`/models/${m.detail.slug}`}>{m.detail.name}</Link></th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, render]) => (
              <tr key={label}>
                <td className="muted" style={{ width: 140 }}>{label}</td>
                {models.map((m) => <td key={m.detail.slug}>{render(m)}</td>)}
              </tr>
            ))}
            {benchmarks.length > 0 && <tr><td colSpan={models.length + 1} className="subhead" style={{ paddingTop: 16 }}>Best developer-reported score · bar relative to best open result (illustrative)</td></tr>}
            {benchmarks.map(([slug, name]) => (
              <tr key={slug}>
                <td className="muted">{name}</td>
                {models.map((m) => {
                  const v = score(m.detail.slug, slug);
                  return (
                    <td key={m.detail.slug}>
                      {v != null ? (
                        <div style={{ display: 'grid', gridTemplateColumns: '44px minmax(40px,120px)', gap: 8, alignItems: 'center' }}>
                          <span className="val-measured">{v.toFixed(1)}</span>
                          <span className="bar"><i style={{ width: `${(v / topOf(slug)) * 100}%`, background: 'var(--e-bench)' }} /></span>
                        </div>
                      ) : <span className="faint">—</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
