'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'Overview' },
  { href: '/models', label: 'Models' },
  { href: '/hardware', label: 'Hardware' },
  { href: '/tools', label: 'Tools' },
  { href: '/run', label: 'What can I run?' },
  { href: '/community', label: 'Community' },
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav className="site-nav" aria-label="Primary">
      {LINKS.map((l) => {
        const active = l.href === '/' ? pathname === '/' : pathname.startsWith(l.href);
        return (
          <Link key={l.href} href={l.href} aria-current={active ? 'page' : undefined}>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
