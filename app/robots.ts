import type { MetadataRoute } from "next";
import { siteUrl } from "./site";

/** Share pages stay crawlable so link previews work (some preview bots obey
 * robots.txt); they opt out of search indexing with a noindex meta instead.
 * Account, history and sign-in pages are personal, and case and invite
 * pages are private: kept out entirely. */
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/account", "/verdicts", "/signin", "/c/", "/r/"] },
    sitemap: `${base}/sitemap.xml`,
  };
}
