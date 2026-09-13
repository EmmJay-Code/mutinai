# Freshness rules

Mutinai is a current ecosystem tracker. Surfaces that say or imply "now" follow these rules. They are implemented in
`packages/domain/src/freshness.ts` and tested in `packages/domain/test/freshness.test.ts`. The integration test
`packages/ingestion/test/integration/promotion-freshness.test.ts` checks them against ingested data. The decision
record is [ADR-0009](adr/0009-freshness-and-publisher-accounts.md).

## Two times, never confused

| Time | Column | Used for |
|---|---|---|
| **Event time**: when a release was published, a model went up, a post was written | `event.occurred_at`, `model_release.released_on` | Every time-sensitive surface |
| **Ingest time**: when Mutinai first recorded it | `event.created_at` (`discoveredAt` in the API) | Audit only; never shown as a date |

A GitHub release from 2025 that Mutinai first fetches today is a 2025 event. A model whose repository Mutinai first sees
today is dated by the source's own publication date. When a source states no date, nothing is dated by ingestion.
The item is left for review instead.

## Live and fixture data

Once any live-sourced event exists, illustrative fixture events are excluded from every time-sensitive surface. They
still appear, labelled *Fixture*, on the full timeline. A fixture never competes with live data on significance. With
fixtures only (local development), there is never a top story. Latest lists the fixtures by date, with their label.

## Significance

Significance comes from facts, not from interpreting text:

| Significance | Events |
|---|---|
| 3 | Model releases, hardware launches, major runtime versions (`x.0.0`, x ≥ 1) |
| 2 | Minor runtime versions (`x.y.0`, including `0.y.0`) |
| 1 | Announcements, papers, benchmark updates, releases without a recognisable version |
| 0 | Patch releases (`x.y.z`, z > 0, `.post1`), build numbers (`b5450`), sub-package tags (`proto-v0.1.0`) |

Channel suffixes such as `-vscode` do not change the level.

## Surfaces

| Surface | Rule |
|---|---|
| **Top story** | The most significant live event (significance ≥ 2) from the last **14 days**. Ties go to model releases and hardware launches, then runtimes, then the newest. If nothing qualifies, Discover says *Nothing major in the last 14 days* and promotes nothing. |
| **Latest** | Strictly newest first by event time. Excludes the top story, significance 0 and future-dated entries (more than 24 h ahead). |
| **Releases & launches (hero count)** | Live events of significance ≥ 2 whose event time is within the last **30 days**. |
| **Releases per month (chart)** | Events of significance ≥ 2 per month by event time, for the 12 months ending with the current month. Months before live tracking began hold only the history sources still list; the caption says so. |
| **Recent releases (`listRecentReleases`)** | Model releases ordered by `released_on`, the release's own date. |
| **Trending** | Growth in cumulative counters (GitHub stars, Hugging Face likes) between a current observation (within 7 days) and a baseline 7–14 days before it. Lifetime totals, flat counters, stale observations and Hugging Face `downloads` (a rolling 30-day count) never count. Without a week of history, Discover says so. Values are real differences (`+900 GitHub stars since 6 Sep`); there are no percentages or invented activity. |
| **Full timeline (`/new`)** | Everything by event time, fixtures labelled, future-dated entries excluded. |

## Duplicates

Re-published copies of one event are shown once, the newest copy. Copies share the kind and subject, fall within
48 hours of each other, and have the same title or the same substantive notes. Projects sometimes tag one release twice
within hours: Unsloth `v0.1.805-beta` and `v0.1.806-beta`, Continue `v1.2.23-vscode` and `v1.2.24-vscode`. The same
release seen by the GitHub API and a releases feed was already one event by identity (`github:<repo>:release:<tag>`).

## Release titles and summaries

A release is titled `<project> <tag>` when it is named after its tag, and by its own title when that already names the
project. Otherwise the title is `<project> <title>`. Either way the project name appears once (`Aider v0.86.0`, never
`Aider Aider v0.86.0`). The summary is the first prose line of the notes, not a markdown heading, image or table.
