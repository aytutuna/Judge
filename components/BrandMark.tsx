import { PALETTE } from "@/lib/palette";

/**
 * The Judge mark: an ink beam tipped toward a terracotta sphere, a sage
 * sphere, and an ink pivot. Hook-free, so it renders in server and client
 * pages alike. On the site it takes the theme's tokens; `light` pins the
 * light palette as plain hexes for Satori OG images, which stay light and
 * know no CSS variables. `size` is the width in px; the mark is 28:20.
 * Decorative (aria-hidden) unless a `title` is given.
 */
export function BrandMark({ size = 28, title, light = false }: { size?: number; title?: string; light?: boolean }) {
  const height = Math.round(((size * 20) / 28) * 100) / 100;
  const a11y = title
    ? ({ role: "img", "aria-label": title } as const)
    : ({ "aria-hidden": true } as const);
  const ink = light ? PALETTE.ink : "var(--ink)";
  return (
    <svg
      width={size}
      height={height}
      viewBox="0 0 28 20"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block", flex: "none" }}
      {...a11y}
    >
      {title ? <title>{title}</title> : null}
      <path d="M2.5 12.6 25.5 9.4" stroke={ink} strokeWidth={2} strokeLinecap="round" />
      <circle cx={6.4} cy={8.1} r={3.9} fill={light ? PALETTE.terra : "var(--terra)"} />
      <circle cx={21.6} cy={6} r={3.9} fill={light ? PALETTE.sage : "var(--sage)"} />
      <path d="M14 11.4 10.6 18.6h6.8z" fill={ink} />
    </svg>
  );
}
