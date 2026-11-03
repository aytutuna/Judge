import { svgRotateDeg } from "@/lib/balance";
import { PALETTE } from "@/lib/palette";

// The SVG from components/scene/BalanceFallback.tsx as markup, so the page
// paints it before the script has even been parsed.

const PIVOT_X = 210;
const PIVOT_Y = 92;
const HALF = 160;
const CUP_X = HALF - 14;
const IDLE_DEG = -3;

export function tiltDeg(tugA?: number): number {
  return tugA === undefined ? IDLE_DEG : svgRotateDeg(tugA);
}

export function tiltTransform(deg: number): string {
  return `rotate(${deg.toFixed(2)} ${PIVOT_X} ${PIVOT_Y})`;
}

/** Colours are the --scene-* and --party-* tokens the page CSS sets per theme
 * (build-scene.ts); scene.ts moves data-you when the viewer is Party B. */
export function balanceSvg(): string {
  const cup = (s: number) =>
    `<path d="M${PIVOT_X + s * CUP_X - 17} ${PIVOT_Y - 12}h34l-5 6h-24z" fill="var(--scene-plaster)"/>`;
  return [
    `<svg id="fallback" data-you="a" viewBox="0 0 420 220" aria-hidden="true" focusable="false">`,
    `<ellipse cx="${PIVOT_X}" cy="207" rx="190" ry="9" fill="var(--scene-shadow)" style="opacity:var(--scene-shadow-opacity)"/>`,
    `<rect x="30" y="190" width="360" height="14" rx="7" fill="var(--scene-plaster)"/>`,
    `<rect x="30" y="190" width="360" height="3" rx="1.5" fill="${PALETTE.paper}" opacity="0.7"/>`,
    `<path d="M${PIVOT_X} ${PIVOT_Y} ${PIVOT_X - 26} 190h52z" fill="var(--scene-beam)"/>`,
    `<g id="beam" transform="${tiltTransform(IDLE_DEG)}">`,
    `<rect x="${PIVOT_X - HALF}" y="${PIVOT_Y - 6}" width="${HALF * 2}" height="9" rx="4.5" fill="var(--scene-beam)"/>`,
    cup(-1),
    cup(1),
    `<circle cx="${PIVOT_X - CUP_X}" cy="${PIVOT_Y - 48}" r="36" fill="var(--party-a)"/>`,
    `<circle cx="${PIVOT_X + CUP_X}" cy="${PIVOT_Y - 48}" r="36" fill="var(--party-b)"/>`,
    `</g>`,
    `<circle cx="${PIVOT_X}" cy="${PIVOT_Y}" r="6" fill="var(--scene-plaster)"/>`,
    `</svg>`,
  ].join("");
}
