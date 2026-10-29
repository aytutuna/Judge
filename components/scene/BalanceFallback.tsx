import { svgRotateDeg } from "@/lib/balance";
import { PALETTE, greenParty, type Party } from "@/lib/palette";

/**
 * Static SVG balance: the first-paint illustration under the 3D canvas, the
 * no-WebGL / data-saver fallback, and the small balance on pages without
 * three.js (share page, 404). Hook-free and server-safe; colours are the
 * --scene-* and --party-* tokens from globals.css, so the drawing follows the
 * theme like the 3D scene does. Decorative only (aria-hidden): the text always
 * carries the verdict.
 *
 * - `tugA`: Party A's tug share (tugFinal). Tilts the beam exactly like the
 *   3D scene (svgRotateDeg). Omitted = the idle pose, a slight lean.
 * - `empty`: no spheres and the beam tipped over (the 404 page).
 * - `you`: the viewer's party, drawn green (sideColors). Omitted = Party A.
 */

const PIVOT_X = 210;
const PIVOT_Y = 92;
const HALF = 160;
const IDLE_DEG = -3;
const EMPTY_DEG = 12;

export function BalanceFallback({
  tugA,
  className,
  empty = false,
  you = null,
}: {
  tugA?: number;
  className?: string;
  empty?: boolean;
  you?: Party | null;
}) {
  const deg = empty ? EMPTY_DEG : tugA === undefined ? IDLE_DEG : svgRotateDeg(tugA);
  const cupX = HALF - 14;
  return (
    <svg
      className={className}
      viewBox="0 0 420 220"
      aria-hidden="true"
      focusable="false"
      // A tipped beam lifts the high sphere above the drawing's box: let it
      // overflow rather than clip (callers leave room above).
      style={{ overflow: "visible" }}
      data-tilt-deg={deg.toFixed(2)}
      data-you={greenParty(you)}
    >
      <ellipse
        cx={PIVOT_X}
        cy={207}
        rx={190}
        ry={9}
        fill="var(--scene-shadow)"
        style={{ opacity: "var(--scene-shadow-opacity)" }}
      />
      <rect x={30} y={190} width={360} height={14} rx={7} fill="var(--scene-plaster)" />
      <rect x={30} y={190} width={360} height={3} rx={1.5} fill={PALETTE.paper} opacity={0.7} />
      <path d={`M${PIVOT_X} ${PIVOT_Y} ${PIVOT_X - 26} 190h52z`} fill="var(--scene-beam)" />
      <g transform={`rotate(${deg.toFixed(2)} ${PIVOT_X} ${PIVOT_Y})`}>
        <rect
          x={PIVOT_X - HALF}
          y={PIVOT_Y - 6}
          width={HALF * 2}
          height={9}
          rx={4.5}
          fill="var(--scene-beam)"
        />
        {[-1, 1].map((s) => (
          <path
            key={s}
            d={`M${PIVOT_X + s * cupX - 17} ${PIVOT_Y - 12}h34l-5 6h-24z`}
            // Empty cups need to read on their own against the page.
            fill={empty ? "var(--stone)" : "var(--scene-plaster)"}
          />
        ))}
        {empty ? null : (
          <>
            <circle cx={PIVOT_X - cupX} cy={PIVOT_Y - 48} r={36} fill="var(--party-a)" />
            <circle cx={PIVOT_X + cupX} cy={PIVOT_Y - 48} r={36} fill="var(--party-b)" />
          </>
        )}
      </g>
      <circle cx={PIVOT_X} cy={PIVOT_Y} r={6} fill="var(--scene-plaster)" />
    </svg>
  );
}
