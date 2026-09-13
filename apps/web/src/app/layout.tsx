import type { Metadata } from 'next';
import Link from 'next/link';
import { HashOpener, MobileMenu, NavLinks, RunLink } from '@/components/nav-links';
import { getSession } from '@/lib/session';
import { signOut } from './actions';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Mutinai — everything happening in open AI', template: '%s · Mutinai' },
  description: 'Open models, the hardware they run on, the tools around them, and the people building with them.',
};

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
                ) : (
                  <Link href="/signin">Sign in</Link>
                )}
              </div>
            </div>
          </div>
        </header>
        <div className="data-notice" role="note">
          <div className="wrap">Foundation build · figures are illustrative fixture data, attributed to their source · data to May 2025</div>
        </div>
        <main id="main">
          <div className="wrap">{children}</div>
        </main>
        <HashOpener />
        <footer className="site-footer">
          <div className="wrap">
            <span>Mutinai — an open community for the open-AI ecosystem.</span>
            <nav aria-label="Footer">
              <Link href="/new">What’s new</Link>
              <Link href="/search">Search</Link>
              <Link href="/about">Principles</Link>
              <Link href="/about#privacy">Privacy</Link>
              <Link href="/about#provenance">Data provenance</Link>
              <Link href="/api/v1/models">API</Link>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
