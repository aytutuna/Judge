import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getVerdict } from "@/lib/db";
import { t, type Lang } from "@/lib/i18n";
import { VerdictView } from "@/components/VerdictView";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: PageProps<"/v/[id]">): Promise<Metadata> {
  const { id } = await params;
  const stored = getVerdict(id);
  if (!stored) return { title: "Verdict" };
  return {
    title: `Verdict: ${stored.result.headline}`,
    description: stored.result.crux,
  };
}

export default async function SharedVerdictPage({ params }: PageProps<"/v/[id]">) {
  const { id } = await params;
  const stored = getVerdict(id);
  if (!stored) notFound();

  // Chrome language follows the viewer's browser (only a LEADING "tr"
  // counts — q-value parsing is deliberately out of scope). Verdict CONTENT
  // renders in whatever language it was judged in (stored text).
  const acceptLanguage = (await headers()).get("accept-language") ?? "";
  const lang: Lang = acceptLanguage.toLowerCase().startsWith("tr") ? "tr" : "en";

  return (
    <main lang={lang} className="flex-1 w-full max-w-md mx-auto px-4 py-8 flex flex-col gap-6">
      <header className="text-center">
        <Link href="/" className="inline-block">
          <h1 className="text-2xl font-black tracking-tight" style={{ color: "var(--ink)" }}>
            ⚖️ Verdict
          </h1>
        </Link>
        <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
          {t(lang, "shared.subtitle")}
        </p>
      </header>

      <VerdictView result={stored.result} lang={lang} />

      <Link
        href="/"
        className="rounded-full px-5 py-3 text-sm font-semibold self-center text-center"
        style={{ background: "var(--ink)", color: "var(--plane)" }}
      >
        {t(lang, "shared.cta")}
      </Link>
    </main>
  );
}
