import Link from "next/link";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { verdictLang } from "@/lib/content-lang";
import { loadedDict, loadLocales, t, type Lang } from "@/lib/i18n";
import { resolveParties, restoreNames } from "@/lib/names";
import { getPublicVerdict } from "@/lib/originals/display";
import { publicNameMap } from "@/lib/originals-types";
import type { VerdictResult } from "@/lib/types";
import { tugFinal } from "@/lib/verdict-display";
import { AppShell } from "@/components/shell/AppShell";
import { RemovedVerdict } from "@/components/RemovedVerdict";
import { SharedVerdict } from "@/components/SharedVerdict";
import { BalanceFallback } from "@/components/scene/BalanceFallback";
import { LocaleStrings } from "@/components/LocaleStrings";
import { SITE_NAME } from "@/app/site";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

/** The verdicts the writer's added context produced, oldest first. A read
 * that fails shows the first verdict alone. One read per request. */
const laterRounds = cache(async (id: string): Promise<{ id: string; result: VerdictResult; createdAt: string }[]> => {
  try {
    const { appealVerdicts } = await import("@/lib/verdict-appeals/service");
    return (await appealVerdicts(id)).map((v) => ({ id: v.id, result: v.result, createdAt: v.createdAt }));
  } catch (e) {
    console.error("[verdicts] rounds read failed:", e instanceof Error ? e.message : String(e));
    return [];
  }
});

/** Chrome language follows the viewer's browser (only a LEADING "tr"
 * counts — q-value parsing is deliberately out of scope), its strings loaded. */
async function viewerLang(): Promise<Lang> {
  const acceptLanguage = (await headers()).get("accept-language") ?? "";
  await loadLocales();
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
  // The page leads with the latest ruling, so the link preview does too.
  const oneSided = found.meta?.kind === "free" || found.meta?.kind === "premium";
  const r = (oneSided ? (await laterRounds(id)).at(-1)?.result : null) ?? stored.result;
  // Titles carry the display names the page shows (labels when names are off).
  const lang = verdictLang(r);
  const parties = resolveParties(publicNameMap(display), lang, "A", { noSelf: true });
  const title = restoreNames(r.headline, parties, lang);
  const description = restoreNames(r.crux, parties, lang);
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
      <LocaleStrings lang={lang} dict={loadedDict(lang)}>
        <AppShell lang={lang}>
          <main id="main" tabIndex={-1} className={styles.main}>
            <div className={`wrap ${styles.inner}`}>
              <div className={styles.card}>
                <RemovedVerdict lang={lang} headingLevel={1} />
              </div>
            </div>
          </main>
        </AppShell>
      </LocaleStrings>
    );
  }

  const { stored, display } = found;
  const names = display ? publicNameMap(display) : null;
  const oneSided = found.meta?.kind === "free" || found.meta?.kind === "premium";
  const rounds = oneSided ? await laterRounds(id) : [];
  const current = rounds.at(-1)?.result ?? stored.result;

  return (
    <LocaleStrings lang={lang} dict={loadedDict(lang)}>
      <AppShell lang={lang}>
        <main id="main" tabIndex={-1} className={styles.main}>
          <div className={`wrap ${styles.inner}`}>
            {/* SharedVerdict renders the h1 kicker and the CTA: once the writer
                is recognized the page becomes their thread instead. */}
            <SharedVerdict
              id={id}
              result={stored.result}
              createdAt={stored.createdAt}
              rounds={rounds}
              initialLang={lang}
              publicNames={names}
              kickerClassName={`kicker ${styles.kicker}`}
              cardClassName={styles.card}
              balance={<BalanceFallback tugA={tugFinal(current)} className={styles.balance} />}
              cta={
                <section aria-labelledby="cta-title" className={styles.cta}>
                  <h2 id="cta-title" className={styles.ctaTitle}>
                    {t(lang, "shared.ctaLead")}
                  </h2>
                  <Link href="/" className={styles.ctaLink}>
                    {t(lang, "shared.cta")}
                  </Link>
                </section>
              }
            />
          </div>
        </main>
      </AppShell>
    </LocaleStrings>
  );
}
