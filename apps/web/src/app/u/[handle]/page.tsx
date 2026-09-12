import { community, getDb } from '@mutinai/db';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ReviewList, SubmissionTable } from '@/components/results';
import { PageHead, Section } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { getViewer } from '@/lib/session';

type Params = Promise<{ handle: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  return { title: `@${(await params).handle}` };
}

export default async function ProfilePage({ params }: { params: Params }) {
  const { handle } = await params;
  const db = getDb();
  const profile = await community.getPublicProfile(db, handle);
  if (!profile) notFound();
  const viewer = await getViewer();
  const [reviews, submissions] = await Promise.all([
    community.listReviewsByAuthor(db, profile.handle, viewer),
    community.listSubmissions(db, { submitterHandle: profile.handle }, viewer),
  ]);
  return (
    <>
      <PageHead eyebrow="Member" title={profile.displayName} lede={profile.bio ?? undefined}>
        <span className="small muted">@{profile.handle} · joined {formatDate(profile.createdAt)} · {profile.submissionCount} public runs · {profile.reviewCount} public reviews</span>
      </PageHead>
      <Section title="Benchmark runs"><SubmissionTable submissions={submissions} /></Section>
      <Section title="Reviews"><ReviewList reviews={reviews} showSubject /></Section>
    </>
  );
}
