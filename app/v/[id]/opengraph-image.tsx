import { ImageResponse } from "next/og";
import { OG_SIZE, OgCard, PARTY_A, PARTY_B } from "@/components/OgCard";
import { tugFinal, verdictLabel } from "@/components/VerdictReveal";
import { getVerdict } from "@/lib/db";
import { contentLang, t, type Key } from "@/lib/i18n";

export const alt = "A shared verdict";
export const size = OG_SIZE;
export const contentType = "image/png";

const CONF_KEY = [
  "confidence.1",
  "confidence.2",
  "confidence.3",
  "confidence.4",
  "confidence.5",
] as const satisfies readonly Key[];

/**
 * Preview card for a shared verdict: the ruling, its headline and the
 * tug-of-war bar. Crawlers send no language preference, so the label follows
 * the language the verdict text was judged in. Party names are always the
 * anonymous labels: real names are never stored.
 */
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const stored = await getVerdict(id);

  if (!stored) {
    return new ImageResponse(
      (
        <OgCard
          eyebrow="Verdict"
          title="Who's right? Settle it."
          footer="Settle your own argument"
          tugA={50}
        />
      ),
      { ...size },
    );
  }

  const r = stored.result;
  const lang = contentLang(`${r.headline} ${r.crux}`);
  const nameA = t(lang, "party.a");
  const nameB = t(lang, "party.b");
  const label = verdictLabel(r, nameA, nameB, false, false, lang);
  const lean = r.lean;
  const leanLine = lean
    ? t(lang, "lean.title", { name: lean.party === "a" ? nameA : nameB })
    : undefined;
  const accent =
    r.verdict === "side_a" ? PARTY_A : r.verdict === "side_b" ? PARTY_B : undefined;
  const cta = t(lang, "shared.cta").replace(/\s*→$/, "");
  const n = Math.max(1, Math.min(5, Math.round(r.confidence)));

  return new ImageResponse(
    (
      <OgCard
        eyebrow={leanLine ?? t(lang, `badge.${r.dispute_type}`)}
        title={label}
        subtitle={r.headline}
        footer={`${t(lang, "confidenceWord", { word: t(lang, CONF_KEY[n - 1]), n })}  ·  ${cta}`}
        tugA={tugFinal(r)}
        accent={accent}
      />
    ),
    { ...size },
  );
}
