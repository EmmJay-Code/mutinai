import { catalog, community, getDb } from '@mutinai/db';
import { CAPABILITY_AXES, RESULT_ORIGIN_TEXT } from '@mutinai/domain';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Empty, Explain, OriginBasis, PageHead } from '@/components/ui';
import { FrontierChart } from '@/components/viz';
import { formatContext, formatDate, formatNumber } from '@/lib/format';
import { measurementPolicy } from '@/lib/community-visibility';

export const metadata: Metadata = { title: 'Benchmarks' };

const GEN_KEYS = ['tg128', 'gen_tps'];
const PROMPT_KEYS = ['pp512', 'prompt_tps'];

const AXIS_OF: Record<string, string> = Object.fromEntries(CAPABILITY_AXES.flatMap((a) => a.benchmarks.map((b) => [b, a.label])));

/**
 * The drill-down behind Discover's "How they compare": every benchmark Mutinai holds results for, what it measures,
 * and the best open result recorded for it. Mutinai does not run capability evaluations: a score is either the
 * developer's own report or a benchmark's maintainers running every model themselves (BFCL), and the page labels
 * each benchmark with the origins its scores actually have rather than presenting a leaderboard as measurement.
 */
export default async function BenchmarksPage() {
  const db = getDb();
  const includeMembers = measurementPolicy().includeCommunityMeasurements;
  const [benchmarks, best, runs, submissions, models] = await Promise.all([
    catalog.listBenchmarks(db),
    catalog.listBenchmarkScores(db),
    catalog.listAllPerformanceResults(db),
    includeMembers ? community.listSubmissions(db, {}, undefined, 200) : Promise.resolve([]),
    catalog.listModels(db),
  ]);
  // The table holds every measurement the rest of the site treats as measured: reference results, plus verified
  // member runs on reference systems wherever the deployment counts those (the same policy as "What can I run?").
  type SpeedRow = { key: string; modelSlug: string; modelName: string; scheme: string; system: { slug: string; name: string }; runtime: { slug: string; name: string }; detail: string; contextLength: number | null; gen: number | null; prompt: number | null; test: string; who: string };
  const pick = (metrics: { key: string; value: number }[], keys: string[]) => metrics.find((m) => keys.includes(m.key))?.value ?? null;
  const speedRows: SpeedRow[] = [
    ...runs.map((r) => ({
      key: r.environmentId, modelSlug: r.modelSlug, modelName: r.modelName, scheme: r.schemeName, system: r.configuration, runtime: r.runtime,
      detail: [r.backend, r.runtimeVersion].filter(Boolean).join(' · '), contextLength: r.contextLength, gen: pick(r.metrics, GEN_KEYS), prompt: pick(r.metrics, PROMPT_KEYS),
      test: r.benchmarkName, who: `${RESULT_ORIGIN_TEXT[r.origin]?.label ?? r.origin}${r.sourceName ? ` · ${r.sourceName}` : ''}`,
    })),
    ...submissions.flatMap((x) => (x.verification === 'verified' && x.hardware.type === 'reference' ? [{
      key: x.id, modelSlug: x.artifact.modelSlug, modelName: models.find((m) => m.slug === x.artifact.modelSlug)?.name ?? x.artifact.variantName, scheme: x.artifact.schemeName,
      system: { slug: x.hardware.slug, name: x.hardware.name }, runtime: x.runtime, detail: [x.environment.backend, x.environment.runtimeVersion].filter(Boolean).join(' · '),
      contextLength: x.environment.contextLength, gen: pick(x.measurements, GEN_KEYS), prompt: pick(x.measurements, PROMPT_KEYS), test: x.benchmark.name, who: `verified member run · @${x.submitter.handle}`,
    }] : [])),
  ].sort((a, b) => a.modelName.localeCompare(b.modelName) || (b.gen ?? 0) - (a.gen ?? 0));
  const withResults = benchmarks.filter((b) => b.resultCount > 0);
  const frontiers = Object.fromEntries(
    (await Promise.all(withResults.filter((b) => b.kind === 'capability').map(async (b) => [b.slug, await catalog.benchmarkFrontier(db, b.slug)] as const))).filter(([, f]) => f),
  );
  const leadersOf = (slug: string) => best.filter((s) => s.benchmarkSlug === slug).sort((a, b) => b.value - a.value).slice(0, 5);
  const groups = [
    { kind: 'capability', title: 'What models can do', intro: 'Fixed question sets a model answers. Each score says who produced it: the model’s developer, or the benchmark’s own maintainers running every model the same way.' },
    { kind: 'performance', title: 'How fast they run', intro: 'Throughput measured on real hardware, by projects and by members. Speed depends on the machine, the runtime and the settings.' },
  ];

  return (
    <>
      <PageHead
        eyebrow="Benchmarks"
        title="How open models are compared"
        lede={<>A <Explain term="benchmark" /> is a fixed set of questions or a repeatable measurement, so different models can be put on the same scale. Mutinai records who reported each result and when.</>}
      />
      {!withResults.length && <Empty>No benchmark results are tracked yet.</Empty>}
      {groups.map((group) => {
        const list = withResults.filter((b) => b.kind === group.kind);
        if (!list.length) return null;
        return (
          <section key={group.kind} className="section" aria-labelledby={`bg-${group.kind}`}>
            <div className="section-head">
              <div>
                <h2 id={`bg-${group.kind}`}>{group.title}</h2>
                <p>{group.intro}</p>
              </div>
            </div>
            <ul className="list-plain">
              {list.map((b) => {
                const leaders = leadersOf(b.slug);
                const frontier = frontiers[b.slug];
                return (
                  <li key={b.slug} className="bench-entry">
                    <div>
                      <h3 className="name">{b.name}{AXIS_OF[b.slug] && <span className="small muted"> · counts towards {AXIS_OF[b.slug]}</span>}</h3>
                      {b.summary && <p className="small" style={{ margin: '2px 0 0', color: 'var(--ink-2)' }}>{b.summary}</p>}
                      <p className="small muted" style={{ margin: '4px 0 0' }}>
                        {b.metrics.map((m) => `${m.label} (${m.unit}, ${m.higherIsBetter ? 'higher is better' : 'lower is better'})`).join(' · ')} ·{' '}
                        {group.kind === 'performance' ? `${b.runCount} measured run${b.runCount === 1 ? '' : 's'}` : `${b.resultCount} recorded result${b.resultCount === 1 ? '' : 's'}`}
                      </p>
                      {group.kind === 'capability' && leaders.length > 0 && (
                        <p className="small" style={{ margin: '6px 0 0' }}>
                          <OriginBasis origins={best.filter((s) => s.benchmarkSlug === b.slug).map((s) => s.origin)} />
                        </p>
                      )}
                    </div>
                    <div>
                      {leaders.length > 0 ? (
                        <ol className="bench-list">
                          {leaders.map((s) => (
                            <li key={s.modelSlug}>
                              <Link className="name" href={`/models/${s.modelSlug}`}>{s.modelName}</Link>
                              <span className="val">{s.value.toFixed(1)}</span>
                              <span className="src small muted">{s.releasedOn ? formatDate(s.releasedOn) : ''}</span>
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <p className="small muted">{b.runCount} run{b.runCount === 1 ? '' : 's'} — every one is in <a className="link" href="#speed-results">the table below</a>, by model, system and runtime.</p>
                      )}
                    </div>
                    {/* A step chart needs a few steps to say anything; with one or two results the list above already says it. */}
                    {frontier && frontier.points.length > 2 && (
                      <figure className="trend-panel" style={{ gridColumn: '1 / -1', maxWidth: 560 }}>
                        <figcaption>
                          <h3>Best open score over time</h3>
                          <p>Each step is a release that beat the previous best recorded open result.</p>
                        </figcaption>
                        <FrontierChart points={frontier.points} width={460} height={150} />
                      </figure>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {speedRows.length > 0 && (
        <section className="section" id="speed-results" aria-labelledby="speed-results-h">
          <div className="section-head">
            <div>
              <h2 id="speed-results-h">Measured speed, every run</h2>
              <p>Tokens per second for one model download, on one system, with one runtime. Generation is how fast it writes; prompt processing is how fast it reads what you give it.</p>
            </div>
          </div>
          <div className="table-wrap">
            <table className="data speed-table">
              <thead>
                <tr><th>Model</th><th>System</th><th>Runtime</th><th className="r">Context</th><th className="r">Generation</th><th className="r">Prompt</th><th>Test · who measured</th></tr>
              </thead>
              <tbody>
                {speedRows.map((r) => (
                  <tr key={r.key}>
                    <td><Link className="primary" href={`/models/${r.modelSlug}#performance`}>{r.modelName}</Link><span className="sub mono">{r.scheme}</span></td>
                    <td><Link href={`/hardware/systems/${r.system.slug}`}>{r.system.name.replace(/\s*\(.*\)$/, '')}</Link></td>
                    <td><Link href={`/tools/${r.runtime.slug}`}>{r.runtime.name}</Link><span className="sub mono">{r.detail}</span></td>
                    <td className="r num">{r.contextLength ? formatContext(r.contextLength) : '—'}</td>
                    <td className="r num">{r.gen != null ? <><span className="val-measured">{formatNumber(r.gen)}</span> <span className="small muted">tok/s</span></> : '—'}</td>
                    <td className="r num">{r.prompt != null ? <>{formatNumber(r.prompt)} <span className="small muted">tok/s</span></> : '—'}</td>
                    <td className="small">{r.test}<span className="sub">{r.who}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <p className="small muted" style={{ marginTop: 'var(--s5)' }}>
        Developer-reported scores use each lab’s own prompts and settings, so numbers from different labs are not exactly
        comparable; a benchmark that runs every model itself uses one setup for all of them. Use them to shortlist, then look at <Link className="link" href="/community">what members measured</Link> on hardware like yours.
      </p>
    </>
  );
}
