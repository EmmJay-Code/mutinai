import { catalog, compatQueries, getDb } from '@mutinai/db';
import { compat, RESULT_ORIGIN_TEXT } from '@mutinai/domain';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Empty, LicenseShort, PageHead } from '@/components/ui';
import { CapabilityBars, EstimateTag, MemoryScale, SystemsMeter } from '@/components/viz';
import { CAPABILITY_LABEL, evaluationModeText, formatContext, formatDate, formatNumber, formatParams, humanize } from '@/lib/format';
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
  const [details, list, profiles, summary, bestScores, acrossSystems] = await Promise.all([
    Promise.all(slugs.map((s) => catalog.getModelDetail(db, s))),
    catalog.listModels(db),
    catalog.listCapabilityProfiles(db),
    compatQueries.compatSummaryByModel(db, { contextLength: 8192, ...measurementPolicy() }),
    catalog.listBenchmarkScores(db),
    Promise.all(slugs.map((s) => compatQueries.compatForModelAcrossSystems(db, s, { contextLength: 8192, ...measurementPolicy() }))),
  ]);
  type Row = [string, (m: (typeof models)[number]) => React.ReactNode];
  const models = details.flatMap((d) => (d ? [{ detail: d, item: list.find((m) => m.slug === d.slug)! }] : []));
  const benchmarks = [...new Map(bestScores.filter((b) => slugs.includes(b.modelSlug)).map((b) => [b.benchmarkSlug, b.benchmarkName] as const)).entries()];
  const topOf = (slug: string) => Math.max(...bestScores.filter((b) => b.benchmarkSlug === slug).map((b) => b.value));
  // The score shown is the model's headline for that benchmark; the cell names the variant and mode that produced it,
  // because a model's best number often comes from one variant in one mode (Qwen3 with thinking on, say).
  const score = (m: (typeof models)[number], bench: string) => {
    const best = bestScores.find((b) => b.modelSlug === m.detail.slug && b.benchmarkSlug === bench);
    if (!best) return null;
    const row = m.detail.capabilityHeadlines.find((h) => h.variantSlug === best.variantSlug && h.benchmarkSlug === bench);
    const variant = m.detail.variants.find((v) => v.slug === best.variantSlug);
    return { value: best.value, variantName: variant?.name ?? best.variantSlug, mode: row ? evaluationModeText(row) : null, origin: RESULT_ORIGIN_TEXT[best.origin]?.label ?? humanize(best.origin) };
  };

  // Measured speed on the same system: the same reading as each model page's "Where it runs" (reference results, plus
  // verified member runs where the deployment counts them), so the two pages never disagree. Every system at least one
  // of these models was measured on, shared systems first; each cell names the download and runtime measured.
  const measuredOn = (m: (typeof models)[number], system: string) => {
    const row = acrossSystems[slugs.indexOf(m.detail.slug)]?.find((r) => r.system.slug === system);
    const speed = row?.best?.result.speed;
    return speed?.basis === 'measured' && speed.genTps != null ? { gen: speed.genTps, download: `${row!.best!.variantName} ${row!.best!.row.schemeName}`, runtime: row!.best!.runtime.name } : null;
  };
  const systems = [...new Map(acrossSystems.flat().filter((r) => r.best?.result.speed.basis === 'measured').map((r) => [r.system.slug, r.system.name] as const)).entries()]
    .map(([slug, name]) => ({ slug, name, measured: models.filter((m) => measuredOn(m, slug)).length }))
    .sort((a, b) => b.measured - a.measured || a.name.localeCompare(b.name));
  const kvAt8k = (d: (typeof models)[number]['detail']) => compat.kvCacheGb({ paramsTotal: d.paramsTotal, paramsActive: d.paramsActive, layers: d.layers, kvHeads: d.kvHeads, headDim: d.headDim, kvBytesPerTokenOverride: d.kvBytesPerTokenOverride, contextLength: d.contextLength }, Math.min(8192, d.contextLength));
  const architecture: Row[] = [
    ['Architecture', (m) => (m.detail.architecture === 'moe' ? <>Mixture of experts<span className="sub num">{formatParams(m.detail.paramsActive ?? 0)} active per token</span></> : 'Dense')],
    ['Layers', (m) => <span className="num">{m.detail.layers}</span>],
    ['Attention heads', (m) => <span className="num">{m.detail.attentionHeads}</span>],
    ['KV heads', (m) => <span className="num">{m.detail.kvHeads}{m.detail.attentionHeads > m.detail.kvHeads ? <span className="faint"> · GQA {m.detail.attentionHeads / m.detail.kvHeads}:1</span> : null}</span>],
    ['Head dim', (m) => <span className="num">{m.detail.headDim}</span>],
    ['KV cache @ 8K', (m) => <span className="num">{formatNumber(kvAt8k(m.detail), 2)} GiB<span className="faint"> fp16</span></span>],
    ['Max context', (m) => <span className="num">{m.detail.contextLength.toLocaleString('en-US')} tokens</span>],
  ];

  const rows: Row[] = [
    ['Developer', (m) => m.detail.developer.name],
    ['Released', (m) => formatDate(m.detail.release.releasedOn)],
    ['Size', (m) => <span className="num">{formatParams(m.detail.paramsTotal)}{m.detail.paramsActive ? ` · ${formatParams(m.detail.paramsActive)} active` : ''}</span>],
    ['Capability', (m) => <CapabilityBars profile={profiles[m.detail.slug]} legend />],
    ['Memory to run', (m) => <div style={{ maxWidth: 180 }}><MemoryScale gb={m.item.minMemoryGb} label="from" /></div>],
    ['Runs well on', (m) => (summary[m.detail.slug] ? <><SystemsMeter runsWell={summary[m.detail.slug]!.runsWell} slow={summary[m.detail.slug]!.slow} of={summary[m.detail.slug]!.of} /> <EstimateTag title="Whether it fits each reference system is estimated from file size, quantization and context — not measured" /></> : '—')],
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
            <tr><td colSpan={models.length + 1} className="subhead" style={{ paddingTop: 16 }}>Architecture</td></tr>
            {architecture.map(([label, render]) => (
              <tr key={label}>
                <td className="muted" style={{ width: 140 }}>{label}</td>
                {models.map((m) => <td key={m.detail.slug}>{render(m)}</td>)}
              </tr>
            ))}
            {benchmarks.length > 0 && <tr><td colSpan={models.length + 1} className="subhead" style={{ paddingTop: 16 }}>Benchmark scores · each cell names the variant and mode that produced it · bar relative to best open result</td></tr>}
            {benchmarks.map(([slug, name]) => (
              <tr key={slug}>
                <td className="muted">{name}</td>
                {models.map((m) => {
                  const v = score(m, slug);
                  return (
                    <td key={m.detail.slug}>
                      {v != null ? (
                        <>
                          <div style={{ display: 'grid', gridTemplateColumns: '44px minmax(40px,120px)', gap: 8, alignItems: 'center' }}>
                            <span className="val-measured">{v.value.toFixed(1)}</span>
                            <span className="bar"><i style={{ width: `${(v.value / topOf(slug)) * 100}%`, background: 'var(--e-bench)' }} /></span>
                          </div>
                          <span className="sub">{v.variantName}{v.mode ? ` · ${v.mode}` : ''} · {v.origin}</span>
                        </>
                      ) : <span className="faint">—</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr><td colSpan={models.length + 1} className="subhead" style={{ paddingTop: 16 }}>Measured generation speed on the same system · tokens per second</td></tr>
            {systems.length === 0 ? (
              <tr><td colSpan={models.length + 1} className="small muted">None of these models has a measured speed on a reference system yet. <Link className="link" href="/benchmarks#speed-results">All measured runs →</Link></td></tr>
            ) : systems.map((sys) => (
              <tr key={sys.slug}>
                <td className="muted"><Link href={`/hardware/systems/${sys.slug}`}>{sys.name.replace(/\s*\(.*\)$/, '')}</Link></td>
                {models.map((m) => {
                  const r = measuredOn(m, sys.slug);
                  return (
                    <td key={m.detail.slug}>
                      {r ? (
                        <>
                          <span className="val-measured">{formatNumber(r.gen)}</span> <span className="small muted">tok/s</span>
                          <span className="sub">{r.download} · {r.runtime}</span>
                        </>
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
