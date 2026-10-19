/**
 * Overlap fade for the balance behind the hero and the story (mobile).
 * Pure maths, no DOM: the stage measures the drawing (the WebGL canvas's
 * projected content box, or the SVG fallback's bounding box) and every
 * `[data-scene-avoid]` text block, in viewport px, and asks here how opaque
 * the drawing may be.
 *
 * The fade follows real overlap, not proximity: the drawing stays fully
 * opaque while at least FADE_CLEAR_PX of clear space separates it from the
 * text, and is gone once the two overlap by FADE_CLEAR_PX. A resting pose
 * that sits close to the text is therefore never shown washed out.
 */

export type Box = { top: number; right: number; bottom: number; left: number };

/** Clear space (px) at which the drawing is fully opaque; the same overlap
 * hides it completely. */
export const FADE_CLEAR_PX = 12;

/** Below this viewport width the text and the balance share a column. */
export const AVOID_MAX_WIDTH = 960;

/** Opacity for a vertical gap in px (negative = overlap). */
export function fadeForGap(gap: number): number {
  if (Number.isNaN(gap)) return 1;
  const op = (gap + FADE_CLEAR_PX) / (2 * FADE_CLEAR_PX);
  return Math.max(0, Math.min(1, op));
}

/** Opacity of a drawing at `content` given the text boxes it must not
 * ghost through. Boxes that do not share any columns with it, or have no
 * height, are ignored. */
export function avoidOpacity(content: Box, avoid: readonly Box[]): number {
  let op = 1;
  for (const a of avoid) {
    if (a.bottom - a.top <= 0 || a.right < content.left || a.left > content.right) continue;
    const gap = Math.max(a.top - content.bottom, content.top - a.bottom);
    op = Math.min(op, fadeForGap(gap));
    if (op === 0) break;
  }
  return op;
}
