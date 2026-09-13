import type { catalog, community } from '@mutinai/db';
import type { RatingAggregate } from '@mutinai/domain';
import { originOfSourceKind, RATING_DIMENSIONS, sourceKindLabel } from '@mutinai/domain';
import Link from 'next/link';
import { vote } from '@/app/actions';
import { contributionsEnabled } from '@/lib/session';
import { entityHref, formatContext, formatDate, formatGb, formatNumber, humanize } from '@/lib/format';
import { Basis, Empty, Visibility } from './ui';
import { Avatar } from './viz';

const dimensionLabel = (key: string) => RATING_DIMENSIONS.find((d) => d.key === key)?.label ?? humanize(key);
const GEN_KEYS = ['tg128', 'gen_tps'];

export function PerformanceTable({ results, showModel = false, showSystem = true }: { results: catalog.PerformanceResultDTO[]; showModel?: boolean; showSystem?: boolean }) {
  if (!results.length) return <Empty>No performance measurements recorded yet.</Empty>;
  return (
    <div className="table-wrap">
      <table className="data dense">
        <thead>
          <tr>
            <th>{showModel ? 'Model · quantization' : 'Quantization'}</th>
            {showSystem && <th>System</th>}
            <th>Runtime</th>
            <th className="r">Context</th>
            <th>Measurements</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => (
            <tr key={r.environmentId}>
              <td><Link className="primary" href={`/models/${r.modelSlug}#${r.artifactSlug}`}>{r.artifactName}</Link></td>
              {showSystem && <td><Link href={`/hardware/systems/${r.configuration.slug}`}>{r.configuration.name}</Link></td>}
              <td>
                <Link href={`/tools/${r.runtime.slug}`}>{r.runtime.name}</Link>
                <span className="sub">{r.backend}{r.runtimeVersion ? ` · ${r.runtimeVersion}` : ''}</span>
              </td>
              <td className="r num">{formatContext(r.contextLength)}</td>
              <td>
                {r.metrics.map((m) => (
                  <div key={m.key} className="nowrap">
                    <span className="val-measured">{formatNumber(m.value)}</span> <span className="small muted">{m.unit} · {m.label}</span>
                  </div>
                ))}
              </td>
              <td><Basis kind="source" title={`Origin: ${humanize(r.origin)}`}>{r.sourceName ?? humanize(r.origin)}</Basis></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RatingSummary({ aggregates }: { aggregates: RatingAggregate[] }) {
  if (!aggregates.length) return <p className="muted small">No public ratings yet.</p>;
  return (
    <div className="ratings" role="table" aria-label="Community ratings by dimension">
      {aggregates.map((a) => {
        const max = Math.max(...a.distribution, 1);
        return (
          <div key={a.dimension} role="row" style={{ display: 'contents' }}>
            <span role="rowheader">{dimensionLabel(a.dimension)}</span>
            <span role="cell" className="bar" aria-label={`${a.mean.toFixed(1)} out of 5`}>
              <i style={{ width: `${(a.mean / 5) * 100}%` }} />
            </span>
            <span role="cell" className="nowrap">
              <span className="num">{a.mean.toFixed(1)}</span>{' '}
              <span className="dist" aria-hidden="true">
                {a.distribution.map((n, i) => <i key={i} style={{ height: `${(n / max) * 100}%` }} />)}
              </span>{' '}
              <span className="faint small">n={a.count}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function VoteForm({ target, score, own }: { target: { reviewId: string } | { submissionId: string }; score: number; own: boolean }) {
  return (
    <form action={vote} className="vote">
      {'reviewId' in target ? <input type="hidden" name="reviewId" value={target.reviewId} /> : <input type="hidden" name="submissionId" value={target.submissionId} />}
      <span className="small muted">Helpful <span className="num">{score}</span></span>
      {!own && contributionsEnabled() && <button className="btn btn-small" type="submit" name="value" value="1" aria-label="Mark helpful">+1</button>}
    </form>
  );
}

export function ReviewList({ reviews, showSubject = false, emptyText = 'No reviews yet.' }: { reviews: community.ReviewDTO[]; showSubject?: boolean; emptyText?: string }) {
  if (!reviews.length) return <Empty>{emptyText}</Empty>;
  return (
    <div>
      {reviews.map((r) => {
        const href = entityHref(r.subject);
        return (
          <article className="review" key={r.id} id={`review-${r.id}`}>
            <Avatar handle={r.author.handle} />
            <h3>{r.title}</h3>
            <div className="meta-line">
              <Link className="author" href={`/u/${r.author.handle}`}>@{r.author.handle}</Link>
              {showSubject && <> on {href ? <Link href={href}>{r.subject.name}</Link> : r.subject.name}</>}
              {r.hardware && <> · using <Link href={`/hardware/systems/${r.hardware.slug}`}>{r.hardware.name}</Link></>}
              {' · '}
              <time dateTime={new Date(r.createdAt).toISOString()}>{formatDate(r.createdAt)}</time> <Visibility visibility={r.visibility} status={r.status} />
            </div>
            <p className="body">{r.body}</p>
            <div className="ratings">
              {r.ratings.map((x) => (
                <div key={x.dimension} style={{ display: 'contents' }}>
                  <span>{dimensionLabel(x.dimension)}</span>
                  <span className="bar"><i style={{ width: `${(x.score / 5) * 100}%` }} /></span>
                  <span className="num">{x.score}/5</span>
                </div>
              ))}
            </div>
            <VoteForm target={{ reviewId: r.id }} score={r.helpfulScore} own={r.isOwn} />
          </article>
        );
      })}
    </div>
  );
}

function HardwareText({ h }: { h: community.SubmissionDTO['hardware'] }) {
  if (h.type === 'reference') return <Link href={`/hardware/systems/${h.slug}`}>{h.name}</Link>;
  return (
    <span>
      {h.components.map((c, i) => (
        <span key={c.slug}>{i > 0 && ' + '}{c.count > 1 ? `${c.count}× ` : ''}<Link href={`/hardware/${c.slug}`}>{c.name}</Link></span>
      ))}
      <span className="muted"> ({h.name ? `${h.name}, ` : 'member system, '}{h.unifiedMemoryGb ? `${formatGb(h.unifiedMemoryGb)} unified` : `${formatGb(h.systemRamGb)} RAM`})</span>
    </span>
  );
}

/** Benchmark runs as readable items: the headline number first, the full reproducible environment on demand. */
export function SubmissionList({ submissions, showArtifact = true, emptyText = 'No community benchmark runs yet.' }: { submissions: community.SubmissionDTO[]; showArtifact?: boolean; emptyText?: string }) {
  if (!submissions.length) return <Empty>{emptyText}</Empty>;
  return (
    <div>
      {submissions.map((s) => {
        const headline = s.measurements.find((m) => GEN_KEYS.includes(m.key)) ?? s.measurements[0];
        const env = s.environment;
        return (
          <article className="review" key={s.id} id={`run-${s.id}`}>
            <Avatar handle={s.submitter.handle} />
            <div className="run-headline">
              {headline && <>{formatNumber(headline.value)} <span className="unit">{headline.unit} {headline.label.toLowerCase()}</span></>}
            </div>
            {showArtifact && <div style={{ fontWeight: 600 }}><Link href={`/models/${s.artifact.modelSlug}#${s.artifact.slug}`}>{s.artifact.variantName}</Link> <span className="muted mono" style={{ fontWeight: 400 }}>{s.artifact.schemeName}</span></div>}
            <div className="meta-line">
              on <HardwareText h={s.hardware} /> · <Link href={`/tools/${s.runtime.slug}`}>{s.runtime.name}</Link>{env.runtimeVersion ? ` ${env.runtimeVersion}` : ''} · {env.backend}
            </div>
            <div className="meta-line">
              <Link className="author" href={`/u/${s.submitter.handle}`}>@{s.submitter.handle}</Link> · {formatDate(s.createdAt)} <Visibility visibility={s.visibility} status={s.status} verification={s.verification} />
            </div>
            {s.notes && <p className="body">“{s.notes}”</p>}
            <details className="more-detail">
              <summary>Full environment and measurements</summary>
              <dl className="kv" style={{ margin: 'var(--s2) 0' }}>
                <dt>Benchmark</dt><dd>{s.benchmark.name}</dd>
                {s.measurements.map((m) => (
                  <div key={m.key} style={{ display: 'contents' }}>
                    <dt>{m.label}</dt><dd><span className="val-measured">{formatNumber(m.value)}</span> {m.unit}</dd>
                  </div>
                ))}
                <dt>Artifact</dt><dd>{s.artifact.name}</dd>
                <dt>Context</dt><dd>{formatContext(env.contextLength)}</dd>
                {env.batchSize != null && <><dt>Batch size</dt><dd>{env.batchSize}</dd></>}
                {env.gpuLayers != null && <><dt>GPU layers</dt><dd>{env.gpuLayers}</dd></>}
                {env.kvCacheType && <><dt>KV cache</dt><dd>{env.kvCacheType}</dd></>}
                {env.flashAttention != null && <><dt>Flash attention</dt><dd>{env.flashAttention ? 'on' : 'off'}</dd></>}
                {env.os && <><dt>OS</dt><dd>{env.os}</dd></>}
                {env.driverVersion && <><dt>Driver</dt><dd>{env.driverVersion}</dd></>}
                {Object.keys(env.parameters ?? {}).length > 0 && <><dt>Parameters</dt><dd className="mono">{Object.entries(env.parameters).map(([k, v]) => `${k}=${v}`).join(' ')}</dd></>}
              </dl>
            </details>
            <VoteForm target={{ submissionId: s.id }} score={s.helpfulScore} own={s.isOwn} />
          </article>
        );
      })}
    </div>
  );
}

export function ProvenanceBlock({ provenance }: { provenance: catalog.ProvenanceDTO }) {
  return (
    <div className="provenance" id="provenance-detail">
      <h3>Sources</h3>
      {provenance.sources.length ? (
        <ul>
          {provenance.sources.map((s) => (
            <li key={s.key}>
              {s.name} <span className="faint">({originOfSourceKind(s.kind) === 'live' ? 'live source' : sourceKindLabel(s.kind).toLowerCase()}, {s.records} record{s.records === 1 ? '' : 's'}{s.lastFetchedAt ? `, ${formatDate(s.lastFetchedAt)}` : ''})</span>
            </li>
          ))}
        </ul>
      ) : <p>No source records linked.</p>}
      {provenance.externalIds.length > 0 && (
        <>
          <h3>External identifiers</h3>
          <ul>
            {provenance.externalIds.map((x) => (
              <li key={`${x.namespace}:${x.value}`}>
                <span className="faint mono">{x.namespace}</span> {x.url ? <a href={x.url} rel="noopener noreferrer">{x.value}</a> : x.value}
              </li>
            ))}
          </ul>
        </>
      )}
      {provenance.assertions.length > 0 && (
        <>
          <h3>Field history</h3>
          <ul>
            {provenance.assertions.slice(0, 12).map((a, i) => (
              <li key={i}>
                <span className="mono">{a.field}</span> = {JSON.stringify(a.value)} <span className="faint">— {a.sourceName}{a.applied ? ' (current)' : ''}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
