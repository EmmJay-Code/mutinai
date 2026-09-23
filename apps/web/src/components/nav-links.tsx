'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

export const PRIMARY_NAV = [
  { href: '/', label: 'Discover' },
  { href: '/models', label: 'Models' },
  { href: '/hardware', label: 'Hardware' },
  { href: '/tools', label: 'Tools' },
  { href: '/benchmarks', label: 'Benchmarks' },
  { href: '/learn', label: 'Learn' },
  { href: '/community', label: 'Community' },
];

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' || pathname === '/new' : pathname.startsWith(href);
}

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav className="site-nav" aria-label="Primary">
      {PRIMARY_NAV.map((l) => (
        <Link key={l.href} href={l.href} aria-current={isActive(pathname, l.href) ? 'page' : undefined}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

export function RunLink() {
  const pathname = usePathname();
  return (
    <Link href="/run" className="utility-link" aria-current={pathname.startsWith('/run') ? 'page' : undefined}>
      <span className="long">What can I run?</span><span className="short" aria-hidden="true">Can I run it?</span>
    </Link>
  );
}

/** Compact navigation for narrow screens. Works without JavaScript; closes itself after navigation. */
export function MobileMenu() {
  const pathname = usePathname();
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [pathname]);
  return (
    <details className="menu" ref={ref}>
      <summary aria-label="Menu">Menu</summary>
      <div className="menu-panel">
        <nav aria-label="Primary (mobile)">
          {PRIMARY_NAV.map((l) => (
            <Link key={l.href} href={l.href} aria-current={isActive(pathname, l.href) ? 'page' : undefined}>
              {l.label}
            </Link>
          ))}
        </nav>
        <form action="/search" role="search">
          <label className="sr-only" htmlFor="mobile-search">Search</label>
          <input id="mobile-search" type="search" name="q" placeholder="Search models, hardware, tools…" />
        </form>
      </div>
    </details>
  );
}

/** Opens a collapsed <details> section when the URL hash points at it or at something inside it. */
export function HashOpener() {
  const pathname = usePathname();
  useEffect(() => {
    const open = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;
      const target = document.getElementById(id);
      let el: HTMLElement | null = target;
      while (el) {
        if (el instanceof HTMLDetailsElement) el.open = true;
        el = el.parentElement;
      }
      target?.scrollIntoView({ block: 'start' });
    };
    open();
    window.addEventListener('hashchange', open);
    return () => window.removeEventListener('hashchange', open);
  }, [pathname]);
  return null;
}
