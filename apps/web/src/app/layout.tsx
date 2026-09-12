import type { Metadata } from 'next';
import Link from 'next/link';
import { NavLinks } from '@/components/nav-links';
import { getSession } from '@/lib/session';
import { signOut } from './actions';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Mutinai — the open-AI ecosystem', template: '%s · Mutinai' },
  description: 'Open community and intelligence platform for open models, hardware, runtimes and tools.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">Skip to content</a>
        <header className="site-header">
          <div className="wrap">
            <Link href="/" className="brand" aria-label="Mutinai home">
              <span className="brand-mark" aria-hidden="true" />
              mutinai
            </Link>
            <NavLinks />
            <form className="header-search" action="/search" role="search">
              <label className="sr-only" htmlFor="site-search">Search</label>
              <input id="site-search" type="search" name="q" placeholder="Search models, hardware, tools…" autoComplete="off" />
            </form>
            <div className="header-account">
              {session ? (
                <>
                  <Link href="/me">@{session.profile.handle}</Link>
                  <form action={signOut}>
                    <button className="btn-link" type="submit">Sign out</button>
                  </form>
                </>
              ) : (
                <Link href="/signin">Sign in</Link>
              )}
            </div>
          </div>
        </header>
        <div className="data-notice" role="note">
          <div className="wrap">
            Foundation build. Ecosystem figures are <strong>illustrative fixture data</strong>, attributed to their fixture source — not for purchasing or deployment decisions.
          </div>
        </div>
        <main id="main">
          <div className="wrap">{children}</div>
        </main>
        <footer className="site-footer">
          <div className="wrap">
            <span>Mutinai — an open community for the open-AI ecosystem.</span>
            <nav aria-label="Footer" className="tags">
              <Link href="/about">Principles</Link>
              <span aria-hidden="true">·</span>
              <Link href="/about#privacy">Privacy</Link>
              <span aria-hidden="true">·</span>
              <Link href="/about#provenance">Data provenance</Link>
              <span aria-hidden="true">·</span>
              <Link href="/api/v1/models">API</Link>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
