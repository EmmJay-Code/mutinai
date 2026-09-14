import { communityContentIsSample } from './session';

/**
 * Public surfaces and the sample community dataset.
 *
 * Where no one can sign in, every row in the `community` schema came from `db:seed`, and those accounts and their
 * contributions are fictional. Two rules follow, and they differ by what the page is about:
 *
 * - A page about a real subject — a model, a device, a system, a tool — shows none of it. Invented praise, ratings
 *   or measurements attached to someone else's real product are a claim about that product, not a demo.
 * - A page about the community itself (`/community`, a member profile) keeps the content behind
 *   `SampleCommunityNotice`, because the content *is* the subject and removing it leaves nothing to show.
 *
 * Both switch off by themselves the day contributions open.
 */
export const hideSampleCommunityContent = communityContentIsSample;

/** Replaces "No reviews yet" on a public page, which would otherwise read as an absence of opinion rather than of a way to give one. */
export const SAMPLE_EMPTY_TEXT = 'Contributions are not open yet, so there is nothing here from members.';

/**
 * Measurement policy for every compatibility call. Verified member runs are real measurements and should feed
 * measured speeds — but where the only verified runs are seeded fiction, a `measured` badge would be resting on
 * invented evidence, so the engine falls back to its estimates.
 */
export const measurementPolicy = () => ({ includeCommunityMeasurements: !communityContentIsSample() });
