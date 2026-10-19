import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { cache } from "react";
import { getVerdict } from "@/lib/db";
import { t, type Lang } from "@/lib/i18n";
import { tugFinal } from "@/lib/verdict-display";
import { SiteFooter, SiteHeader, SkipLink } from "@/components/SiteChrome";
import { SharedVerdict } from "@/components/SharedVerdict";
import { BalanceFallback } from "@/components/scene/BalanceFallback";
import { SITE_NAME } from "@/app/site";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

/** One read per request, shared by generateMetadata and the page. */
const loadVerdict = cache(async (id: string) => getVerdict(id));

export async function generateMetadata({
  params,
}: PageProps<"/v/[id]">): Promise<Metadata> {
  const { id } = await params;
  const stored = await loadVerdict(id);
  if (!stored) return { title: "Not found", robots: { index: false } };
  const title = stored.result.headline;
  const description = stored.result.crux;
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
  const stored = await loadVerdict(id);
  if (!stored) notFound();

  // Chrome language follows the viewer's browser (only a LEADING "tr"
  // counts — q-value parsing is deliberately out of scope). The verdict
  // starts in that language too (translated on the client when it was
  // judged in the other one) and has its own TR | EN switch.
  const acceptLanguage = (await headers()).get("accept-language") ?? "";
  const lang: Lang = acceptLanguage.toLowerCase().startsWith("tr") ? "tr" : "en";

  return (
    <div lang={lang} className="contents">
      <SkipLink lang={lang} />
      <SiteHeader lang={lang} />

      <main id="main" tabIndex={-1} className={styles.main}>
        <div className={`wrap ${styles.inner}`}>
          <h1 className={`kicker ${styles.kicker}`}>{t(lang, "shared.subtitle")}</h1>

          <BalanceFallback tugA={tugFinal(stored.result)} className={styles.balance} />

          <div className={styles.card}>
            <SharedVerdict id={id} result={stored.result} initialLang={lang} />
          </div>

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
