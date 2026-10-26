import { ImageResponse } from "next/og";
import { ACCENT_A, ACCENT_B, OG_SIZE, OgCard, ogFonts } from "@/components/OgCard";
import { confidenceLabel, tugFinal, verdictLabel } from "@/lib/verdict-display";
import { contentLang, t } from "@/lib/i18n";
import { resolveParties, restoreNames } from "@/lib/names";
import { getPublicVerdict } from "@/lib/originals/display";
import { publicNameMap } from "@/lib/originals-types";

export const alt = "A shared verdict";
export const size = OG_SIZE;
export const contentType = "image/png";

/**
 * Preview card for a shared verdict: the ruling, its headline and the
 * tug-of-war bar. Crawlers send no language preference, so the label follows
 * the language the verdict text was judged in. Party names are the display
 * names the writer chose for the share page (labels when there are none or
 * names are switched off). A removed verdict gets a plain "removed" card
 * (no ruling pill, no tug-of-war bar) with HTTP 410. When the removal state
 * cannot be read, it answers 503 (no-store) rather than draw the verdict.
 */
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let found: Awaited<ReturnType<typeof getPublicVerdict>>;
  try {
    found = await getPublicVerdict(id);
  } catch (e) {
    console.error("[og] verdict read failed:", e instanceof Error ? e.message : String(e));
    return new Response(null, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const fonts = await ogFonts();

  if (found?.removed) {
    const lang = contentLang(`${found.stored.result.headline} ${found.stored.result.crux}`);
    return new ImageResponse(
      <OgCard title={t(lang, "removed.title")} footer={t(lang, "removed.body")} />,
      { ...size, fonts, status: 410, headers: { "Cache-Control": "no-store" } },
    );
  }

  const stored = found?.stored ?? null;
  if (!stored) {
    return new ImageResponse(
      (
        <OgCard
          eyebrow="Three independent AI judges"
          title={t("en", "hero.titleLine1")}
          titleSerif={t("en", "hero.titleLine2")}
          footer="Settle your own argument"
          tugA={50}
        />
      ),
      { ...size, fonts },
    );
  }

  const r = stored.result;
  const lang = contentLang(`${r.headline} ${r.crux}`);
  const display = found?.display ?? null;
  const nameA = display?.a ?? t(lang, "party.a");
  const nameB = display?.b ?? t(lang, "party.b");
  const parties = resolveParties(publicNameMap(display), lang, "A", { noSelf: true });
  const label = verdictLabel(r, nameA, nameB, false, false, lang);
  const lean = r.lean;
  const leanLine = lean
    ? t(lang, "lean.title", { name: lean.party === "a" ? nameA : nameB })
    : undefined;
  const accent =
    r.verdict === "side_a" ? ACCENT_A : r.verdict === "side_b" ? ACCENT_B : undefined;
  const cta = t(lang, "shared.cta").replace(/\s*→$/, "");
  const confidence = confidenceLabel(lang, r);

  return new ImageResponse(
    (
      <OgCard
        eyebrow={leanLine ?? t(lang, `badge.${r.dispute_type}`)}
        title={label}
        subtitle={restoreNames(r.headline, parties, lang)}
        footer={confidence ? `${confidence}  ·  ${cta}` : cta}
        tugA={tugFinal(r)}
        accent={accent}
      />
    ),
    { ...size, fonts },
  );
}
