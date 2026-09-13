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
      {crumbs?.length ? <Crumbs crumbs={crumbs} /> : null}
      {eyebrow && <div className="eyebrow">{eyebrow}</div>}
      <h1>{title}</h1>
      {lede && <p className="lede">{lede}</p>}
      {children && <div className="page-head-actions">{children}</div>}
    </div>
  );
}

export function Crumbs({ crumbs }: { crumbs: { href?: string; label: string }[] }) {
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      {crumbs.map((c, i) => (
        <span key={i}>
          {i > 0 && <span aria-hidden="true">/</span>}
          {c.href ? <Link href={c.href}>{c.label}</Link> : c.label}
        </span>
      ))}
    </nav>
  );
}

export function Section({ title, id, more, intro, children, tight }: {
  title: React.ReactNode;
  id?: string;
  more?: React.ReactNode;
  intro?: React.ReactNode;
  children: React.ReactNode;
  tight?: boolean;
}) {
  const headingId = id ? `${id}-heading` : undefined;
  return (
    <section className={tight ? 'section-tight' : 'section'} id={id} aria-labelledby={headingId}>
      <div className="section-head">
        <div>
          <h2 id={headingId}>{title}</h2>
          {intro && <p>{intro}</p>}
        </div>
        {more && <div className="more">{more}</div>}
      </div>
      {children}
    </section>
  );
}

/** A section on an entity page, reachable from the section navigation. */
export function EntitySection({ id, title, intro, children }: { id: string; title: string; intro?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="entity-section" id={id} aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>{title}</h2>
      {intro ? <p className="intro">{intro}</p> : <div style={{ height: 'var(--s4)' }} />}
      {children}
    </section>
  );
}

export function SectionNav({ items }: { items: { id: string; label: string }[] }) {
  return (
    <nav className="section-nav" aria-label="On this page">
      <ol>
        {items.map((i) => (
          <li key={i.id}><a href={`#${i.id}`}>{i.label}</a></li>
        ))}
      </ol>
    </nav>
  );
}

export function Glance({ items }: { items: [React.ReactNode, React.ReactNode, React.ReactNode?][] }) {
  return (
    <dl className="glance">
      {items.map(([k, v, sub], i) => (
        <div key={i}>
          <dt>{k}</dt>
          <dd>{v ?? '—'}{sub && <span className="sub">{sub}</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Progressive disclosure: a labelled summary line that expands into detail. */
export function Disclosure({ id, title, meta, aside, open, children }: {
  id?: string;
  title: React.ReactNode;
  meta?: React.ReactNode;
  aside?: React.ReactNode;
  open?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className="disclose" id={id} open={open}>
      <summary>
        <span>
          <span className="title">{title}</span>
          {meta && <span className="meta">{meta}</span>}
        </span>
        {aside}
      </summary>
      <div className="body">{children}</div>
    </details>
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

export const FIT_LABEL: Record<CompatResult['fit'], string> = {
  full: 'Runs well',
  tight: 'Tight fit',
  offload: 'With offload',
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
    <span className="tags" style={{ display: 'inline-flex' }}>
      {verification === 'verified' && <Basis kind="measured">verified</Basis>}
      {verification === 'unverified' && <Basis kind="community">unverified</Basis>}
      {verification === 'disputed' && <span className="basis status-private">disputed</span>}
      {visibility && visibility !== 'public' && <span className="basis status-private">{visibility}</span>}
      {status && status !== 'published' && <span className="basis status-private">{status}</span>}
    </span>
  );
}

/** Plain-language license label for scanning; full license name belongs on the entity page. */
export function LicenseShort({ commercialUse }: { commercialUse: string | null | undefined }) {
  if (!commercialUse) return <span className="muted">License unknown</span>;
  return commercialUse === 'allowed' ? <span>Open license</span> : <span>Restricted license</span>;
}
