import Link from 'next/link';

/**
 * The page structure shared by the section pages (see docs/design/README.md, "Editorial hierarchy"): a masthead on a
 * tinted band with a one-line "Start here" strip, then major sections with a strong rule, then groups labelled in a
 * sticky left column. Discover is the only page that uses the larger cover instead of a masthead.
 */

export function Masthead({ eyebrow, title, lede, children }: { eyebrow: React.ReactNode; title: React.ReactNode; lede?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className={children ? 'band' : 'band no-strip'}>
      <div className="masthead">
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        {lede && <p className="lede">{lede}</p>}
      </div>
      {children}
    </header>
  );
}

export interface StartItem { href: string; tag?: string; name: string; why?: string }

/** A few ways in, in one row. Replaces rows of intent cards: the catalog below is where the choosing happens. */
export function StartStrip({ items, label = 'Start here' }: { items: StartItem[]; label?: string }) {
  if (!items.length) return null;
  return (
    <ul className="start-strip" style={{ '--n': items.length } as React.CSSProperties} aria-label={label}>
      <li className="label" aria-hidden="true">{label}</li>
      {items.map((i) => (
        <li key={i.href}>
          <Link href={i.href}>
            {i.tag && <span className="tag-line">{i.tag}</span>}
            <span className="name">{i.name}</span>
            {i.why && <span className="strip-why">{i.why}</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** A major section: serif heading over a strong rule, with jump links or controls on the right. */
export function EdSection({ id, title, intro, tools, children }: { id?: string; title: React.ReactNode; intro?: React.ReactNode; tools?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="ed-section" id={id} aria-labelledby={id ? `${id}-h` : undefined}>
      <div className="ed-head">
        <div>
          <h2 id={id ? `${id}-h` : undefined}>{title}</h2>
          {intro && <p>{intro}</p>}
        </div>
        {tools && <div className="ed-head-tools">{tools}</div>}
      </div>
      {children}
    </section>
  );
}

export function JumpLinks({ items }: { items: { id: string; label: string }[] }) {
  if (items.length < 2) return null;
  return (
    <ul className="jump" aria-label="Jump to group">
      {items.map((i) => <li key={i.id}><a href={`#${i.id}`}>{i.label}</a></li>)}
    </ul>
  );
}

/** How demanding a group is, as a rising row of bars. Only used where groups are ordered by that demand. */
export function Meter({ level, of }: { level: number; of: number }) {
  return (
    <div className="meter" aria-hidden="true">
      {Array.from({ length: of }, (_, i) => <i key={i} className={i < level ? 'on' : undefined} style={{ height: 6 + ((i + 1) / of) * 16 }} />)}
    </div>
  );
}

/** One group of a catalog: a sticky label on the left, rows on the right. */
export function Group({ id, top, title, range, hint, children }: { id: string; top?: React.ReactNode; title: React.ReactNode; range?: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="group" id={id}>
      <div className="group-label">
        {top}
        <h3>{title}</h3>
        {range && <span className="range">{range}</span>}
        {hint && <p className="hint">{hint}</p>}
      </div>
      <div>{children}</div>
    </div>
  );
}
