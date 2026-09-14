import { catalog, community, compatQueries, getDb } from '@mutinai/db';
import { compat } from '@mutinai/domain';
import type { Metadata } from 'next';
import Link from 'next/link';
import { IfContributing } from '@/components/preview';
import { notFound } from 'next/navigation';
import { PerformanceTable, ProvenanceBlock, RatingSummary, ReviewList, SubmissionList } from '@/components/results';
import { Basis, Crumbs, DataOrigin, Disclosure, Empty, EntitySection, Explain, Facts, FitBadge, Glance, LicenseShort, SectionNav, Speed, Tag } from '@/components/ui';
import { CapabilityDetail, EntityMark, MemoryScale, SystemsMeter } from '@/components/viz';
import { CAPABILITY_LABEL, formatBytes, formatContext, formatDate, formatMonthYear, formatNumber, formatParams, humanize, isoDate, paramsInWords, VARIANT_KIND_EXPLAINER } from '@/lib/format';
import { hideSampleCommunityContent, measurementPolicy, SAMPLE_EMPTY_TEXT } from '@/lib/community-visibility';
import { getViewer } from '@/lib/session';

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const m = await catalog.getModelDetail(getDb(), (await params).slug);
  return { title: m?.name ?? 'Model not found' };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const LINEAGE_LABEL: Record<string, [string, string]> = {
  fine_tuned_from: ['fine-tuned from', 'fine-tuned into'],
  distilled_from: ['distilled from', 'distilled into'],
  merged_from: ['merged from', 'merged into'],
};

const SECTIONS = [
  { id: 'versions', label: 'Versions' },
  { id: 'compatibility', label: 'Compatibility' },
  { id: 'benchmarks', label: 'Benchmarks' },
  { id: 'variants', label: 'Downloads' },
  { id: 'performance', label: 'Performance' },
  { id: 'community-runs', label: 'Community results' },
  { id: 'reviews', label: 'Reviews' },
  { id: 'lineage', label: 'Lineage' },
  { id: 'sources', label: 'Sources' },
];

export default async function ModelPage({ params }: { params: Params }) {
  const { slug } = await params;
  const db = getDb();
  const model = await catalog.getModelDetail(db, slug);
  if (!model) notFound();
  const viewer = await getViewer();

  const subjectIds = model.variants.flatMap((v) => [v.id, ...v.artifacts.map((a) => a.id)]);
  const release = await catalog.getEntityRef(db, 'model_release', model.release.slug);
  const [reviews, submissions, events, provenances, systems, list, allAggregates, profiles, benchmarks, bestScores, ...aggregates] = await Promise.all([
    community.listReviewsForEntities(db, subjectIds, viewer),
    community.listSubmissions(db, { modelId: model.id }, viewer),
    release ? catalog.listEvents(db, { entityId: release.id, limit: 10 }) : Promise.resolve([]),
    Promise.all(model.variants.map((v) => catalog.getProvenance(db, v.id))),
    compatQueries.compatForModelAcrossSystems(db, model.slug, { contextLength: 8192, ...measurementPolicy() }),
    catalog.listModels(db),
    community.ratingAggregates(db, subjectIds),
    catalog.listCapabilityProfiles(db),
    catalog.listBenchmarks(db, 'capability'),
    catalog.listBestBenchmarkScores(db),
    ...model.variants.map((v) => community.ratingAggregates(db, [v.id, ...v.artifacts.map((a) => a.id)])),
  ]);
  // A page about someone else's model never shows seeded member content as opinion or measurement of it.
  const hideCommunity = hideSampleCommunityContent();
  const shownReviews = hideCommunity ? [] : reviews;
  const shownSubmissions = hideCommunity ? [] : submissions;
  const shownAggregates = hideCommunity ? [] : allAggregates;
  const variantAggregates = hideCommunity ? aggregates.map(() => []) : aggregates;
  const listItem = list.find((m) => m.slug === model.slug);
  const profile = profiles[model.slug];
  const benchmarkNames = Object.fromEntries(benchmarks.map((b) => [b.slug, b.name]));
  const bestOf = (bench: string) => Math.max(...bestScores.filter((b) => b.benchmarkSlug === bench).map((b) => b.value));

  const provenance: catalog.ProvenanceDTO = {
    externalIds: provenances.flatMap((p) => p.externalIds),
    sources: Object.values(Object.fromEntries(provenances.flatMap((p) => p.sources).map((s) => [s.key, s]))),
    assertions: provenances.flatMap((p) => p.assertions),
  };

  const spec = { paramsTotal: model.paramsTotal, paramsActive: model.paramsActive, layers: model.layers, kvHeads: model.kvHeads, headDim: model.headDim, kvBytesPerTokenOverride: model.kvBytesPerTokenOverride, contextLength: model.contextLength };
  const kvPer8k = compat.kvCacheGb(spec, Math.min(8192, model.contextLength));
  const benchSlugs = [...new Set(model.capabilityResults.map((r) => r.benchmarkSlug))];
  const variantsWithResults = model.variants.filter((v) => model.capabilityResults.some((r) => r.variantSlug === v.slug));
  const usable = model.variants.filter((v) => v.kind !== 'base');
  const licenses = [...new Map(model.variants.flatMap((v) => (v.license ? [[v.license.name, v.license] as const] : []))).values()];
  const commercial = licenses.some((l) => l.commercialUse === 'allowed') ? 'allowed' : licenses[0]?.commercialUse;

  const runsWell = systems.filter((s) => s.best?.result.placement === 'accelerator');
  const slowly = systems.filter((s) => s.best && s.best.result.placement !== 'accelerator');
  const tooLarge = systems.filter((s) => !s.best);

  // Lineage: variants of this model as roots, derived variants under their in-model parent; external parents noted.
  const inModel = new Set(model.variants.map((v) => v.slug));
  const parentOf = (v: (typeof model.variants)[number]) => v.lineage.find((l) => l.direction === 'outgoing' && inModel.has(l.slug));
  const roots = model.variants.filter((v) => !parentOf(v));
  const childrenOf = (slug: string) => model.variants.filter((v) => parentOf(v)?.slug === slug);

  const lastChange = [...events.map((e) => new Date(e.occurredAt)), ...provenance.assertions.map((a) => new Date(a.assertedAt)), ...submissions.map((s) => new Date(s.createdAt)), ...reviews.map((r) => new Date(r.createdAt))].sort((a, b) => b.getTime() - a.getTime())[0];
  const archPhrase = model.architecture === 'moe'
    ? <><Explain term="moe">mixture-of-experts</Explain> model using ~{paramsInWords(model.paramsActive ?? 0)} parameters per token</>
    : <>dense model</>;

  return (
    <>
      <Crumbs crumbs={[
        { href: '/models', label: 'Models' },
        { href: `/models?developer=${model.developer.slug}`, label: model.developer.name },
        { href: `/models?family=${model.family.slug}`, label: model.family.name },
      ]} />
      <div className="entity-top">
        <header className="entity-hero">
          <div className="kicker"><EntityMark type="model" word /> · {model.release.name}{model.release.releasedOn ? ` · ${formatMonthYear(model.release.releasedOn)}` : ''} <DataOrigin sources={provenance.sources} /></div>
          <h1>{model.name}</h1>
          <p className="lede">A {paramsInWords(model.paramsTotal)}-<Explain term="parameters">parameter</Explain> {archPhrase} from {model.developer.name}. {model.release.summary}</p>
          <Glance
            items={[
              ['Size', formatParams(model.paramsTotal), model.paramsActive ? `${formatParams(model.paramsActive)} active` : 'dense'],
              ['Memory to run', listItem?.minMemoryGb != null ? `~${Math.ceil(listItem.minMemoryGb)} GB` : '—', 'smallest, 8K ctx'],
              ['Context', formatContext(model.contextLength), 'tokens'],
              ['License', <LicenseShort key="l" commercialUse={commercial} />, licenses.map((l) => l.name).join('; ')],
              ['Updated', lastChange ? formatDate(lastChange) : '—', hideCommunity ? undefined : `${plural(listItem?.runCount ?? 0, 'run')} · ${plural(listItem?.reviewCount ?? 0, 'review')}`],
            ]}
          />
          <div className="page-head-actions tight">
            <Link className="btn" href={`/models/compare?m=${model.slug}${model.siblings[0] ? `&m=${model.siblings[0].slug}` : ''}`}>Compare</Link>
            <IfContributing><Link className="btn" href={`/contribute/benchmark?model=${model.slug}`}>Submit a run</Link>
            {usable[0] && <Link className="btn" href={`/contribute/review?entity=model_variant:${usable[0].slug}&returnTo=${encodeURIComponent(`/models/${model.slug}#reviews`)}`}>Review</Link>}</IfContributing>
          </div>
        </header>

        <aside className="verdict" aria-label="At a glance">
          <div>
            <h2>Can I run it? <span><SystemsMeter runsWell={runsWell.length} slow={slowly.length} of={systems.length} /></span></h2>
            <div style={{ marginTop: 8 }}><MemoryScale gb={listItem?.minMemoryGb ?? null} label="Needs from" /></div>
            <div className="line" style={{ marginTop: 6 }}><span className="k">Runs well on</span><span>{runsWell.slice(0, 3).map((s) => s.system.name.replace(/\s*\(.*\)$/, '')).join(', ')}{runsWell.length > 3 ? ` +${runsWell.length - 3}` : ''}</span></div>
            <p style={{ margin: '6px 0 0' }}><Link className="small link" href="/run">Check your hardware →</Link></p>
          </div>
          <div>
            <h2>Good at <span>vs best open result</span></h2>
            <div style={{ marginTop: 8 }}><CapabilityDetail profile={profile} benchmarkNames={benchmarkNames} /></div>
          </div>
          <div>
            <h2>Community <span>{plural(hideCommunity ? 0 : listItem?.reviewCount ?? 0, 'review')}</span></h2>
            <div style={{ marginTop: 4 }}><RatingSummary aggregates={shownAggregates.slice(0, 4)} emptyText={hideCommunity ? SAMPLE_EMPTY_TEXT : undefined} /></div>
          </div>
        </aside>
      </div>

      <SectionNav items={SECTIONS} />

      <EntitySection id="versions" title="Which version to use">
        <ul className="list-plain" style={{ columns: usable.length > 2 ? 2 : 1, columnGap: 28 }}>
          {(usable.length ? usable : model.variants).map((v) => (
            <li key={v.slug} style={{ breakInside: 'avoid' }}>
              <a href={`#${v.slug}`} style={{ fontWeight: 600 }}><EntityMark type="variant" /> {v.name}</a> <span className="small muted">· {v.publisher.name}</span>
              <div className="small muted">{VARIANT_KIND_EXPLAINER[v.kind] ?? humanize(v.kind)}</div>
              <div className="tags" style={{ marginTop: 3 }}>{v.capabilities.filter((c) => c !== 'multilingual').map((c) => <Tag key={c}>{CAPABILITY_LABEL[c] ?? humanize(c)}</Tag>)}</div>
            </li>
          ))}
        </ul>
        {model.summary && <p className="small muted" style={{ marginTop: 8 }}>Note: {model.summary}</p>}
        {model.siblings.length > 0 && (
          <p className="small muted" style={{ marginTop: 8 }}>Other sizes in {model.release.name}: {model.siblings.map((s, i) => <span key={s.slug}>{i > 0 && ', '}<Link className="link" href={`/models/${s.slug}`}>{s.name}</Link></span>)}</p>
        )}
      </EntitySection>

      <EntitySection id="compatibility" title="Where it runs" intro={<>Best-fitting version on each reference system, at an 8K <Explain term="context" />.</>} more={<Link href="/run">Your hardware →</Link>}>
        {systems.length === 0 ? <Empty>No downloadable versions recorded yet.</Empty> : (
          <div className="fit-groups">
            {[
              { title: 'Runs well', fit: 'full' as const, list: runsWell },
              { title: 'Slowly (CPU or offload)', fit: 'offload' as const, list: slowly },
              { title: 'Too large', fit: 'none' as const, list: tooLarge },
            ].map((g) => (
              <div key={g.title}>
                <h3><span className={`fit fit-${g.fit}`}>{g.title}</span> <span className="muted num">{g.list.length}</span></h3>
                {g.list.length === 0 ? <p className="small muted" style={{ margin: 0 }}>None of the reference systems.</p> : (
                  <ul>
                    {g.list.map((s) => (
                      <li key={s.system.slug}>
                        <Link href={`/run?system=${s.system.slug}`}>{s.system.name.replace(/\s*\(.*\)$/, '')}</Link>
                        {s.best && <span className="small muted" title={`${s.best.row.schemeName} via ${s.best.runtime.name}`}><Speed speed={s.best.result.speed} /></span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </EntitySection>

      <EntitySection id="benchmarks" title="Benchmarks" intro={<>Each <Explain term="benchmark" /> is developer-reported; prompts and settings differ between labs. Bars are relative to the best open result.</>}>
        {benchSlugs.length === 0 ? <Empty>No benchmark results recorded for this model.</Empty> : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>Benchmark</th>{variantsWithResults.map((v) => <th key={v.slug}>{v.name}</th>)}</tr>
              </thead>
              <tbody>
                {benchSlugs.map((b) => {
                  const rows = model.capabilityResults.filter((r) => r.benchmarkSlug === b);
                  const top = bestOf(b);
                  return (
                    <tr key={b}>
                      <td><EntityMark type="bench" /> <span className="primary">{rows[0]!.benchmarkName}</span><span className="sub">{rows[0]!.metric.label}</span></td>
                      {variantsWithResults.map((v) => {
                        const r = rows.find((x) => x.variantSlug === v.slug);
                        return (
                          <td key={v.slug}>
                            {r ? (
                              <div style={{ display: 'grid', gridTemplateColumns: '48px minmax(50px, 120px)', gap: 8, alignItems: 'center' }}>
                                <span><span className="val-measured">{r.metric.value.toFixed(1)}</span><a className="source-mark" href="#sources" title={`${humanize(r.origin)} · ${r.sourceName ?? 'unknown source'}${r.evaluationSetting ? ` · ${r.evaluationSetting}` : ''}`}>src</a></span>
                                <span className="bar"><i style={{ width: `${(r.metric.value / top) * 100}%`, background: 'var(--e-bench)' }} /></span>
                              </div>
                            ) : <span className="faint">—</span>}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="small muted" style={{ marginTop: 6 }}><Basis kind="source">developer-reported · illustrative</Basis></p>
          </div>
        )}
      </EntitySection>

      <EntitySection id="variants" title="Variants & downloads" intro={<>Each variant is a separate set of weights. Expand one for its downloads: <Explain term="quantization" /> trades a little quality for a much smaller file, and the memory column adds the <Explain term="kv-cache" /> a conversation needs on top.</>}>
        {model.variants.map((v, i) => {
          const thirdParty = v.publisher.slug !== model.developer.slug;
          return (
            <Disclosure
              key={v.slug}
              id={v.slug}
              title={<><EntityMark type="variant" /> {v.name}</>}
              meta={`${humanize(v.kind)} · ${v.publisher.name}${thirdParty ? ' (third-party)' : ''} · ${plural(v.artifacts.length, 'download')}${v.license ? ` · ${v.license.name}` : ''}`}
              aside={<LicenseShort commercialUse={v.license?.commercialUse} />}
            >
              <div className="split-wide">
                <dl className="kv">
                  <dt>What it is</dt><dd>{VARIANT_KIND_EXPLAINER[v.kind] ?? humanize(v.kind)}</dd>
                  <dt>Publisher</dt><dd>{v.publisher.name}</dd>
                  <dt>License</dt><dd>{v.license ? <>{v.license.url ? <a className="link" href={v.license.url} rel="noopener noreferrer">{v.license.name}</a> : v.license.name} <span className="faint">· commercial use {v.license.commercialUse}</span></> : 'Unknown'}</dd>
                  {v.releasedOn && <><dt>Released</dt><dd>{formatDate(v.releasedOn)}</dd></>}
                  {v.externalIds.map((x) => (
                    <div key={x.value} style={{ display: 'contents' }}><dt>{x.namespace}</dt><dd className="mono">{x.url ? <a className="link" href={x.url} rel="noopener noreferrer">{x.value}</a> : x.value}</dd></div>
                  ))}
                </dl>
                <div>
                  {variantAggregates[i] && variantAggregates[i]!.length > 0 ? <RatingSummary aggregates={variantAggregates[i]!} /> : <p className="small muted" style={{ margin: 0 }}>{hideCommunity ? SAMPLE_EMPTY_TEXT : 'No ratings for this variant yet.'}</p>}
                  <IfContributing><p style={{ marginTop: 8 }}><Link className="btn btn-small" href={`/contribute/review?entity=model_variant:${v.slug}&returnTo=${encodeURIComponent(`/models/${model.slug}#${v.slug}`)}`}>Review this variant</Link></p></IfContributing>
                </div>
              </div>
              {v.artifacts.length ? (
                <div className="table-wrap" style={{ marginTop: 10 }}>
                  <table className="data dense">
                    <thead><tr><th>Quantization</th><th>Format</th><th className="r">Bits</th><th className="r">Download</th><th style={{ minWidth: 150 }} title="Weights + fp16 KV cache at 8K context + runtime overhead">Memory @ 8K</th><th>Publisher</th></tr></thead>
                    <tbody>
                      {v.artifacts.map((a) => {
                        const need = compat.weightsGb({ id: a.id, format: a.format as 'gguf', bitsPerWeight: a.bitsPerWeight, sizeBytes: a.sizeBytes, model: spec });
                        const total = need + kvPer8k + compat.COMPAT_CONSTANTS.baseOverheadGb + need * compat.COMPAT_CONSTANTS.overheadPerWeightGb;
                        return (
                          <tr key={a.slug} id={a.slug}>
                            <td><EntityMark type="artifact" /> <span className="primary mono">{a.schemeName}</span><span className="sub">{humanize(a.method)}</span></td>
                            <td className="mono">{a.format}</td>
                            <td className="r num">{a.bitsPerWeight}</td>
                            <td className="r num">{formatBytes(a.sizeBytes)}</td>
                            <td><MemoryScale gb={total} label="" showValue={false} ticks={[8, 24, 96]} /><span className="val-estimated small">~{total.toFixed(1)} GiB</span></td>
                            <td>{a.publisher.name}{a.sourceRepo && <span className="sub mono"><a className="link" href={`https://huggingface.co/${a.sourceRepo}`} rel="noopener noreferrer">{a.sourceRepo}</a></span>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : <p className="small muted">No downloadable artifacts recorded.</p>}
            </Disclosure>
          );
        })}
        <Disclosure id="architecture" title="Architecture details" meta="Layers, attention and KV cache geometry">
          <Facts
            items={[
              ['Parameters', <span key="p" className="num">{formatNumber(model.paramsTotal / 1e9, 2)}B</span>],
              ['Active / token', model.paramsActive ? <span key="a" className="num">{formatNumber(model.paramsActive / 1e9, 1)}B</span> : 'All (dense)'],
              ['Architecture', model.architecture === 'moe' ? 'Mixture of experts' : 'Dense'],
              ['Layers', <span key="l" className="num">{model.layers}</span>],
              ['Attention heads', <span key="h" className="num">{model.attentionHeads}</span>],
              ['KV heads', <span key="kvh" className="num">{model.kvHeads}</span>],
              ['Head dim', <span key="hd" className="num">{model.headDim}</span>],
              ['KV cache @ 8K (fp16)', <span key="kv" className="num">{formatNumber(kvPer8k, 2)} GiB</span>],
              ['Max context', <span key="c" className="num">{model.contextLength.toLocaleString('en-US')} tokens</span>],
            ]}
          />
        </Disclosure>
      </EntitySection>

      <EntitySection id="performance" title="Measured performance" intro="Throughput on specific systems and runtimes, with the source of each measurement.">
        <PerformanceTable results={model.performanceResults} />
      </EntitySection>

      <div className="split">
        <EntitySection id="community-runs" title="Community results" more={<IfContributing><Link href={`/contribute/benchmark?model=${model.slug}`}>Submit a run →</Link></IfContributing>}>
          <SubmissionList submissions={shownSubmissions} emptyText={hideCommunity ? SAMPLE_EMPTY_TEXT : undefined} />
        </EntitySection>
        <EntitySection id="reviews" title="Reviews">
          <ReviewList reviews={shownReviews} showSubject emptyText={hideCommunity ? SAMPLE_EMPTY_TEXT : 'No reviews for this model yet.'} />
        </EntitySection>
      </div>

      <div className="split">
        <EntitySection id="lineage" title="Lineage" intro="How this model’s variants relate to each other and to other models.">
          <div className="lineage surface">
            {roots.map((root) => (
              <div key={root.slug}>
                <div className="node-row root"><span className="edge" /><EntityMark type="variant" /><span><a href={`#${root.slug}`} style={{ fontWeight: 600 }}>{root.name}</a> <span className="rel">{humanize(root.kind)}</span>
                  {root.lineage.filter((l) => l.direction === 'outgoing' && !inModel.has(l.slug)).map((l) => (
                    <span key={l.slug} className="rel">· {LINEAGE_LABEL[l.predicate]?.[0] ?? humanize(l.predicate)} {l.modelSlug ? <Link className="link" href={`/models/${l.modelSlug}#${l.slug}`}>{l.name}</Link> : l.name}</span>
                  ))}
                </span></div>
                {childrenOf(root.slug).map((c) => (
                  <div key={c.slug} className="node-row" style={{ paddingLeft: 18 }}>
                    <span className="edge" /><EntityMark type="variant" />
                    <span><a href={`#${c.slug}`} style={{ fontWeight: 600 }}>{c.name}</a> <span className="rel">{LINEAGE_LABEL[parentOf(c)!.predicate]?.[0] ?? humanize(parentOf(c)!.predicate)} {root.name}</span>
                      {c.lineage.filter((l) => l.direction === 'outgoing' && !inModel.has(l.slug)).map((l) => (
                        <span key={l.slug} className="rel">· {LINEAGE_LABEL[l.predicate]?.[0] ?? humanize(l.predicate)} {l.modelSlug ? <Link className="link" href={`/models/${l.modelSlug}#${l.slug}`}>{l.name}</Link> : l.name}</span>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            ))}
            {model.variants.flatMap((v) => v.lineage.filter((l) => l.direction === 'incoming' && !inModel.has(l.slug)).map((l) => (
              <div key={v.slug + l.slug} className="node-row" style={{ paddingLeft: 18 }}>
                <span className="edge" /><EntityMark type="variant" />
                <span>{l.modelSlug ? <Link className="link" href={`/models/${l.modelSlug}#${l.slug}`}>{l.name}</Link> : l.name} <span className="rel">{LINEAGE_LABEL[l.predicate]?.[0] ?? humanize(l.predicate)} {v.name}</span></span>
              </div>
            )))}
          </div>
        </EntitySection>
        <EntitySection id="sources" title="Sources & history">
          <ProvenanceBlock provenance={provenance} />
          {events.length > 0 && (
            <>
              <h3 className="subhead">Timeline</h3>
              <ol className="timeline">
                {events.map((e) => <li key={e.id}><time dateTime={isoDate(e.occurredAt)}>{formatDate(e.occurredAt)}</time><div className="small">{e.title}</div></li>)}
              </ol>
            </>
          )}
        </EntitySection>
      </div>
    </>
  );
}
