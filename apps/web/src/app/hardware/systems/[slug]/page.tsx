import { catalog, community, compatQueries, getDb } from '@mutinai/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PerformanceTable, RatingSummary, ReviewList, SubmissionList } from '@/components/results';
import { Crumbs, Empty, EntitySection, FitBadge, Glance, SectionNav, Speed } from '@/components/ui';
import { formatGb, formatParams, humanize } from '@/lib/format';
import { systemSentence } from '@/lib/hardware';
import { getViewer } from '@/lib/session';

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const c = await catalog.getConfigurationDetail(getDb(), (await params).slug);
  return { title: c?.name ?? 'System not found' };
}

const SECTIONS = [
  { id: 'runs', label: 'What it runs' },
  { id: 'components', label: 'Components' },
  { id: 'performance', label: 'Performance' },
  { id: 'community-runs', label: 'Community results' },
  { id: 'reviews', label: 'Reviews' },
];

export default async function SystemPage({ params }: { params: Params }) {
  const { slug } = await params;
  const db = getDb();
  const system = await catalog.getConfigurationDetail(db, slug);
  if (!system) notFound();
  const viewer = await getViewer();
  const hw = await compatQueries.loadReferenceHardware(db, slug);
  const [reviews, aggregates, submissions, results] = await Promise.all([
    community.listReviewsForEntities(db, [system.id], viewer),
    community.ratingAggregates(db, [system.id]),
    community.listSubmissions(db, { configurationId: system.id }, viewer),
    hw ? compatQueries.runCompatibility(db, hw, { contextLength: 8192 }) : Promise.resolve([]),
  ]);
  const top = results.filter((p) => p.recommended && p.recommended.result.placement !== 'hybrid').sort((a, b) => b.paramsTotal - a.paramsTotal).slice(0, 8);
  const runnable = results.filter((r) => r.recommended).length;

  return (
    <>
      <Crumbs crumbs={[{ href: '/hardware', label: 'Hardware' }, { href: '/hardware?view=systems', label: 'Systems' }]} />
      <header className="entity-hero">
        <div className="eyebrow">Reference system · {humanize(system.formFactor)}</div>
        <h1>{system.name}</h1>
        <p className="lede">{systemSentence(system)} {system.summary}</p>
        <Glance
          items={[
            [system.unifiedMemoryGb ? 'Unified memory' : 'GPU memory', formatGb(system.acceleratorMemoryGb || null)],
            ['System RAM', system.systemRamGb ? formatGb(system.systemRamGb) : 'Shared'],
            ['Runs', `${runnable} of ${results.length}`, 'model variants at 8K'],
            ['Price', system.approxPriceUsd ? `~$${system.approxPriceUsd.toLocaleString('en-US')}` : '—'],
          ]}
        />
        <div className="page-head-actions">
          <Link className="btn btn-primary" href={`/run?system=${system.slug}`}>Full compatibility list</Link>
          <Link className="btn" href={`/contribute/benchmark?system=${system.slug}`}>Submit a run</Link>
          <Link className="btn" href={`/contribute/review?entity=hardware_configuration:${system.slug}&returnTo=/hardware/systems/${system.slug}`}>Review</Link>
        </div>
      </header>

      <SectionNav items={SECTIONS} />

      <EntitySection id="runs" title="What it runs" intro="The largest models that run without offloading, at 8K context.">
        {top.length === 0 ? <Empty>No compatible models found.</Empty> : (
          <ul className="pick-list" style={{ maxWidth: 760 }}>
            {top.map((p) => (
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
        )}
        {aggregates.length > 0 && (
          <div style={{ marginTop: 'var(--s6)', maxWidth: 480 }}>
            <h3 className="subhead">What owners say</h3>
            <RatingSummary aggregates={aggregates} />
          </div>
        )}
      </EntitySection>

      <EntitySection id="components" title="Components">
        <ul className="list-plain" style={{ maxWidth: 760 }}>
          {system.components.map((c) => (
            <li key={c.slug}>
              <span className="num">{c.count}×</span> <Link href={`/hardware/${c.slug}`}>{c.name}</Link>{' '}
              <span className="small muted">{humanize(c.deviceKind)}{c.memoryGb ? ` · ${formatGb(c.memoryGb)}` : ''}</span>
            </li>
          ))}
          {system.systemRamBandwidthGbps && <li className="small muted">System RAM bandwidth {system.systemRamBandwidthGbps} GB/s</li>}
        </ul>
      </EntitySection>

      <EntitySection id="performance" title="Measured performance">
        <PerformanceTable results={system.performanceResults} showModel showSystem={false} />
      </EntitySection>

      <EntitySection id="community-runs" title="Community results">
        <SubmissionList submissions={submissions} />
      </EntitySection>

      <EntitySection id="reviews" title="Reviews">
        <ReviewList reviews={reviews} />
      </EntitySection>
    </>
  );
}
