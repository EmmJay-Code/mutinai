import { catalog, community, compatQueries, getDb } from '@mutinai/db';
import { compat } from '@mutinai/domain';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PerformanceTable, ProvenanceBlock, RatingSummary, ReviewList, SubmissionList } from '@/components/results';
import { Basis, Crumbs, Disclosure, Empty, EntitySection, Facts, FitBadge, Glance, LicenseShort, SectionNav, Speed, Tag } from '@/components/ui';
import { CAPABILITY_LABEL, formatBytes, formatContext, formatDate, formatMonthYear, formatNumber, formatParams, humanize, isoDate, paramsInWords, VARIANT_KIND_EXPLAINER } from '@/lib/format';
import { getViewer } from '@/lib/session';

type Params = Promise<{ slug: string }>;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const m = await catalog.getModelDetail(getDb(), (await params).slug);
  return { title: m?.name ?? 'Model not found' };
}

const LINEAGE_LABEL: Record<string, [string, string]> = {
  fine_tuned_from: ['is fine-tuned from', 'was fine-tuned into'],
  distilled_from: ['is distilled from', 'was distilled into'],
  merged_from: ['is merged from', 'was merged into'],
};

const SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'compatibility', label: 'Compatibility' },
  { id: 'performance', label: 'Performance' },
  { id: 'variants', label: 'Variants & downloads' },
  { id: 'benchmarks', label: 'Benchmarks' },
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
  const [reviews, submissions, events, provenances, systems, listItem, allAggregates, ...aggregates] = await Promise.all([
    community.listReviewsForEntities(db, subjectIds, viewer),
    community.listSubmissions(db, { modelId: model.id }, viewer),
    release ? catalog.listEvents(db, { entityId: release.id, limit: 10 }) : Promise.resolve([]),
    Promise.all(model.variants.map((v) => catalog.getProvenance(db, v.id))),
    compatQueries.compatForModelAcrossSystems(db, model.slug, { contextLength: 8192 }),
    catalog.listModels(db, { q: undefined }).then((l) => l.find((m) => m.slug === model.slug)),
    community.ratingAggregates(db, subjectIds),
    ...model.variants.map((v) => community.ratingAggregates(db, [v.id, ...v.artifacts.map((a) => a.id)])),
  ]);

  const provenance: catalog.ProvenanceDTO = {
    externalIds: provenances.flatMap((p) => p.externalIds),
    sources: Object.values(Object.fromEntries(provenances.flatMap((p) => p.sources).map((s) => [s.key, s]))),
    assertions: provenances.flatMap((p) => p.assertions),
  };

  const spec = { paramsTotal: model.paramsTotal, paramsActive: model.paramsActive, layers: model.layers, kvHeads: model.kvHeads, headDim: model.headDim, kvBytesPerTokenOverride: model.kvBytesPerTokenOverride, contextLength: model.contextLength };
  const kvPer8k = compat.kvCacheGb(spec, Math.min(8192, model.contextLength));
  const benchmarks = [...new Set(model.capabilityResults.map((r) => r.benchmarkSlug))];
  const variantsWithResults = model.variants.filter((v) => model.capabilityResults.some((r) => r.variantSlug === v.slug));
  const usable = model.variants.filter((v) => v.kind !== 'base');
  const licenses = [...new Map(model.variants.flatMap((v) => (v.license ? [[v.license.name, v.license] as const] : []))).values()];
  const commercial = licenses.some((l) => l.commercialUse === 'allowed') ? 'allowed' : licenses[0]?.commercialUse;
  const lineage = model.variants.flatMap((v) => v.lineage.map((l) => ({ ...l, variant: v })));

  const runsWell = systems.filter((s) => s.best?.result.placement === 'accelerator');
  const slowly = systems.filter((s) => s.best && s.best.result.placement !== 'accelerator');
  const tooLarge = systems.filter((s) => !s.best);

  const archPhrase = model.architecture === 'moe'
    ? `mixture-of-experts model that uses about ${paramsInWords(model.paramsActive ?? 0)} of its parameters per token`
    : 'dense model';

  return (
    <>
      <Crumbs crumbs={[
        { href: '/models', label: 'Models' },
        { href: `/models?developer=${model.developer.slug}`, label: model.developer.name },
        { href: `/models?family=${model.family.slug}`, label: model.family.name },
      ]} />
      <header className="entity-hero">
        <div className="eyebrow">Model · {model.release.name}</div>
        <h1>{model.name}</h1>
        <p className="lede">
          A {paramsInWords(model.paramsTotal)}-parameter {archPhrase} from {model.developer.name}
          {model.release.releasedOn ? `, released in ${formatMonthYear(model.release.releasedOn)}` : ''}. {model.release.summary}
        </p>
        <Glance
          items={[
            ['Size', `${formatParams(model.paramsTotal)} parameters`, model.paramsActive ? `${formatParams(model.paramsActive)} active per token` : undefined],
            ['Memory to run', listItem?.minMemoryGb != null ? `from ~${Math.ceil(listItem.minMemoryGb)} GB` : '—', 'smallest download, 8K context'],
            ['Context', `${formatContext(model.contextLength)} tokens`],
            ['License', <LicenseShort key="l" commercialUse={commercial} />, licenses.map((l) => l.name).join('; ')],
            ['Community', plural(listItem?.reviewCount ?? 0, 'review'), plural(listItem?.runCount ?? 0, 'benchmark run')],
          ]}
        />
        <div className="page-head-actions">
          <a className="btn btn-primary" href="#compatibility">Where does it run?</a>
          <Link className="btn" href={`/models/compare?m=${model.slug}${model.siblings[0] ? `&m=${model.siblings[0].slug}` : ''}`}>Compare</Link>
          <Link className="btn" href={`/contribute/benchmark?model=${model.slug}`}>Submit a benchmark run</Link>
        </div>
      </header>

      <SectionNav items={SECTIONS} />

      <EntitySection id="overview" title="Overview">
        <div className="split-wide">
          <div>
            <h3 className="subhead" style={{ marginTop: 0 }}>Which version should I use?</h3>
            <ul className="list-plain">
              {(usable.length ? usable : model.variants).map((v) => (
                <li key={v.slug}>
                  <a href={`#${v.slug}`} style={{ fontWeight: 600, textDecoration: 'none' }}>{v.name}</a>{' '}
                  <span className="small muted">by {v.publisher.name}</span>
                  <div className="small muted">{VARIANT_KIND_EXPLAINER[v.kind] ?? humanize(v.kind)}</div>
                  <div className="tags" style={{ marginTop: 4 }}>
                    {v.capabilities.filter((c) => c !== 'multilingual').map((c) => <Tag key={c}>{CAPABILITY_LABEL[c] ?? humanize(c)}</Tag>)}
                  </div>
                </li>
              ))}
            </ul>
            {model.summary && <p className="small muted" style={{ marginTop: 'var(--s4)' }}>Note: {model.summary}</p>}
          </div>
          <aside>
            {allAggregates.length > 0 && (
              <div className="aside-block">
                <h3 className="subhead" style={{ marginTop: 0 }}>What the community says</h3>
                <RatingSummary aggregates={allAggregates} />
              </div>
            )}
            {model.siblings.length > 0 && (
              <div className="aside-block">
                <h3 className="subhead" style={{ marginTop: 0 }}>Other sizes in {model.release.name}</h3>
                <ul className="list-plain">
                  {model.siblings.map((s) => <li key={s.slug}><Link href={`/models/${s.slug}`}>{s.name}</Link> <span className="small muted num">{formatParams(s.paramsTotal)}</span></li>)}
                </ul>
              </div>
            )}
          </aside>
        </div>
      </EntitySection>

      <EntitySection id="compatibility" title="Where it runs" intro="The best-fitting version on each reference system at 8K context. Check your own setup for exact numbers.">
        {systems.length === 0 ? <Empty>No downloadable versions recorded yet.</Empty> : (
          <div className="fit-groups">
            {[
              { title: 'Runs well', list: runsWell },
              { title: 'Runs, but slowly (CPU or offload)', list: slowly },
              { title: 'Too large', list: tooLarge },
            ].map((g) => (
              <div key={g.title}>
                <h3>{g.title} <span className="muted num">{g.list.length}</span></h3>
                {g.list.length === 0 ? <p className="small muted">None of the reference systems.</p> : (
                  <ul>
                    {g.list.map((s) => (
                      <li key={s.system.slug}>
                        <Link href={`/run?system=${s.system.slug}`}>{s.system.name}</Link>
                        {s.best && (
                          <div className="small muted">
                            {s.best.row.schemeName} · {s.best.runtime.name} · <FitBadge fit={s.best.result.fit} /> · <Speed speed={s.best.result.speed} />
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
        <p style={{ marginTop: 'var(--s5)' }}><Link className="btn" href="/run">Check your own hardware →</Link></p>
      </EntitySection>

      <EntitySection id="performance" title="Measured performance" intro="Throughput measured on specific systems and runtimes, with the source of each measurement.">
        <PerformanceTable results={model.performanceResults} />
      </EntitySection>

      <EntitySection id="variants" title="Variants & downloads" intro="Each variant is a separate set of weights. Expand one to see its quantized downloads, sizes and memory needs.">
        {model.variants.map((v, i) => {
          const thirdParty = v.publisher.slug !== model.developer.slug;
          return (
            <Disclosure
              key={v.slug}
              id={v.slug}
              title={v.name}
              meta={`${humanize(v.kind)} · ${v.publisher.name}${thirdParty ? ' (third-party)' : ''} · ${v.artifacts.length} download${v.artifacts.length === 1 ? '' : 's'}${v.license ? ` · ${v.license.name}` : ''}`}
            >
              <div className="split-wide">
                <dl className="kv">
                  <dt>What it is</dt><dd>{VARIANT_KIND_EXPLAINER[v.kind] ?? humanize(v.kind)}</dd>
                  <dt>Publisher</dt><dd>{v.publisher.name}</dd>
                  <dt>License</dt>
                  <dd>{v.license ? <>{v.license.url ? <a href={v.license.url} rel="noopener noreferrer">{v.license.name}</a> : v.license.name} <span className="faint">· commercial use {v.license.commercialUse}</span></> : 'Unknown'}</dd>
                  {v.releasedOn && <><dt>Released</dt><dd>{formatDate(v.releasedOn)}</dd></>}
                  {v.externalIds.map((x) => (
                    <div key={x.value} style={{ display: 'contents' }}>
                      <dt>{x.namespace}</dt>
                      <dd className="mono">{x.url ? <a href={x.url} rel="noopener noreferrer">{x.value}</a> : x.value}</dd>
                    </div>
                  ))}
                </dl>
                <div>
                  {aggregates[i] && aggregates[i]!.length > 0 ? <RatingSummary aggregates={aggregates[i]!} /> : <p className="small muted">No ratings for this variant yet.</p>}
                  <p style={{ marginTop: 'var(--s3)' }}>
                    <Link className="btn btn-small" href={`/contribute/review?entity=model_variant:${v.slug}&returnTo=${encodeURIComponent(`/models/${model.slug}#${v.slug}`)}`}>Review this variant</Link>
                  </p>
                </div>
              </div>
              {v.artifacts.length ? (
                <div className="table-wrap" style={{ marginTop: 'var(--s4)' }}>
                  <table className="data dense">
                    <thead>
                      <tr>
                        <th>Quantization</th>
                        <th>Format</th>
                        <th className="r">Bits/weight</th>
                        <th className="r">Download</th>
                        <th className="r" title="Weights + fp16 KV cache at 8K context + runtime overhead">Memory @ 8K</th>
                        <th>Publisher</th>
                      </tr>
                    </thead>
                    <tbody>
                      {v.artifacts.map((a) => {
                        const need = compat.weightsGb({ id: a.id, format: a.format as 'gguf', bitsPerWeight: a.bitsPerWeight, sizeBytes: a.sizeBytes, model: spec });
                        const total = need + kvPer8k + compat.COMPAT_CONSTANTS.baseOverheadGb + need * compat.COMPAT_CONSTANTS.overheadPerWeightGb;
                        return (
                          <tr key={a.slug} id={a.slug}>
                            <td><span className="primary">{a.schemeName}</span><span className="sub">{humanize(a.method)}</span></td>
                            <td>{a.format}</td>
                            <td className="r num">{a.bitsPerWeight}</td>
                            <td className="r num">{formatBytes(a.sizeBytes)}</td>
                            <td className="r"><span className="val-estimated">~{total.toFixed(1)} GiB</span></td>
                            <td>
                              {a.publisher.name}
                              {a.sourceRepo && <span className="sub mono"><a href={`https://huggingface.co/${a.sourceRepo}`} rel="noopener noreferrer">{a.sourceRepo}</a></span>}
                            </td>
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
              ['KV cache @ 8K (fp16)', <span key="kv" className="num" title={model.kvBytesPerTokenOverride ? 'Architecture-specific KV size' : 'Standard GQA formula'}>{formatNumber(kvPer8k, 2)} GiB</span>],
              ['Max context', <span key="c" className="num">{model.contextLength.toLocaleString('en-US')} tokens</span>],
            ]}
          />
        </Disclosure>
      </EntitySection>

      <EntitySection id="benchmarks" title="Benchmarks" intro="Scores reported by developers. Prompts and settings differ between labs, so use these to shortlist rather than to rank.">
        {benchmarks.length === 0 ? <Empty>No benchmark results recorded for this model.</Empty> : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Benchmark</th>
                  {variantsWithResults.map((v) => <th key={v.slug} className="r">{v.name}</th>)}
                </tr>
              </thead>
              <tbody>
                {benchmarks.map((b) => {
                  const rows = model.capabilityResults.filter((r) => r.benchmarkSlug === b);
                  return (
                    <tr key={b}>
                      <td><span className="primary">{rows[0]!.benchmarkName}</span><span className="sub">{rows[0]!.metric.label}</span></td>
                      {variantsWithResults.map((v) => {
                        const r = rows.find((x) => x.variantSlug === v.slug);
                        return (
                          <td key={v.slug} className="r">
                            {r ? (
                              <>
                                <span className="val-measured">{r.metric.value.toFixed(1)}</span><span className="small muted">{r.metric.unit}</span>
                                <a className="source-mark" href="#sources" title={`${humanize(r.origin)} · ${r.sourceName ?? 'unknown source'}${r.evaluationSetting ? ` · ${r.evaluationSetting}` : ''}`}>src</a>
                                {r.evaluationSetting && <span className="sub">{r.evaluationSetting}</span>}
                              </>
                            ) : <span className="faint">—</span>}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="small muted" style={{ marginTop: 'var(--s2)' }}><Basis kind="source">developer-reported · illustrative</Basis></p>
          </div>
        )}
      </EntitySection>

      <EntitySection id="community-runs" title="Community results" intro="Benchmark runs submitted by members, with the full environment needed to reproduce them.">
        <SubmissionList submissions={submissions} />
        <p style={{ marginTop: 'var(--s4)' }}><Link href={`/contribute/benchmark?model=${model.slug}`}>Submit your own run →</Link></p>
      </EntitySection>

      <EntitySection id="reviews" title="Reviews">
        <ReviewList reviews={reviews} showSubject emptyText="No reviews for this model yet." />
      </EntitySection>

      <EntitySection id="lineage" title="Lineage" intro="How this model’s variants relate to others: fine-tunes, distillations and merges.">
        {lineage.length === 0 ? <Empty>No lineage relationships recorded.</Empty> : (
          <ul className="list-plain">
            {lineage.map((l, i) => (
              <li key={i}>
                <a href={`#${l.variant.slug}`}>{l.variant.name}</a> {LINEAGE_LABEL[l.predicate]?.[l.direction === 'outgoing' ? 0 : 1] ?? humanize(l.predicate)}{' '}
                {l.modelSlug ? <Link href={`/models/${l.modelSlug}#${l.slug}`}>{l.name}</Link> : l.name}
              </li>
            ))}
          </ul>
        )}
      </EntitySection>

      <EntitySection id="sources" title="Sources & history" intro="Where this information comes from, and how it has changed.">
        <div className="split">
          <ProvenanceBlock provenance={provenance} />
          <div>
            <h3 className="subhead" style={{ marginTop: 'var(--s4)' }}>Timeline</h3>
            {events.length === 0 ? <p className="small muted">No events recorded.</p> : (
              <ol className="timeline">
                {events.map((e) => (
                  <li key={e.id}>
                    <time dateTime={isoDate(e.occurredAt)}>{formatDate(e.occurredAt)}</time>
                    <div className="small">{e.title}</div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </EntitySection>
    </>
  );
}
