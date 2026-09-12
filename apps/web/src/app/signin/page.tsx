import { getDb, identity } from '@mutinai/db';
import type { Metadata } from 'next';
import { signIn } from '@/app/actions';
import { Empty, PageHead } from '@/components/ui';
import { searchParam } from '@/lib/format';
import { devLoginEnabled } from '@/lib/session';

export const metadata: Metadata = { title: 'Sign in', robots: { index: false } };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function SignInPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const returnTo = searchParam(sp, 'returnTo') ?? '/me';
  if (!devLoginEnabled()) {
    return (
      <>
        <PageHead eyebrow="Account" title="Sign in" />
        <Empty>No sign-in providers are configured for this environment.</Empty>
      </>
    );
  }
  const accounts = await identity.listDevAccounts(getDb());
  return (
    <>
      <PageHead
        eyebrow="Development sign-in"
        title="Sign in as a seeded member"
        lede="This environment uses development sign-in (MUTINAI_DEV_LOGIN=1). Production authentication is not configured yet; accounts need only an authentication subject — email is optional."
      />
      {searchParam(sp, 'error') && <div className="alert alert-error" role="alert">{searchParam(sp, 'error')}</div>}
      <ul className="list-plain panel panel-pad" style={{ maxWidth: 520 }}>
        {accounts.map((a) => (
          <li key={a.handle} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span><strong>{a.displayName}</strong> <span className="muted">@{a.handle}</span></span>
            <form action={signIn}>
              <input type="hidden" name="handle" value={a.handle} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <button className="btn btn-small" type="submit">Sign in</button>
            </form>
          </li>
        ))}
      </ul>
    </>
  );
}
