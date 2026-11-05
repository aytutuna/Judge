import { PALETTE } from "@/lib/palette";

/**
 * The Judge mark: a sage drop upper left, a terracotta drop lower right and
 * an ink dot between them. Hook-free, so it renders in server and client
 * pages alike. On the site it takes the theme's tokens; `light` pins the
 * light palette as plain hexes for Satori OG images, which stay light and
 * know no CSS variables. `size` is the width and height in px.
 * Decorative (aria-hidden) unless a `title` is given.
 */
export function BrandMark({ size = 28, title, light = false }: { size?: number; title?: string; light?: boolean }) {
  const a11y = title
    ? ({ role: "img", "aria-label": title } as const)
    : ({ "aria-hidden": true } as const);
  return (
    <svg
      width={size}
      height={size}
      viewBox="170 170 684 684"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block", flex: "none" }}
      {...a11y}
    >
      {title ? <title>{title}</title> : null}
      <path
        d="M323.55 457.71A134.16 134.16 0 1 1 457.01 337.59A261.61 261.61 0 0 0 463.48 428.62A23.4 23.4 0 0 1 440.79 457.71Z"
        fill={light ? PALETTE.sage : "var(--sage)"}
      />
      <path
        d="M700.45 566.29A134.16 134.16 0 1 1 566.99 686.41A261.61 261.61 0 0 0 560.52 595.38A23.4 23.4 0 0 1 583.21 566.29Z"
        fill={light ? PALETTE.terra : "var(--terra)"}
      />
      <circle cx={512} cy={512} r={48} fill={light ? PALETTE.ink : "var(--ink)"} />
    </svg>
  );
}
