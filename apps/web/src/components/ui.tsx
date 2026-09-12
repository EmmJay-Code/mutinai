import type { CompatResult, SpeedAssessment } from '@mutinai/domain';
import Link from 'next/link';
import { entityHref, formatNumber, humanize, KIND_LABEL } from '@/lib/format';

export function PageHead({ eyebrow, title, lede, crumbs, children }: {
  eyebrow?: string;
  title: React.ReactNode;
  lede?: React.ReactNode;
  crumbs?: { href?: string; label: string }[];
  children?: React.ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        {crumbs?.length ? (
          <nav className="crumbs" aria-label="Breadcrumb">
            {crumbs.map((c, i) => (
              <span key={i}>
                {i > 0 && <span aria-hidden="true">/</span>}
                {c.href ? <Link href={c.href}>{c.label}</Link> : c.label}
              </span>
            ))}
          </nav>
        ) : null}
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {lede && <p className="lede">{lede}</p>}
      </div>
      {children && <div className="tags">{children}</div>}
    </div>
  );
}

export function Section({ title, id, more, children }: { title: React.ReactNode; id?: string; more?: React.ReactNode; children: React.ReactNode }) {
  const headingId = id ? `${id}-heading` : undefined;
  return (
    <section className="section" id={id} aria-labelledby={headingId}>
      <div className="section-head">
        <h2 id={headingId}>{title}</h2>
        {more && <div className="more">{more}</div>}
      </div>
      {children}
    </section>
  );
}

export function Facts({ items }: { items: [React.ReactNode, React.ReactNode][] }) {
  return (
    <dl className="facts">
      {items.map(([k, v], i) => (
        <div key={i}>
          <dt>{k}</dt>
          <dd>{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Tag({ children, title }: { children: React.ReactNode; title?: string }) {
  return <span className="tag" title={title}>{children}</span>;
}

export function KindTag({ kind }: { kind: string }) {
  return <span className="tag tag-kind">{KIND_LABEL[kind] ?? humanize(kind)}</span>;
}

export function EntityLink({ entity, children }: { entity: { kind: string; slug: string; name: string; modelSlug?: string | null }; children?: React.ReactNode }) {
  const href = entityHref(entity);
  return href ? <Link href={href}>{children ?? entity.name}</Link> : <>{children ?? entity.name}</>;
}

const FIT_LABEL: Record<CompatResult['fit'], string> = {
  full: 'Fits',
  tight: 'Tight fit',
  offload: 'Offload',
  none: "Won't fit",
};

export function FitBadge({ fit }: { fit: CompatResult['fit'] }) {
  return <span className={`fit fit-${fit}`}>{FIT_LABEL[fit]}</span>;
}

export function Basis({ kind, children, title }: { kind: 'measured' | 'estimated' | 'community' | 'source'; children: React.ReactNode; title?: string }) {
  return <span className={`basis basis-${kind}`} title={title}>{children}</span>;
}

/** Throughput with an explicit basis. Estimates are visually distinct and always carry a range. */
export function Speed({ speed, unit = 'tok/s' }: { speed: SpeedAssessment; unit?: string }) {
  if (speed.basis === 'measured') {
    return (
      <span className="nowrap">
        <span className="val-measured">{formatNumber(speed.genTps)}</span> <span className="small muted">{unit}</span>{' '}
        <Basis kind="measured" title={`Median of ${speed.samples} measurement(s): ${speed.origins.map(humanize).join(', ')}`}>
          measured · {speed.samples}
        </Basis>
      </span>
    );
  }
  if (speed.basis === 'estimated') {
    return (
      <span className="nowrap" title={`Estimated from memory bandwidth; likely ${speed.low}–${speed.high} ${unit}`}>
        <span className="val-estimated">~{formatNumber(speed.genTps, 0)}</span> <span className="small muted">{unit}</span>{' '}
        <Basis kind="estimated">est.</Basis>
      </span>
    );
  }
  return <span className="faint">—</span>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Visibility({ visibility, status, verification }: { visibility?: string; status?: string; verification?: string }) {
  return (
    <span className="tags">
      {verification === 'verified' && <Basis kind="measured">verified</Basis>}
      {verification === 'unverified' && <Basis kind="community">unverified</Basis>}
      {verification === 'disputed' && <span className="basis status-private">disputed</span>}
      {visibility && visibility !== 'public' && <span className="basis status-private">{visibility}</span>}
      {status && status !== 'published' && <span className="basis status-private">{status}</span>}
    </span>
  );
}
