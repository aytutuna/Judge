/**
 * Ivory & Terracotta palette: the single source of truth for every colour
 * that lives outside CSS (OG images, inline SVG, three.js materials), light
 * and dark. `app/globals.css` declares the same values as CSS custom
 * properties, and test/palette.test.ts fails if the two drift apart.
 *
 * Pure module, no "use client": safe in server code, Satori and the browser.
 */

/** Opaque colours as `#RRGGBB`. Keys map to CSS names via `cssVarName`
 * (`ivory2` → `--ivory-2`, `terraInk` → `--terra-ink`). */
export const PALETTE = {
  ivory: "#FFFFFF",
  ivory2: "#F2F0EC",
  paper: "#FFFFFF",
  ink: "#1C1916",
  ink2: "#4A433C",
  muted: "#6B6258",
  placeholder: "#776D61",
  terra: "#C8553D",
  terraInk: "#A9442F",
  terraTint: "#F3DDD5",
  sage: "#8AA899",
  sageStrong: "#6E8F80",
  sageInk: "#4C6B5D",
  sageTint: "#DDE7E0",
  stone: "#DAD6CF",
  strata: "#E9E6E1",
  danger: "#B3261E",
} as const;

export type PaletteKey = keyof typeof PALETTE;

/** Translucent colours, written exactly as in globals.css. */
export const PALETTE_ALPHA = {
  line: "rgba(28, 25, 22, 0.1)",
  line2: "rgba(28, 25, 22, 0.14)",
  glass: "rgba(255, 255, 255, 0.68)",
} as const;

export type PaletteAlphaKey = keyof typeof PALETTE_ALPHA;

/** Dark mode, same roles: the page and cards are warm near-blacks with cards
 * a step lighter, text is ivory, and the accents are lifted to keep their
 * contrast. Tints are roughly the accent washed over paper (sage's is
 * pushed greener so it still reads as green); copy the hexes, don't
 * re-derive them. */
export const PALETTE_DARK = {
  ivory: "#15120F",
  ivory2: "#27231F",
  paper: "#1D1A17",
  ink: "#F1EBE1",
  ink2: "#CFC6BA",
  muted: "#A89E92",
  placeholder: "#9A9084",
  terra: "#D9694F",
  terraInk: "#EE8C74",
  terraTint: "#432A22",
  sage: "#7F9C8E",
  sageStrong: "#8FB0A0",
  sageInk: "#A3C2B3",
  sageTint: "#2D3832",
  stone: "#4F463C",
  strata: "#3A342E",
  danger: "#F5727E",
} as const satisfies Record<PaletteKey, string>;

export const PALETTE_ALPHA_DARK = {
  line: "rgba(241, 235, 225, 0.1)",
  line2: "rgba(241, 235, 225, 0.16)",
  glass: "rgba(29, 26, 23, 0.72)",
} as const satisfies Record<PaletteAlphaKey, string>;

/** The same opaque colours as numbers (`0xRRGGBB`) for three.js. */
export const PALETTE_NUM = Object.fromEntries(
  Object.entries(PALETTE).map(([k, v]) => [k, Number.parseInt(v.slice(1), 16)]),
) as { readonly [K in PaletteKey]: number };

export type Party = "a" | "b";

/** One side's colours: `fill` for large areas, `strong` for thin marks that
 * need 3:1, `ink` for text, `tint` behind text. Terracotta is its own mark
 * colour. */
export type SideColors = { fill: string; strong: string; ink: string; tint: string };

const sides = (p: Record<PaletteKey, string>): { green: SideColors; red: SideColors } => ({
  green: { fill: p.sage, strong: p.sageStrong, ink: p.sageInk, tint: p.sageTint },
  red: { fill: p.terra, strong: p.terra, ink: p.terraInk, tint: p.terraTint },
});
const LIGHT_SIDES = sides(PALETTE);
const DARK_SIDES = sides(PALETTE_DARK);

/**
 * The viewer's own side is green (sage), the other side red (terracotta).
 * `you` is the party the viewer is; only "b" (the other side of a two-sided
 * case) changes anything. Everyone else sees Party A in green: the writer
 * of a one-person verdict wrote Party A as themselves, and when the viewer
 * is unknown (share images, samples, a stranger on a share link) Party A is
 * whoever started it. app/globals.css mirrors this with --party-* tokens.
 */
export function greenParty(you?: Party | null): Party {
  return you === "b" ? "b" : "a";
}

/** `dark` picks the dark palette's sides (the 3D scene under a dark theme). */
export function sideColors(you?: Party | null, dark = false): Record<Party, SideColors> {
  const { green, red } = dark ? DARK_SIDES : LIGHT_SIDES;
  return greenParty(you) === "a" ? { a: green, b: red } : { a: red, b: green };
}

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
