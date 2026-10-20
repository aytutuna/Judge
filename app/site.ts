/**
 * Site-wide constants for metadata, robots and sitemap. Not a route: Next
 * only treats convention file names (page, layout, route, ...) as routable.
 */

export const SITE_NAME = "Judge";

export const SITE_TITLE = "Judge: who's right?";

export const SITE_DESCRIPTION =
  "Describe an argument. Three independent AI judges find the crux and rule, with an honest confidence score, the strongest point for the other side, and a link to share.";

/** The root link-preview card (app/opengraph-image.tsx), for pages that set
 * their own openGraph and so lose the inherited one. */
export const SITE_OG_IMAGE = {
  url: "/opengraph-image",
  width: 1200,
  height: 630,
  alt: SITE_TITLE,
};

const PLACEHOLDER_DOMAIN = /(^|\.)example(\.(com|org|net))?$/i;

/**
 * Privacy contact shown on /privacy, from CONTACT_EMAIL. Returns null when it
 * is unset, malformed, or still a placeholder (example.com and friends), and
 * the page then leaves the contact section out rather than print a dead
 * address. Read at build time, so a change needs a redeploy.
 */
export function contactEmail(env: Record<string, string | undefined> = process.env): string | null {
  const raw = env.CONTACT_EMAIL?.trim() ?? "";
  const match = /^[^\s@<>"]+@([^\s@<>"]+\.[^\s@<>"]+)$/.exec(raw);
  if (!match || PLACEHOLDER_DOMAIN.test(match[1])) return null;
  return raw;
}

/**
 * Absolute origin used as metadataBase and in robots/sitemap. Order:
 * NEXT_PUBLIC_SITE_URL, then Vercel's production domain (scheme-less), then
 * localhost. Invalid values fall through instead of crashing the build.
 */
export function siteUrl(env: Record<string, string | undefined> = process.env): string {
  const candidates = [
    env.NEXT_PUBLIC_SITE_URL?.trim(),
    env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
      ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL.trim()}`
      : undefined,
  ];
  for (const raw of candidates) {
    if (!raw) continue;
    try {
      const url = new URL(raw);
      if (url.protocol === "http:" || url.protocol === "https:") {
        return url.href.replace(/\/+$/, "");
      }
    } catch {
      // fall through to the next candidate
    }
  }
  return "http://localhost:3000";
}
