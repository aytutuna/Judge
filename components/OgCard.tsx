/**
 * Link-preview card markup for next/og (Satori). Satori supports only flex
 * layout and inline styles, so this mirrors the site's look with literal
 * light-theme colours. No emoji: Satori would fetch emoji images from a CDN
 * at render time, which is slow and can fail.
 */

export const OG_SIZE = { width: 1200, height: 630 };

const INK = "#0b0b0b";
const INK_2 = "#52514e";
const PLANE = "#f9f9f7";
const SURFACE = "#fcfcfb";
const LINE = "#e1e0d9";
export const PARTY_A = "#2a78d6";
export const PARTY_B = "#eb6834";

function truncate(s: string, max: number): string {
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

export function OgCard({
  eyebrow,
  title,
  subtitle,
  footer,
  tugA,
  accent = INK,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  footer: string;
  /** Party A's share of the tug-of-war bar, 0..100. */
  tugA: number;
  accent?: string;
}) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: PLANE,
        padding: "64px 72px",
        color: INK,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", fontSize: 40, letterSpacing: -1, color: INK }}>Verdict</div>
        <div
          style={{
            display: "flex",
            fontSize: 24,
            color: INK_2,
            border: `2px solid ${LINE}`,
            background: SURFACE,
            borderRadius: 999,
            padding: "8px 22px",
          }}
        >
          {truncate(eyebrow, 40)}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ display: "flex", fontSize: 76, lineHeight: 1.05, letterSpacing: -2, color: accent }}>
          {truncate(title, 60)}
        </div>
        {subtitle ? (
          <div style={{ display: "flex", fontSize: 34, lineHeight: 1.3, color: INK_2 }}>
            {truncate(subtitle, 150)}
          </div>
        ) : null}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div
          style={{
            display: "flex",
            height: 22,
            borderRadius: 999,
            overflow: "hidden",
            background: PARTY_B,
          }}
        >
          <div
            style={{
              display: "flex",
              width: `${Math.max(0, Math.min(100, tugA))}%`,
              height: "100%",
              background: PARTY_A,
              borderRight: `4px solid ${SURFACE}`,
            }}
          />
        </div>
        <div style={{ display: "flex", fontSize: 26, color: INK_2 }}>{footer}</div>
      </div>
    </div>
  );
}
