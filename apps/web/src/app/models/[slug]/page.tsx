import { catalog, community, getDb } from '@mutinai/db';
import { compat } from '@mutinai/domain';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PerformanceTable, ProvenanceBlock, RatingSummary, ReviewList, SubmissionTable } from '@/components/results';
import { Basis, Empty, Facts, KindTag, PageHead, Section, Tag } from '@/components/ui';
import { formatBytes, formatContext, formatDate, formatNumber, formatParams, humanize, isoDate } from '@/lib/format';
import { getViewer } from '@/lib/session';

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const m = await catalog.getModelDetail(getDb(), (await params).slug);
  return { title: m?.name ?? 'Model not found' };
}

const LINEAGE_LABEL: Record<string, [string, string]> = {
  fine_tuned_from: ['Fine-tuned from', 'Fine-tuned into'],
  distilled_from: ['Distilled from', 'Teacher for'],
  merged_from: ['Merged from', 'Merged into'],
};

export default async function ModelPage({ params }: { params: Params }) {
  const { slug } = await params;
  const db = getDb();
  const model = await catalog.getModelDetail(db, slug);
  if (!model) notFound();
  const viewer = await getViewer();

  const subjectIds = model.variants.flatMap((v) => [v.id, ...v.artifacts.map((a) => a.id)]);
  const release = await catalog.getEntityRef(db, 'model_release', model.release.slug);
  const [reviews, submissions, events, provenances, ...aggregates] = await Promise.all([
    community.listReviewsForEntities(db, subjectIds, viewer),
    community.listSubmissions(db, { modelId: model.id }, viewer),
    release ? catalog.listEvents(db, { entityId: release.id, limit: 10 }) : Promise.resolve([]),
    Promise.all(model.variants.map((v) => catalog.getProvenance(db, v.id))),
    ...model.variants.map((v) => community.ratingAggregates(db, [v.id, ...v.artifacts.map((a) => a.id)])),
  ]);

  const provenance: catalog.ProvenanceDTO = {
    externalIds: provenances.flatMap((p) => p.externalIds),
    sources: Object.values(
      Object.fromEntries(provenances.flatMap((p) => p.sources).map((s) => [s.key, s])),
    ),
    assertions: provenances.flatMap((p) => p.assertions),
  };

  const spec = { paramsTotal: model.paramsTotal, paramsActive: model.paramsActive, layers: model.layers, kvHeads: model.kvHeads, headDim: model.headDim, kvBytesPerTokenOverride: model.kvBytesPerTokenOverride, contextLength: model.contextLength };
  const kvPer8k = compat.kvCacheGb(spec, 8192);
  const benchmarks = [...new Set(model.capabilityResults.map((r) => r.benchmarkSlug))];
  const variantsWithResults = model.variants.filter((v) => model.capabilityResults.some((r) => r.variantSlug === v.slug));

  return (
    <>
      <PageHead
        crumbs={[
          { href: '/models', label: 'Models' },
          { href: `/models?developer=${model.developer.slug}`, label: model.developer.name },
          { href: `/models?family=${model.family.slug}`, label: model.family.parent ? `${model.family.parent.name} › ${model.family.name}` : model.family.name },
          { label: model.release.name },
        ]}
        eyebrow="Model"
        title={model.name}
        lede={model.summary ?? model.release.summary}
      >
        <Tag>{model.architecture === 'moe' ? 'Mixture of experts' : 'Dense'}</Tag>
        <Tag>{formatParams(model.paramsTotal)} params</Tag>
        <Tag>{formatContext(model.contextLength)} context</Tag>
        <Link className="btn btn-small" href={`/contribute/benchmark?model=${model.slug}`}>Submit a benchmark run</Link>
      </PageHead>

      <div className="grid grid-main-aside">
        <div>
          <Facts
            items={[
              ['Developer', <Link key="d" href={`/models?developer=${model.developer.slug}`}>{model.developer.name}</Link>],
              ['Release', <span key="r">{model.release.name} · {formatDate(model.release.releasedOn)}</span>],
              ['Parameters', <span key="p" className="num">{formatNumber(model.paramsTotal / 1e9, 2)}B</span>],
              ['Active / token', model.paramsActive ? <span key="a" className="num">{formatNumber(model.paramsActive / 1e9, 1)}B</span> : 'All (dense)'],
              ['Layers', <span key="l" className="num">{model.layers}</span>],
              ['Attention', <span key="h" className="num">{model.attentionHeads} heads · {model.kvHeads} KV</span>],
              ['Head dim', <span key="hd" className="num">{model.headDim}</span>],
              ['KV cache @ 8K (fp16)', <span key="kv" className="num" title={model.kvBytesPerTokenOverride ? 'Architecture-specific KV size' : 'Standard GQA formula'}>{formatNumber(kvPer8k, 2)} GiB</span>],
              ['Max context', <span key="c" className="num">{model.contextLength.toLocaleString('en-US')} tokens</span>],
              ['Variants', <span key="v" className="num">{model.variants.length}</span>],
            ]}
          />

          <Section title="Variants and quantizations" id="variants">
            {model.variants.map((v, i) => {
              const thirdParty = v.publisher.slug !== model.developer.slug;
              return (
                <div key={v.slug} id={v.slug} className="panel" style={{ marginBottom: 14 }}>
                  <div className="panel-pad" style={{ borderBottom: '1px solid var(--rule)' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 12px', alignItems: 'baseline', justifyContent: 'space-between' }}>
                      <h3 style={{ fontSize: 15 }}>{v.name}</h3>
                      <div className="tags">
                        <Tag>{humanize(v.kind)}</Tag>
                        {v.capabilities.map((c) => <Tag key={c}>{humanize(c)}</Tag>)}
                      </div>
                    </div>
                    <dl className="kv" style={{ marginTop: 8 }}>
                      <dt>Publisher</dt>
                      <dd>{v.publisher.name}{thirdParty && <span className="faint"> · third-party</span>}</dd>
                      <dt>License</dt>
                      <dd>{v.license ? <>{v.license.url ? <a href={v.license.url} rel="noopener noreferrer">{v.license.name}</a> : v.license.name} <span className="faint">· commercial use {v.license.commercialUse}</span></> : 'Unknown'}</dd>
                      {v.lineage.map((l, j) => (
                        <div key={j} style={{ display: 'contents' }}>
                          <dt>{LINEAGE_LABEL[l.predicate]?.[l.direction === 'outgoing' ? 0 : 1] ?? humanize(l.predicate)}</dt>
                          <dd>{l.modelSlug ? <Link href={`/models/${l.modelSlug}#${l.slug}`}>{l.name}</Link> : l.name}</dd>
                        </div>
                      ))}
                      {v.externalIds.map((x) => (
                        <div key={x.value} style={{ display: 'contents' }}>
                          <dt>{x.namespace}</dt>
                          <dd className="mono">{x.url ? <a href={x.url} rel="noopener noreferrer">{x.value}</a> : x.value}</dd>
                        </div>
                      ))}
                    </dl>
                    {aggregates[i] && aggregates[i]!.length > 0 && (
                      <div style={{ marginTop: 10, maxWidth: 520 }}>
                        <RatingSummary aggregates={aggregates[i]!} />
                      </div>
                    )}
                    <div style={{ marginTop: 10 }} className="tags">
                      <Link className="btn btn-small" href={`/contribute/review?entity=model_variant:${v.slug}&returnTo=${encodeURIComponent(`/models/${model.slug}#${v.slug}`)}`}>Review this variant</Link>
                    </div>
                  </div>
                  {v.artifacts.length ? (
                    <div style={{ overflowX: 'auto' }}>
                      <table className="data">
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
                  ) : (
                    <div className="panel-pad muted small">No downloadable artifacts recorded.</div>
                  )}
                </div>
              );
            })}
          </Section>

          <Section title="Capability benchmarks" id="benchmarks" more={<Basis kind="source">developer-reported · illustrative</Basis>}>
            {benchmarks.length === 0 ? (
              <Empty>No capability results recorded for this model.</Empty>
            ) : (
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
                                    <a className="source-mark" href="#provenance" title={`${humanize(r.origin)} · ${r.sourceName ?? 'unknown source'}${r.evaluationSetting ? ` · ${r.evaluationSetting}` : ''}`}>src</a>
                                    {r.evaluationSetting && <span className="sub">{r.evaluationSetting}</span>}
                                  </>
                                ) : (
                                  <span className="faint">—</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="small muted" style={{ marginTop: 6 }}>Developer-reported scores use different prompts and settings; compare across models with care.</p>
          </Section>

          <Section title="Measured performance" id="performance">
            <PerformanceTable results={model.performanceResults} />
          </Section>

          <Section title="Community benchmark runs" id="community-runs" more={<Link href={`/contribute/benchmark?model=${model.slug}`}>Submit a run →</Link>}>
            <SubmissionTable submissions={submissions} />
          </Section>

          <Section title="Reviews" id="reviews">
            <ReviewList reviews={reviews} showSubject emptyText="No reviews for this model's variants yet." />
          </Section>
        </div>

        <aside>
          <div className="aside-block">
            <ProvenanceBlock provenance={provenance} />
          </div>
          {model.siblings.length > 0 && (
            <div className="aside-block panel panel-pad">
              <h3 style={{ marginBottom: 6 }}>Also in {model.release.name}</h3>
              <ul className="list-plain">
                {model.siblings.map((s) => (
                  <li key={s.slug}><Link href={`/models/${s.slug}`}>{s.name}</Link> <span className="small muted num">{formatParams(s.paramsTotal)}</span></li>
                ))}
              </ul>
            </div>
          )}
          {events.length > 0 && (
            <div className="aside-block panel panel-pad">
              <h3 style={{ marginBottom: 6 }}>Timeline</h3>
              <ol className="timeline">
                {events.map((e) => (
                  <li key={e.id}>
                    <time dateTime={isoDate(e.occurredAt)}>{formatDate(e.occurredAt)}</time>
                    <div className="small">{e.title} <KindTag kind={e.kind} /></div>
                  </li>
                ))}
              </ol>
            </div>
          )}
          <div className="aside-block panel panel-pad small">
            <h3 style={{ marginBottom: 6 }}>Estimating memory</h3>
            <p className="muted">
              “Memory @ 8K” adds fp16 KV cache for 8,192 tokens and runtime overhead to the file size. Use <Link href="/run">What can I run?</Link> for
              your exact hardware, runtime and context.
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}
