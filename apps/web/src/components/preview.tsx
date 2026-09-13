import { Empty, PageHead } from '@/components/ui';
import { communityContentIsSample, contributionsEnabled } from '@/lib/session';

/** Renders children only where community contributions are possible (never in production). */
export function IfContributing({ children }: { children: React.ReactNode }) {
  return contributionsEnabled() ? children : null;
}

export function ContributionsClosed({ title }: { title: string }) {
  return (
    <>
      <PageHead
        eyebrow="Public preview"
        title={title}
        lede="Mutinai is a read-only preview. Accounts, reviews and benchmark submissions open once production sign-in is ready."
      />
      <Empty>Models, hardware, tools, comparisons, search and What can I run? all work without an account.</Empty>
    </>
  );
}

/**
 * Says plainly that the community content on this page is sample data. Rendered only where contributions are
 * impossible, which is the only state in which every community row is known to have come from the seed.
 * Surfaces whose whole subject is contributions label them; Discover leaves them out instead.
 */
export function SampleCommunityNotice() {
  if (!communityContentIsSample()) return null;
  return (
    <div className="alert alert-sample" role="note">
      <strong>Sample content.</strong> This preview has no sign-in, so nothing below was written by a real member:
      the accounts, runs and reviews are fictional seed data, kept to show how contributions will work.
    </div>
  );
}
