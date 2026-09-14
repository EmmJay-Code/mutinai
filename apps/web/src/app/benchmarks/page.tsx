import { catalog, getDb } from '@mutinai/db';
import { CAPABILITY_AXES } from '@mutinai/domain';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Basis, Empty, Explain, PageHead } from '@/components/ui';
import { FrontierChart } from '@/components/viz';
import { formatDate } from '@/lib/format';

export const metadata: Metadata = { title: 'Benchmarks' };

const AXIS_OF: Record<string, string> = Object.fromEntries(CAPABILITY_AXES.flatMap((a) => a.benchmarks.map((b) => [b, a.label])));

/**
 * The drill-down behind Discover's "How they compare": every benchmark Mutinai holds results for, what it measures,
 * and the best open result recorded for it. Scores are the developers' own reports — Mutinai does not run capability
 * evaluations — so the page says so next to every number rather than presenting a leaderboard as measurement.
 */
export default async function BenchmarksPage() {
  const db = getDb();
  const [benchmarks, best] = await Promise.all([catalog.listBenchmarks(db), catalog.listBestBenchmarkScores(db)]);
  const withResults = benchmarks.filter((b) => b.resultCount > 0);
  const frontiers = Object.fromEntries(
    (await Promise.all(withResults.filter((b) => b.kind === 'capability').map(async (b) => [b.slug, await catalog.benchmarkFrontier(db, b.slug)] as const))).filter(([, f]) => f),
  );
  const leadersOf = (slug: string) => best.filter((s) => s.benchmarkSlug === slug).sort((a, b) => b.value - a.value).slice(0, 5);
  const groups = [
    { kind: 'capability', title: 'What models can do', intro: 'Fixed question sets a model answers. Every score here is reported by whoever published the model.' },
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
                        {b.metrics.map((m) => `${m.label} (${m.unit}, ${m.higherIsBetter ? 'higher is better' : 'lower is better'})`).join(' · ')} · {b.resultCount} recorded result{b.resultCount === 1 ? '' : 's'}
                      </p>
                      {group.kind === 'capability' && (
                        <p className="small" style={{ margin: '6px 0 0' }}>
                          <Basis kind="source" title="Reported by the model's developer, not measured by Mutinai">developer-reported</Basis>
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
                        <p className="small muted">Results are recorded against hardware and runtimes; see the models and systems they were run on.</p>
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
      <p className="small muted" style={{ marginTop: 'var(--s5)' }}>
        Developers report benchmark scores with their own prompts and settings, so numbers from different labs are not exactly
        comparable. Use them to shortlist, then look at <Link className="link" href="/community">what members measured</Link> on hardware like yours.
      </p>
    </>
  );
}
