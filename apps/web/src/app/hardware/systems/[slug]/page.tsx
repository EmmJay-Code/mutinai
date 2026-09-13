import { catalog, community, compatQueries, getDb } from '@mutinai/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PerformanceTable, RatingSummary, ReviewList, SubmissionList } from '@/components/results';
import { Crumbs, Empty, EntitySection, FitBadge, Glance, SectionNav, Speed } from '@/components/ui';
import { EntityMark, MemoryScale, ParamsReach, SystemsMeter } from '@/components/viz';
import { formatGb, formatParams, humanize } from '@/lib/format';
import { maxParamsAtQ4, systemSentence, systemUsableGb } from '@/lib/hardware';
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
  const top = results.filter((p) => p.recommended && p.recommended.result.placement !== 'hybrid').sort((a, b) => b.paramsTotal - a.paramsTotal);
  const well = results.filter((r) => r.recommended?.result.placement === 'accelerator' || r.recommended?.result.placement === 'cpu').length;
  const slow = results.filter((r) => r.recommended?.result.placement === 'hybrid').length;
  const usable = systemUsableGb(system);

  return (
    <>
      <Crumbs crumbs={[{ href: '/hardware', label: 'Hardware' }, { href: '/hardware?view=systems', label: 'Systems' }]} />
      <div className="entity-top">
        <header className="entity-hero">
          <div className="kicker"><EntityMark type="system" word /> · {humanize(system.formFactor)}</div>
          <h1>{system.name}</h1>
          <p className="lede">{systemSentence(system)} {system.summary}</p>
          <Glance
            items={[
              [system.unifiedMemoryGb ? 'Unified memory' : 'GPU memory', formatGb(system.acceleratorMemoryGb || null)],
              ['System RAM', system.systemRamGb ? formatGb(system.systemRamGb) : 'Shared'],
              ['Runs', `${well} of ${results.length}`, 'model variants, 8K'],
              ['Price', system.approxPriceUsd ? `~$${system.approxPriceUsd.toLocaleString('en-US')}` : '—'],
            ]}
          />
          <div className="page-head-actions tight">
            <Link className="btn btn-primary" href={`/run?system=${system.slug}`}>Full compatibility</Link>
            <Link className="btn" href={`/contribute/benchmark?system=${system.slug}`}>Submit a run</Link>
            <Link className="btn" href={`/contribute/review?entity=hardware_configuration:${system.slug}&returnTo=/hardware/systems/${system.slug}`}>Review</Link>
          </div>
        </header>
        <aside className="verdict" aria-label="At a glance">
          <div>
            <h2>Capacity <span><SystemsMeter runsWell={well} slow={slow} of={results.length} /></span></h2>
            <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
              <ParamsReach maxB={maxParamsAtQ4(usable.gb)} label="Holds at 4-bit" />
              <MemoryScale gb={usable.gb} label={`Usable ${usable.where === 'ram' ? 'RAM' : usable.where === 'unified' ? 'unified memory' : 'GPU memory'}`} />
            </div>
            <p className="small muted" style={{ margin: '6px 0 0' }}>Segments: model variants that run well, slowly, or not at all.</p>
          </div>
          <div>
            <h2>Owners say</h2>
            <div style={{ marginTop: 4 }}><RatingSummary aggregates={aggregates} /></div>
          </div>
        </aside>
      </div>

      <SectionNav items={SECTIONS} />

      <EntitySection id="runs" title="What it runs" intro="Largest models without offloading, 8K context." more={<Link href={`/run?system=${system.slug}`}>Everything →</Link>}>
        {top.length === 0 ? <Empty>No compatible models found.</Empty> : (
          <ul className="pick-list" style={{ columns: 2, columnGap: 28 }}>
            {top.slice(0, 10).map((p) => (
              <li key={p.variantSlug} style={{ breakInside: 'avoid' }}>
                <EntityMark type="variant" />
                <div>
                  <Link className="name" href={`/models/${p.modelSlug}#${p.variantSlug}`}>{p.variantName}</Link>
                  <div className="small muted"><span className="num">{formatParams(p.paramsTotal)}</span> · <span className="mono">{p.recommended!.row.schemeName}</span> via {p.recommended!.runtime.name}</div>
                </div>
                <div style={{ textAlign: 'right' }}><FitBadge fit={p.recommended!.result.fit} /><div className="small"><Speed speed={p.recommended!.result.speed} /></div></div>
              </li>
            ))}
          </ul>
        )}
      </EntitySection>

      <EntitySection id="components" title="Components">
        <ul className="list-plain">
          {system.components.map((c) => (
            <li key={c.slug}>
              <span className="num">{c.count}×</span> <Link href={`/hardware/${c.slug}`} style={{ fontWeight: 600 }}><EntityMark type="hardware" /> {c.name}</Link>{' '}
              <span className="small muted">{humanize(c.deviceKind)}{c.memoryGb ? ` · ${formatGb(c.memoryGb)}` : ''}</span>
            </li>
          ))}
          {system.systemRamBandwidthGbps && <li className="small muted">System RAM bandwidth {system.systemRamBandwidthGbps} GB/s</li>}
        </ul>
      </EntitySection>

      <EntitySection id="performance" title="Measured performance">
        <PerformanceTable results={system.performanceResults} showModel showSystem={false} />
      </EntitySection>

      <div className="split">
        <EntitySection id="community-runs" title="Community results"><SubmissionList submissions={submissions} /></EntitySection>
        <EntitySection id="reviews" title="Reviews"><ReviewList reviews={reviews} /></EntitySection>
      </div>
    </>
  );
}
