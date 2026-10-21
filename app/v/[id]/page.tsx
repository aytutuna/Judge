import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { verdictLang } from "@/lib/content-lang";
import { t, type Lang } from "@/lib/i18n";
import { resolveParties, restoreNames } from "@/lib/names";
import { getPublicVerdict } from "@/lib/originals/display";
import { publicNameMap } from "@/lib/originals-types";
import { tugFinal } from "@/lib/verdict-display";
import { SiteFooter, SiteHeader, SkipLink } from "@/components/SiteChrome";
import { RemovedVerdict } from "@/components/RemovedVerdict";
import { SharedVerdict } from "@/components/SharedVerdict";
import { BalanceFallback } from "@/components/scene/BalanceFallback";
import { SITE_NAME } from "@/app/site";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

/** Chrome language follows the viewer's browser (only a LEADING "tr"
 * counts — q-value parsing is deliberately out of scope). */
async function viewerLang(): Promise<Lang> {
  const acceptLanguage = (await headers()).get("accept-language") ?? "";
  return acceptLanguage.toLowerCase().startsWith("tr") ? "tr" : "en";
}

export async function generateMetadata({
  params,
}: PageProps<"/v/[id]">): Promise<Metadata> {
  const { id } = await params;
  // One read per request (React cache), shared with the page.
  const found = await getPublicVerdict(id);
  if (!found) return { title: "Not found", robots: { index: false } };
  if (found.removed) {
    return { title: t(await viewerLang(), "removed.title"), robots: { index: false, follow: false } };
  }
  const { stored, display } = found;
  // Titles carry the display names the page shows (labels when names are off).
  const lang = verdictLang(stored.result);
  const parties = resolveParties(publicNameMap(display), lang, "A", { noSelf: true });
  const title = restoreNames(stored.result.headline, parties, lang);
  const description = restoreNames(stored.result.crux, parties, lang);
  return {
    title,
    description,
    // Share links are for the people they're sent to, not for search results.
    robots: { index: false, follow: true },
    alternates: { canonical: `/v/${id}` },
    openGraph: {
      type: "article",
      siteName: SITE_NAME,
      title,
      description,
      url: `/v/${id}`,
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function SharedVerdictPage({ params }: PageProps<"/v/[id]">) {
  const { id } = await params;
  const found = await getPublicVerdict(id);
  if (!found) notFound();

  // The verdict starts in the viewer's language too (translated on the
  // client when it was judged in the other one) and has its own TR | EN switch.
  const lang = await viewerLang();

  if (found.removed) {
    // Normally answered by proxy.ts with a 410; this is the fallback.
    return (
      <div lang={lang} className="contents">
        <SkipLink lang={lang} />
        <SiteHeader lang={lang} />
        <main id="main" tabIndex={-1} className={styles.main}>
          <div className={`wrap ${styles.inner}`}>
            <div className={styles.card}>
              <RemovedVerdict lang={lang} headingLevel={1} />
            </div>
          </div>
        </main>
        <SiteFooter lang={lang} />
      </div>
    );
  }

  const { stored, display } = found;
  const names = display ? publicNameMap(display) : null;

  return (
    <div lang={lang} className="contents">
      <SkipLink lang={lang} />
      <SiteHeader lang={lang} />

      <main id="main" tabIndex={-1} className={styles.main}>
        <div className={`wrap ${styles.inner}`}>
          {/* The h1 kicker is rendered by SharedVerdict: it changes to "Your
              verdict" once the writer is recognized. */}
          <SharedVerdict
            id={id}
            result={stored.result}
            initialLang={lang}
            publicNames={names}
            kickerClassName={`kicker ${styles.kicker}`}
            cardClassName={styles.card}
            balance={<BalanceFallback tugA={tugFinal(stored.result)} className={styles.balance} />}
          />

          <section aria-labelledby="cta-title" className={styles.cta}>
            <h2 id="cta-title" className={styles.ctaTitle}>
              {t(lang, "shared.ctaLead")}
            </h2>
            <Link href="/" className={styles.ctaLink}>
              {t(lang, "shared.cta")}
            </Link>
          </section>
        </div>
      </main>

      <SiteFooter lang={lang} />
    </div>
  );
}
