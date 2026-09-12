import type { catalog, community } from '@mutinai/db';
import type { RatingAggregate } from '@mutinai/domain';
import { RATING_DIMENSIONS } from '@mutinai/domain';
import Link from 'next/link';
import { vote } from '@/app/actions';
import { entityHref, formatContext, formatDate, formatGb, formatNumber, humanize } from '@/lib/format';
import { Basis, Empty, Visibility } from './ui';

const dimensionLabel = (key: string) => RATING_DIMENSIONS.find((d) => d.key === key)?.label ?? humanize(key);

export function PerformanceTable({ results, showModel = false, showSystem = true }: { results: catalog.PerformanceResultDTO[]; showModel?: boolean; showSystem?: boolean }) {
  if (!results.length) return <Empty>No performance measurements recorded yet.</Empty>;
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>{showModel ? 'Quantization' : 'Artifact'}</th>
            {showSystem && <th>System</th>}
            <th>Runtime</th>
            <th className="r">Context</th>
            <th>Measurements</th>
            <th>Basis</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => (
            <tr key={r.environmentId}>
              <td>
                <Link className="primary" href={`/models/${r.modelSlug}#${r.artifactSlug}`}>{r.artifactName}</Link>
              </td>
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
              <td>
                <Basis kind="source" title={`Origin: ${humanize(r.origin)}`}>{r.sourceName ?? humanize(r.origin)}</Basis>
              </td>
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
              <span className="faint">n={a.count}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function VoteForm({ target, score, own }: { target: { reviewId: string } | { submissionId: string }; score: number; own: boolean }) {
  return (
    <form action={vote} className="tags" style={{ display: 'inline-flex', alignItems: 'center' }}>
      {'reviewId' in target ? <input type="hidden" name="reviewId" value={target.reviewId} /> : <input type="hidden" name="submissionId" value={target.submissionId} />}
      <span className="small muted">Helpful <span className="num">{score}</span></span>
      {!own && (
        <button className="btn btn-small" type="submit" name="value" value="1" aria-label="Mark helpful">+1</button>
      )}
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
            <h3>{r.title}</h3>
            <div className="meta">
              <Link className="author" href={`/u/${r.author.handle}`}>@{r.author.handle}</Link>
              {showSubject && <> on {href ? <Link href={href}>{r.subject.name}</Link> : r.subject.name}</>}
              {r.hardware && <> · using <Link href={`/hardware/systems/${r.hardware.slug}`}>{r.hardware.name}</Link></>}
              {' · '}
              <time dateTime={new Date(r.createdAt).toISOString()}>{formatDate(r.createdAt)}</time> <Visibility visibility={r.visibility} status={r.status} />
            </div>
            <div className="ratings">
              {r.ratings.map((x) => (
                <div key={x.dimension} style={{ display: 'contents' }}>
                  <span>{dimensionLabel(x.dimension)}</span>
                  <span className="bar"><i style={{ width: `${(x.score / 5) * 100}%` }} /></span>
                  <span className="num">{x.score}/5</span>
                </div>
              ))}
            </div>
            <p className="body">{r.body}</p>
            <VoteForm target={{ reviewId: r.id }} score={r.helpfulScore} own={r.isOwn} />
          </article>
        );
      })}
    </div>
  );
}

function HardwareCell({ h }: { h: community.SubmissionDTO['hardware'] }) {
  if (h.type === 'reference') return <Link href={`/hardware/systems/${h.slug}`}>{h.name}</Link>;
  return (
    <span>
      {h.components.map((c, i) => (
        <span key={c.slug}>{i > 0 && ' + '}{c.count > 1 ? `${c.count}× ` : ''}<Link href={`/hardware/${c.slug}`}>{c.name}</Link></span>
      ))}
      <span className="sub">
        {h.name ? `${h.name} · ` : 'Member system · '}
        {h.unifiedMemoryGb ? `${formatGb(h.unifiedMemoryGb)} unified` : `${formatGb(h.systemRamGb)} RAM`}
      </span>
    </span>
  );
}

export function SubmissionTable({ submissions, showArtifact = true, emptyText = 'No community submissions yet.' }: { submissions: community.SubmissionDTO[]; showArtifact?: boolean; emptyText?: string }) {
  if (!submissions.length) return <Empty>{emptyText}</Empty>;
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            {showArtifact && <th>Model artifact</th>}
            <th>Hardware</th>
            <th>Runtime & settings</th>
            <th>Results</th>
            <th>Submitted</th>
          </tr>
        </thead>
        <tbody>
          {submissions.map((s) => (
            <tr key={s.id}>
              {showArtifact && (
                <td>
                  <Link className="primary" href={`/models/${s.artifact.modelSlug}#${s.artifact.slug}`}>{s.artifact.variantName}</Link>
                  <span className="sub">{s.artifact.schemeName} · {s.benchmark.name}</span>
                </td>
              )}
              <td><HardwareCell h={s.hardware} /></td>
              <td>
                <Link href={`/tools/${s.runtime.slug}`}>{s.runtime.name}</Link> <span className="small muted">{s.environment.runtimeVersion}</span>
                <span className="sub">
                  {[s.environment.backend, s.environment.contextLength && `ctx ${formatContext(s.environment.contextLength)}`, s.environment.kvCacheType && `KV ${s.environment.kvCacheType}`, s.environment.flashAttention && 'flash-attn', s.environment.os]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                {Object.keys(s.environment.parameters ?? {}).length > 0 && (
                  <span className="sub mono">{Object.entries(s.environment.parameters).map(([k, v]) => `${k}=${v}`).join(' ')}</span>
                )}
                {s.notes && <span className="sub">“{s.notes}”</span>}
              </td>
              <td>
                {s.measurements.map((m) => (
                  <div key={m.key} className="nowrap">
                    <span className="val-measured">{formatNumber(m.value)}</span> <span className="small muted">{m.unit} · {m.label}</span>
                  </div>
                ))}
              </td>
              <td>
                <Link className="author" href={`/u/${s.submitter.handle}`}>@{s.submitter.handle}</Link>
                <span className="sub">{formatDate(s.createdAt)}</span>
                <Visibility visibility={s.visibility} status={s.status} verification={s.verification} />
                <div style={{ marginTop: 4 }}><VoteForm target={{ submissionId: s.id }} score={s.helpfulScore} own={s.isOwn} /></div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ProvenanceBlock({ provenance }: { provenance: catalog.ProvenanceDTO }) {
  return (
    <div className="provenance panel panel-pad" id="provenance">
      <h3>Provenance</h3>
      {provenance.sources.length ? (
        <ul>
          {provenance.sources.map((s) => (
            <li key={s.key}>
              {s.name} <span className="faint">({humanize(s.kind)}, {s.records} record{s.records === 1 ? '' : 's'}{s.lastFetchedAt ? `, ${formatDate(s.lastFetchedAt)}` : ''})</span>
            </li>
          ))}
        </ul>
      ) : (
        <p>No source records linked.</p>
      )}
      {provenance.externalIds.length > 0 && (
        <>
          <h3 style={{ marginTop: 10 }}>Identifiers</h3>
          <ul>
            {provenance.externalIds.map((x) => (
              <li key={`${x.namespace}:${x.value}`}>
                <span className="faint">{x.namespace}</span> {x.url ? <a href={x.url} rel="noopener noreferrer">{x.value}</a> : x.value}
              </li>
            ))}
          </ul>
        </>
      )}
      {provenance.assertions.length > 0 && (
        <>
          <h3 style={{ marginTop: 10 }}>Field history</h3>
          <ul>
            {provenance.assertions.slice(0, 8).map((a, i) => (
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
