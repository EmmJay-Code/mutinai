import { catalog, getDb } from '@mutinai/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Empty, PageHead } from '@/components/ui';
import { CAPABILITY_LABEL, formatContext, formatDate, formatParams, humanize } from '@/lib/format';

export const metadata: Metadata = { title: 'Compare models' };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function ComparePage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const slugs = [...new Set((Array.isArray(sp.m) ? sp.m : sp.m ? [sp.m] : []).slice(0, 4))];
  const db = getDb();
  if (slugs.length < 2) {
    return (
      <>
        <PageHead eyebrow="Models" title="Compare models" />
        <Empty>Choose at least two models to compare from the <Link href="/models">models directory</Link>.</Empty>
      </>
    );
  }
  const [details, list] = await Promise.all([Promise.all(slugs.map((s) => catalog.getModelDetail(db, s))), catalog.listModels(db)]);
  const models = details.flatMap((d) => (d ? [{ detail: d, item: list.find((m) => m.slug === d.slug)! }] : []));
  const benchmarks = [...new Map(models.flatMap((m) => m.detail.capabilityResults.map((r) => [r.benchmarkSlug, r.benchmarkName] as const))).entries()];
  const best = (m: (typeof models)[number], slug: string) => {
    const rs = m.detail.capabilityResults.filter((r) => r.benchmarkSlug === slug);
    return rs.length ? Math.max(...rs.map((r) => r.metric.value)) : null;
  };

  const rows: [string, (m: (typeof models)[number]) => React.ReactNode][] = [
    ['Developer', (m) => m.detail.developer.name],
    ['Released', (m) => formatDate(m.detail.release.releasedOn)],
    ['Parameters', (m) => <span className="num">{formatParams(m.detail.paramsTotal)}</span>],
    ['Active per token', (m) => (m.detail.paramsActive ? <span className="num">{formatParams(m.detail.paramsActive)}</span> : 'All (dense)')],
    ['Memory to run', (m) => (m.item.minMemoryGb != null ? <span className="num">from ~{Math.ceil(m.item.minMemoryGb)} GB</span> : '—')],
    ['Context', (m) => <span className="num">{formatContext(m.detail.contextLength)}</span>],
    ['Capabilities', (m) => m.item.capabilities.map((c) => CAPABILITY_LABEL[c] ?? humanize(c)).join(', ')],
    ['License', (m) => m.item.licenses.map((l) => l.name).join('; ')],
    ['Variants', (m) => `${m.detail.variants.length} (${m.item.artifactCount} downloads)`],
    ['Community', (m) => `${m.item.reviewCount} reviews · ${m.item.runCount} runs`],
  ];

  return (
    <>
      <PageHead eyebrow="Models" title="Compare models" crumbs={[{ href: '/models', label: 'Models' }, { label: 'Compare' }]} />
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th />
              {models.map((m) => <th key={m.detail.slug} style={{ fontSize: 17, fontFamily: 'var(--font-sans)', color: 'var(--ink)' }}><Link href={`/models/${m.detail.slug}`}>{m.detail.name}</Link></th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, render]) => (
              <tr key={label}>
                <td className="muted">{label}</td>
                {models.map((m) => <td key={m.detail.slug}>{render(m)}</td>)}
              </tr>
            ))}
            {benchmarks.length > 0 && (
              <tr><td colSpan={models.length + 1} className="meta" style={{ paddingTop: 24 }}>Best developer-reported score across variants (illustrative)</td></tr>
            )}
            {benchmarks.map(([slug, name]) => (
              <tr key={slug}>
                <td className="muted">{name}</td>
                {models.map((m) => {
                  const v = best(m, slug);
                  return <td key={m.detail.slug}>{v != null ? <span className="val-measured">{v.toFixed(1)}</span> : <span className="faint">—</span>}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
