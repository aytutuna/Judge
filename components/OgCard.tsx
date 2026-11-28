/**
 * Link-preview card markup for next/og (Satori). Satori supports only flex
 * layout and inline styles, so this mirrors the site with literal palette
 * colours and the site's own faces, loaded from committed OFL TTFs (static
 * instances with latin-ext, so Turkish renders). No emoji: Satori would
 * fetch emoji images from a CDN at render time, which is slow and can fail.
 * Server-only (reads the font files from disk; on Workers from the static
 * assets, where scripts/cf-build.mjs copies assets/ to _og/).
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PALETTE, PALETTE_ALPHA, sideColors } from "@/lib/palette";
import { workerEnv } from "@/lib/worker-env";

export const OG_SIZE = { width: 1200, height: 630 };

// The rounded Stone plate with the 3D mark, 4x its 64px slot. Set by ogFonts(),
// which every card's route awaits before it renders.
let mark = "";

async function asset(name: string): Promise<Buffer> {
  const env = workerEnv();
  if (env) {
    const res = await env.ASSETS.fetch(`https://assets.internal/_og/${name}`);
    if (!res.ok) throw new Error(`asset ${name}: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  return readFile(join(process.cwd(), "assets", name));
}

/** Nobody is known to be looking at a link preview, so Party A, who
 * started it, is the green side. Tug-bar fills use the 3:1 mark colours and
 * a winner's title the text inks. */
export const OG_SIDES = sideColors(null);

const DISPLAY = "Inter Tight";
const TEXT = "Inter";
const SERIF = "Instrument Serif";

type OgFont = {
  name: string;
  data: Buffer;
  weight: 400 | 500 | 700;
  style: "normal" | "italic";
};

async function loadFonts(): Promise<OgFont[]> {
  const [display, text, serif, plate] = await Promise.all([
    asset("fonts/InterTight-Bold.ttf"),
    asset("fonts/Inter-Medium.ttf"),
    asset("fonts/InstrumentSerif-Italic.ttf"),
    asset("og-mark.png"),
  ]);
  mark = `data:image/png;base64,${plate.toString("base64")}`;
  return [
    { name: DISPLAY, data: display, weight: 700, style: "normal" },
    { name: TEXT, data: text, weight: 500, style: "normal" },
    { name: SERIF, data: serif, weight: 400, style: "italic" },
  ];
}

let fontsPromise: Promise<OgFont[]> | null = null;

/** The three faces the card uses (and the mark), read once per server process. */
export function ogFonts(): Promise<OgFont[]> {
  if (!fontsPromise) {
    fontsPromise = loadFonts().catch((err: unknown) => {
      fontsPromise = null; // let the next request try again
      throw err;
    });
  }
  return fontsPromise;
}

// What Inter and Inter Tight can draw. Anything else would come out as empty
// boxes, and Satori does not lay out right-to-left text either.
const DRAWABLE = /^[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Common}\p{Script=Inherited}]*$/u;

/** Whether the card's faces can draw every one of these texts. */
export function ogCanDraw(...texts: (string | undefined)[]): boolean {
  return texts.every((s) => !s || DRAWABLE.test(s));
}

function truncate(s: string, max: number): string {
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

export function OgCard({
  eyebrow,
  title,
  titleSerif,
  subtitle,
  footer,
  tugA,
  accent = PALETTE.ink,
}: {
  /** The pill at the top right; none when omitted. */
  eyebrow?: string;
  title: string;
  /** Optional second title line in terracotta serif italic ("Settle it."). */
  titleSerif?: string;
  subtitle?: string;
  footer: string;
  /** Party A's share of the tug-of-war bar, 0..100; no bar when omitted. */
  tugA?: number;
  accent?: string;
}) {
  const a = tugA === undefined ? null : Math.max(0, Math.min(100, tugA));
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: PALETTE.ivory,
        padding: "60px 72px 56px",
        color: PALETTE.ink,
        fontFamily: TEXT,
        fontWeight: 500,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- Satori, not the browser */}
          <img src={mark} width={64} height={64} alt="" style={{ flexShrink: 0 }} />
          <div
            style={{
              display: "flex",
              fontFamily: DISPLAY,
              fontWeight: 700,
              fontSize: 42,
              letterSpacing: -1,
              color: PALETTE.ink,
            }}
          >
            Judge
          </div>
        </div>
        {eyebrow ? (
          <div
            style={{
              display: "flex",
              fontSize: 24,
              color: PALETTE.ink2,
              border: `2px solid ${PALETTE_ALPHA.line2}`,
              background: PALETTE.paper,
              borderRadius: 999,
              padding: "8px 22px",
            }}
          >
            {truncate(eyebrow, 40)}
          </div>
        ) : null}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        <div
          style={{
            display: "flex",
            fontFamily: DISPLAY,
            fontWeight: 700,
            fontSize: 80,
            lineHeight: 1.02,
            letterSpacing: -3,
            color: accent,
          }}
        >
          {truncate(title, 60)}
        </div>
        {titleSerif ? (
          <div
            style={{
              display: "flex",
              fontFamily: SERIF,
              fontStyle: "italic",
              fontWeight: 400,
              fontSize: 96,
              lineHeight: 0.95,
              letterSpacing: -1,
              color: PALETTE.terra,
              marginTop: -10,
            }}
          >
            {truncate(titleSerif, 40)}
          </div>
        ) : null}
        {subtitle ? (
          <div style={{ display: "flex", fontSize: 32, lineHeight: 1.32, color: PALETTE.ink2 }}>
            {truncate(subtitle, 150)}
          </div>
        ) : null}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {a === null ? null : (
        <div style={{ display: "flex", position: "relative", height: 34, alignItems: "center" }}>
          <div
            style={{
              display: "flex",
              width: "100%",
              height: 18,
              borderRadius: 999,
              overflow: "hidden",
              background: OG_SIDES.b.strong,
            }}
          >
            <div style={{ display: "flex", width: `${a}%`, height: "100%", background: OG_SIDES.a.strong }} />
          </div>
          <div
            style={{
              display: "flex",
              position: "absolute",
              left: `${a}%`,
              top: 0,
              width: 34,
              height: 34,
              marginLeft: -17,
              borderRadius: 999,
              background: PALETTE.paper,
              border: `4px solid ${PALETTE.ink}`,
            }}
          />
        </div>
        )}
        <div style={{ display: "flex", fontSize: 26, color: PALETTE.ink2 }}>{footer}</div>
      </div>
    </div>
  );
}
