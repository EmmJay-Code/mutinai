import { catalog, community, compatQueries, getDb } from '@mutinai/db';
import Link from 'next/link';
import { Basis, EntityLink, FitBadge, Section, Speed } from '@/components/ui';
import { CAPABILITY_LABEL, FORM_FACTOR_LABEL, formatDate, formatNumber, formatParams, humanize, isoDate } from '@/lib/format';

const PREVIEW_SYSTEM = 'rtx-4090-workstation';

const LEARN_PATHS = [
  { id: 'start-here', title: 'Start here', text: 'What “open” models are, and why running them yourself matters.' },
  { id: 'run-locally', title: 'Run locally', text: 'Memory, quantization and runtimes — the three things that decide what you can run.' },
  { id: 'understand-models', title: 'Understand models', text: 'Families, releases, variants and benchmarks, without the jargon.' },
  { id: 'build', title: 'Build with them', text: 'APIs, coding assistants, agents and fine-tuning on open weights.' },
];

export default async function DiscoverPage() {
  const db = getDb();
  const [counts, events, active, stats, picker, submissions, reviews] = await Promise.all([
    catalog.getCatalogCounts(db),
    catalog.listEvents(db, { limit: 10 }),
    catalog.listModels(db, { sort: 'activity' }),
    community.getCommunityStats(db),
    compatQueries.listHardwarePickerOptions(db),
    community.listSubmissions(db, {}, undefined, 20),
    community.listRecentReviews(db, undefined, 20),
  ]);
  const previewHardware = await compatQueries.loadReferenceHardware(db, PREVIEW_SYSTEM);
  const preview = previewHardware ? await compatQueries.runCompatibility(db, previewHardware, { contextLength: 8192 }) : [];
  const picks = preview
    .filter((r) => r.recommended && r.recommended.result.placement === 'accelerator' && r.variantKind !== 'fine_tune')
    .sort((a, b) => b.paramsTotal - a.paramsTotal)
    .slice(0, 5);

  // Lead with a significant development (a model release or hardware launch), not merely the newest item.
  const lead = events.find((e) => e.kind === 'model_release' || e.kind === 'hardware_launch') ?? events[0];
  const rest = events.filter((e) => e !== lead).slice(0, 4);
  const mostActive = active.filter((m) => m.reviewCount + m.runCount > 0).slice(0, 3);
  const featuredRun = submissions.find((s) => s.verification === 'verified') ?? submissions[0];
  const featuredReview = [...reviews].sort((a, b) => b.helpfulScore - a.helpfulScore)[0];
  const secondReview = reviews.find((r) => r.id !== featuredReview?.id && r.subject.kind !== featuredReview?.subject.kind);
  const systemsByForm = Object.entries(
    picker.configurations.reduce<Record<string, typeof picker.configurations>>((acc, c) => ({ ...acc, [c.formFactor]: [...(acc[c.formFactor] ?? []), c] }), {}),
  ).sort(([a], [b]) => ['laptop', 'mini_pc', 'desktop', 'server'].indexOf(a) - ['laptop', 'mini_pc', 'desktop', 'server'].indexOf(b));

  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <div className="eyebrow"><b>●</b> Open AI / right now</div>
        <h1 id="hero-title">Everything happening in open AI.</h1>
        <p className="lede">Models, hardware, tools, research — and the people building with them. Find out what’s new, what’s good, and what will actually run on your machine.</p>
        <div className="hero-actions">
          <a className="btn btn-primary btn-large" href="#now">Explore what’s new</a>
          <Link className="btn btn-large" href="/run">What can my hardware run?</Link>
        </div>
        <div className="hero-stats">
          <div><b>{counts.model ?? 0}</b><span>open models tracked</span></div>
          <div><b>{stats.submissions}</b><span>community benchmark runs</span></div>
        </div>
      </section>

      <Section id="now" title="Happening now" more={<Link href="/new">Full timeline →</Link>}>
        <div className="split-wide">
          {lead && (
            <article className="lead-story">
              <div className="meta">{humanize(lead.kind)} · <time dateTime={isoDate(lead.occurredAt)}>{formatDate(lead.occurredAt, 'long')}</time></div>
              <h3>{lead.url ? <a href={lead.url} rel="noopener noreferrer">{lead.title}</a> : lead.title}</h3>
              {lead.summary && <p>{lead.summary}</p>}
              {lead.entities.length > 0 && (
                <div className="tags">
                  {lead.entities.map((e) => <EntityLink key={e.slug} entity={e}>{e.name} →</EntityLink>)}
                </div>
              )}
            </article>
          )}
          <div>
            <ul className="story-list">
              {rest.map((e) => (
                <li key={e.id}>
                  <div className="meta">{humanize(e.kind)} · {formatDate(e.occurredAt)}</div>
                  <div className="title">{e.entities[0] ? <EntityLink entity={e.entities[0]}>{e.title}</EntityLink> : e.title}</div>
                </li>
              ))}
            </ul>
          </div>
        </div>
        {mostActive.length > 0 && (
          <>
            <h3 className="subhead">Most discussed by the community</h3>
            <div className="cols-3">
              {mostActive.map((m) => (
                <div key={m.slug}>
                  <Link href={`/models/${m.slug}`} style={{ fontSize: 19, fontWeight: 600, textDecoration: 'none' }}>{m.name}</Link>
                  <div className="small muted">{m.developerName}</div>
                  <div className="meta" style={{ marginTop: 4 }}>
                    {m.reviewCount} review{m.reviewCount === 1 ? '' : 's'} · {m.runCount} benchmark run{m.runCount === 1 ? '' : 's'}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Section>

      <Section title="Explore" intro="Three worlds, each with the depth you need when you want it.">
        <div className="cols-3">
          <Link href="/models" className="gateway">
            <h3>Models</h3>
            <p>Find the right open model for coding, reasoning or chat — and see how much memory it really needs.</p>
            <div className="gateway-links"><span>Qwen3 30B-A3B</span><span>Llama 3.3 70B</span><span>Phi-4</span></div>
          </Link>
          <Link href="/hardware" className="gateway">
            <h3>Hardware</h3>
            <p>Compare GPUs, Macs and mini PCs by what matters for AI: how much memory, and how fast it moves.</p>
            <div className="gateway-links"><span>RTX 4090</span><span>M4 Max</span><span>Ryzen AI Max+</span></div>
          </Link>
          <Link href="/tools" className="gateway">
            <h3>Tools</h3>
            <p>The runtimes, chat interfaces, coding assistants and fine-tuning frameworks around open models.</p>
            <div className="gateway-links"><span>llama.cpp</span><span>Ollama</span><span>Open WebUI</span></div>
          </Link>
        </div>
      </Section>

      <section className="band" aria-labelledby="run-heading">
        <div className="split">
          <div>
            <div className="step">What can I run?</div>
            <h2 id="run-heading" style={{ fontSize: 'clamp(30px, 4vw, 44px)', letterSpacing: '-0.03em' }}>Start from the machine you have.</h2>
            <p className="lede" style={{ marginTop: 'var(--s3)' }}>Pick something close to your setup. We’ll show which models fit in its memory, which version to download, and how fast they’re likely to run.</p>
            <div className="system-picker" style={{ marginTop: 'var(--s6)' }}>
              {systemsByForm.map(([form, systems]) => (
                <div className="picker-group" key={form}>
                  <h4>{FORM_FACTOR_LABEL[form] ?? humanize(form)}</h4>
                  <div className="chips">
                    {systems.map((s) => (
                      <Link key={s.slug} className="chip" href={`/run?system=${s.slug}`}>{s.name.replace(/\s*\(.*\)$/, '')}</Link>
                    ))}
                  </div>
                </div>
              ))}
              <div>
                <Link href="/run?mode=custom" className="btn">Build your own setup →</Link>
              </div>
            </div>
          </div>
          <div>
            <div className="meta">Example · {previewHardware?.label} · 8K context</div>
            <h3 style={{ fontSize: 22, margin: 'var(--s2) 0 var(--s4)' }}>The largest models that fit entirely in its 24 GB GPU</h3>
            <ul className="pick-list">
              {picks.map((p) => (
                <li key={p.variantSlug}>
                  <div>
                    <Link className="name" href={`/models/${p.modelSlug}#${p.variantSlug}`}>{p.variantName}</Link>
                    <div className="small muted">{formatParams(p.paramsTotal)} · {p.recommended!.row.schemeName} via {p.recommended!.runtime.name}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <FitBadge fit={p.recommended!.result.fit} />
                    <div className="small"><Speed speed={p.recommended!.result.speed} /></div>
                  </div>
                </li>
              ))}
            </ul>
            <p style={{ marginTop: 'var(--s4)' }}><Link href={`/run?system=${PREVIEW_SYSTEM}`}>See everything this system can run →</Link></p>
          </div>
        </div>
      </section>

      <Section title="From the community" intro="Real runs and reviews from people using open models." more={<Link href="/community">All community activity →</Link>}>
        <div className="voices">
          {featuredRun && (() => {
            const gen = featuredRun.measurements.find((m) => ['tg128', 'gen_tps'].includes(m.key)) ?? featuredRun.measurements[0]!;
            return (
              <article className="voice">
                <div className="meta">Benchmark run {featuredRun.verification === 'verified' && <Basis kind="measured">verified</Basis>}</div>
                <div className="figure">{formatNumber(gen.value)} <span className="small muted" style={{ fontFamily: 'var(--font-sans)', letterSpacing: 0 }}>{gen.unit}</span></div>
                <p style={{ margin: 0 }}>
                  <Link href={`/models/${featuredRun.artifact.modelSlug}`}>{featuredRun.artifact.variantName}</Link> ({featuredRun.artifact.schemeName}) on{' '}
                  {featuredRun.hardware.type === 'reference' ? featuredRun.hardware.name : featuredRun.hardware.components.map((c) => c.name).join(' + ')} with {featuredRun.runtime.name}
                </p>
                <div className="byline">@{featuredRun.submitter.handle} · {formatDate(featuredRun.createdAt)}</div>
              </article>
            );
          })()}
          {[featuredReview, secondReview].filter(Boolean).map((r) => (
            <article className="voice" key={r!.id}>
              <div className="meta">Review of <EntityLink entity={r!.subject} /></div>
              <blockquote>“{r!.title}”</blockquote>
              <p className="small muted" style={{ margin: 0 }}>{r!.body.length > 140 ? `${r!.body.slice(0, 140)}…` : r!.body}</p>
              <div className="byline">@{r!.author.handle} · {r!.ratings.map((x) => `${CAPABILITY_LABEL[x.dimension] ?? humanize(x.dimension)} ${x.score}/5`).slice(0, 2).join(' · ')}</div>
            </article>
          ))}
        </div>
      </Section>

      <Section title="Learn" intro="Short, practical paths into open AI — from first questions to building things." more={<Link href="/learn">All guides →</Link>}>
        <ol className="paths cols-4">
          {LEARN_PATHS.map((p) => (
            <li key={p.id}>
              <Link href={`/learn#${p.id}`}>
                <strong>{p.title}</strong>
                <span>{p.text}</span>
              </Link>
            </li>
          ))}
        </ol>
      </Section>
    </>
  );
}
