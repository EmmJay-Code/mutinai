/**
 * Public deployment settings. Every value is optional and the defaults are the safe ones:
 * a fresh deployment is not indexed by search engines.
 */

/** Canonical public origin, used for absolute metadata URLs. */
export function siteUrl(): URL {
  const raw = process.env.MUTINAI_SITE_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT ?? 3000}`;
  return new URL(raw);
}

/** Search engines may index the site only when explicitly allowed (not while it carries fixture data). */
export const indexingAllowed = () => process.env.MUTINAI_ALLOW_INDEXING === '1';
