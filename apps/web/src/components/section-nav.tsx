'use client';

import { useEffect, useState } from 'react';

/** The sticky "on this page" bar of an entity page. Marks the section being read so it works as a position indicator. */
export function SectionNav({ items }: { items: { id: string; label: string }[] }) {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const sections = items.map((i) => document.getElementById(i.id)).filter((el): el is HTMLElement => el != null);
    if (!sections.length) return;
    // The current section is the last one whose top has passed just below the header and this bar.
    const update = () => {
      const line = 140;
      let current: string | null = null;
      for (const s of sections) if (s.getBoundingClientRect().top - line <= 0) current = s.id;
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) current = sections.at(-1)!.id;
      setActive(current);
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [items]);

  return (
    <nav className="section-nav" aria-label="On this page">
      <span className="section-nav-label" aria-hidden="true">On this page</span>
      <ol>
        {items.map((i) => (
          <li key={i.id}><a href={`#${i.id}`} aria-current={active === i.id ? 'location' : undefined}>{i.label}</a></li>
        ))}
      </ol>
    </nav>
  );
}
