import type { Metadata } from 'next';
import Link from 'next/link';
import { HashOpener, MobileMenu, NavLinks, RunLink } from '@/components/nav-links';
import { contributionsEnabled, getSession } from '@/lib/session';
import { indexingAllowed, siteUrl } from '@/lib/site';
import { signOut } from './actions';
import './globals.css';

const PREVIEW_NOTICE = 'Public preview · figures are illustrative fixture data, attributed to their source · data to May 2025 · read-only';

export const generateMetadata = (): Metadata => ({
  metadataBase: siteUrl(),
  robots: indexingAllowed() ? undefined : { index: false, follow: false },
  title: { default: 'Mutinai — the open model ecosystem, in one place', template: '%s · Mutinai' },
  description: 'Open models, the hardware they run on, the tools around them, and the people building with them.',
});

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">Skip to content</a>
        <header className="site-header">
          <div className="wrap">
            <MobileMenu />
            <Link href="/" className="brand" aria-label="Mutinai home">
              <span className="brand-mark" aria-hidden="true" />
              mutinai
            </Link>
            <span className="preview-badge" title={PREVIEW_NOTICE}>Preview<span className="sr-only">: {PREVIEW_NOTICE}</span></span>
            <NavLinks />
            <div className="header-tools">
              <form className="header-search" action="/search" role="search">
                <label className="sr-only" htmlFor="site-search">Search</label>
                <input id="site-search" type="search" name="q" placeholder="Search models, hardware, tools" autoComplete="off" />
              </form>
              <RunLink />
              <div className="account-link">
                {session ? (
                  <>
                    <Link href="/me"><span className="handle">@{session.profile.handle}</span><span className="sr-only">Your account</span></Link>
                    <form action={signOut}>
                      <button className="btn-link" type="submit">Sign out</button>
                    </form>
                  </>
                ) : contributionsEnabled() ? (
                  <Link href="/signin">Sign in</Link>
                ) : null}
              </div>
            </div>
          </div>
        </header>
        <main id="main">
          <div className="wrap">{children}</div>
        </main>
        <HashOpener />
        <footer className="site-footer">
          <div className="wrap">
            <span>Mutinai — an open community for the open model ecosystem.</span>
            <nav aria-label="Footer">
              <Link href="/new">What’s new</Link>
              <Link href="/search">Search</Link>
              <Link href="/about">Principles</Link>
              <Link href="/about#privacy">Privacy</Link>
              <Link href="/about#provenance">Data provenance</Link>
              <Link href="/api/v1/models">API</Link>
            </nav>
            <p className="notice" role="note">{PREVIEW_NOTICE}</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
