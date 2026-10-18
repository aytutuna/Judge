import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { cache } from "react";
import { getVerdict } from "@/lib/db";
import { t, type Lang } from "@/lib/i18n";
import { SiteFooter, SiteHeader, SkipLink } from "@/components/SiteChrome";
import { VerdictView } from "@/components/VerdictView";
import { SITE_NAME } from "@/app/site";

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
  // counts — q-value parsing is deliberately out of scope). Verdict CONTENT
  // renders in whatever language it was judged in (stored text).
  const acceptLanguage = (await headers()).get("accept-language") ?? "";
  const lang: Lang = acceptLanguage.toLowerCase().startsWith("tr") ? "tr" : "en";

  return (
    <div lang={lang} className="contents">
      <SkipLink lang={lang} />
      <SiteHeader lang={lang} />

      <main
        id="main"
        tabIndex={-1}
        className="flex-1 w-full max-w-xl mx-auto px-4 pt-8 flex flex-col gap-8 outline-none"
      >
        <h1
          className="text-center text-xs font-semibold uppercase tracking-wide"
          style={{ color: "var(--muted)" }}
        >
          {t(lang, "shared.subtitle")}
        </h1>

        <VerdictView result={stored.result} lang={lang} shareId={id} />

        <section
          aria-labelledby="cta-title"
          className="rounded-3xl px-5 py-7 text-center flex flex-col items-center gap-4"
          style={{ background: "var(--surface)", border: "1px solid var(--line)" }}
        >
          <h2 id="cta-title" className="text-xl font-black tracking-tight" style={{ color: "var(--ink)" }}>
            {t(lang, "shared.ctaLead")}
          </h2>
          <Link
            href="/"
            className="rounded-full px-6 py-3.5 text-base font-bold"
            style={{ background: "var(--ink)", color: "var(--plane)" }}
          >
            {t(lang, "shared.cta")}
          </Link>
        </section>
      </main>

      <SiteFooter lang={lang} />
    </div>
  );
}
