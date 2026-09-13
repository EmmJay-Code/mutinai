import type { Metadata } from 'next';
import { PageHead, Section } from '@/components/ui';

export const metadata: Metadata = { title: 'Principles' };

export default function AboutPage() {
  return (
    <div style={{ maxWidth: 760 }}>
      <PageHead eyebrow="About" title="How Mutinai handles data" lede="Mutinai is an open community and intelligence platform for the open model ecosystem. These principles are built into the architecture, not layered on afterwards." />
      <Section title="Provenance" id="provenance">
        <p>Factual data is attributed to where it came from. Every ingested item is stored as an immutable, content-addressed snapshot; each field value records which source asserted it and when, and higher-priority sources take precedence without erasing what other sources said.</p>
        <p>Community submissions are kept separate from source-reported results and are labelled as such. Measured and estimated numbers are always visually distinct.</p>
        <p>AI-generated summaries, when added, will be stored as derived content with the generator and inputs recorded. They will never replace sourced facts.</p>
      </Section>
      <Section title="This build uses illustrative data" id="data">
        <p>The current catalog is seeded fixture data. Architecture facts follow public model cards, but benchmark and performance values are approximations for exercising the product and are attributed to the fixture source.</p>
      </Section>
      <Section title="Privacy" id="privacy">
        <ul>
          <li>Your public identity (handle, display name, bio) is separate from private account data. Email is optional and never shown publicly.</li>
          <li>Everything you contribute has an explicit visibility: public, unlisted (link only, excluded from listings and averages) or private (only you).</li>
          <li>Saved hardware systems are private by default. Public runs disclose the hardware components needed to interpret the result, not your system’s name.</li>
          <li>Your contributions are not used for AI training unless you explicitly opt in.</li>
          <li>You can export all of your data and delete your account.</li>
          <li>Mutinai’s business model does not depend on selling behavioural or personal data.</li>
          <li>Public content is public: we cannot prevent it from being copied or scraped once published.</li>
        </ul>
      </Section>
      <Section title="Ratings" id="ratings">
        <p>There is no single popularity score. Reviews rate specific dimensions — quality, coding, reasoning, agents and tool use, speed, reliability, ease of setup, value and hardware efficiency — and aggregates show distributions, counting only public, published reviews.</p>
      </Section>
    </div>
  );
}
