import Link from 'next/link';
import { Empty, PageHead } from '@/components/ui';

export default function NotFound() {
  return (
    <>
      <PageHead eyebrow="404" title="Not found" />
      <Empty>That page doesn’t exist. Try <Link href="/search">search</Link>.</Empty>
    </>
  );
}
