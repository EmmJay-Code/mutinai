# ADR-0004: Privacy architecture

Status: accepted · 2026-09-12

## Principles
- Public identity is separate from private account information.
- Every user-authored row has an explicit visibility and moderation status.
- Collect the minimum: an account needs an auth subject; email is optional.
- User content is not assumed to be usable for AI training; that is an explicit,
  default-off preference.
- No part of the business model depends on selling behavioural or user data;
  we do not store behavioural analytics tied to accounts.
- Public content is public: we do not claim it cannot be scraped.

## Decision
1. **Schema separation.** `identity.account`, `identity.session`,
   `identity.account_preference` hold private data. `community.profile` is the
   public persona (handle, display name, bio). Community content references
   `profile_id`, never `account_id`. The profile→account link is stored on the
   profile but is never selected by public queries.
2. **Visibility vocabulary** (`packages/domain/src/privacy.ts`):
   `public` (listed), `unlisted` (reachable by direct link, not listed/searched),
   `private` (owner only). Moderation: `pending`, `published`, `rejected`, `removed`.
   A single policy function `canView(viewer, resource)` defines access; SQL
   filters in the query layer mirror it and both are tested against the same matrix.
3. **Two query surfaces.** `@mutinai/db` exposes `publicQueries` (no viewer, only
   explicitly selected public columns, returns DTOs) and `viewerQueries(viewer)`.
   Public JSON endpoints may only call `publicQueries`. Tests deep-scan public
   output for private keys (`email`, `accountId`, `authSubject`, …) and for
   private/removed content.
4. **Sessions** are opaque random tokens; only an HMAC of the token is stored.
   The web tier holds no session state.
5. **Export and deletion.** `exportAccountData` returns all of a user's data;
   `deleteAccount` removes private data, user configurations and submissions,
   and removes authored content. Both exist as tested functions now.

## Future
- A restricted Postgres role for the public read path with no grants on `identity`.
- Field-level encryption for any future sensitive data.
- Retention policies for sessions and raw ingestion payloads.
