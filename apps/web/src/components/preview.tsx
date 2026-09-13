import { Empty, PageHead } from '@/components/ui';
import { contributionsEnabled } from '@/lib/session';

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
