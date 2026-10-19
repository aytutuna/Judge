/**
 * Ivory & Terracotta palette: the single source of truth for every colour
 * that lives outside CSS (OG images, inline SVG, three.js materials).
 * `app/globals.css` declares the same values as CSS custom properties, and
 * test/palette.test.ts fails if the two drift apart.
 *
 * Pure module, no "use client": safe in server code, Satori and the browser.
 */

/** Opaque colours as `#RRGGBB`. Keys map to CSS names via `cssVarName`
 * (`ivory2` → `--ivory-2`, `terraInk` → `--terra-ink`). */
export const PALETTE = {
  ivory: "#F6F1E9",
  ivory2: "#EEE6D9",
  paper: "#FFFCF7",
  ink: "#1C1916",
  ink2: "#4A433C",
  muted: "#6B6258",
  placeholder: "#776D61",
  terra: "#C8553D",
  terraInk: "#A9442F",
  terraTint: "#F3DDD5",
  sage: "#8AA899",
  sageStrong: "#6E8F80",
  sageInk: "#4F6F60",
  sageTint: "#DDE7E0",
  stone: "#D6C7B0",
  strata: "#E6DCCB",
  danger: "#B3261E",
} as const;

export type PaletteKey = keyof typeof PALETTE;

/** Translucent colours, written exactly as in globals.css. */
export const PALETTE_ALPHA = {
  line: "rgba(28, 25, 22, 0.09)",
  line2: "rgba(28, 25, 22, 0.14)",
  glass: "rgba(255, 252, 247, 0.68)",
} as const;

export type PaletteAlphaKey = keyof typeof PALETTE_ALPHA;

/** The same opaque colours as numbers (`0xRRGGBB`) for three.js. */
export const PALETTE_NUM = Object.fromEntries(
  Object.entries(PALETTE).map(([k, v]) => [k, Number.parseInt(v.slice(1), 16)]),
) as { readonly [K in PaletteKey]: number };

/** CSS custom property name for a palette key: `sageInk` → `--sage-ink`. */
export function cssVarName(key: PaletteKey | PaletteAlphaKey): string {
  return `--${key.replace(/([A-Z])/g, "-$1").replace(/(\d+)/g, "-$1").toLowerCase()}`;
}

/** WCAG 2.x relative luminance of a `#RRGGBB` colour. */
export function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/** WCAG contrast ratio between two `#RRGGBB` colours (1 to 21). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
