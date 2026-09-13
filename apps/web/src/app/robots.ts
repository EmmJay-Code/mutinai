import type { MetadataRoute } from 'next';

export const dynamic = 'force-dynamic';

/**
 * Crawling stays allowed so crawlers can read the noindex directive sent with every page while indexing is off
 * (a blanket Disallow would hide it, and disallowed URLs can still be listed from links).
 */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', allow: '/', disallow: ['/api/', '/me', '/signin', '/contribute/'] } };
}
