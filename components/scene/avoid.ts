import { AVOID_MAX_WIDTH, avoidOpacity, type Box } from "@/lib/scene-avoid";

/**
 * DOM side of the overlap fade (lib/scene-avoid.ts holds the maths).
 *
 * Text blocks marked `[data-scene-avoid]` inside the stage wrap are the
 * boxes the balance must not ghost through on narrow screens. Blocks inside
 * `[data-phase="judging"]` are skipped: the hero fades its own text while
 * judging, so the scene can show through.
 */

/** Opacity for a drawing at `content` (viewport px) inside `wrap`. Always 1
 * on wide screens, where text and balance sit side by side. */
export function avoidOpacityIn(wrap: Element, content: Box): number {
  if (window.innerWidth >= AVOID_MAX_WIDTH) return 1;
  const boxes: Box[] = [];
  for (const el of wrap.querySelectorAll("[data-scene-avoid]")) {
    if (el.closest('[data-phase="judging"]')) continue;
    boxes.push(el.getBoundingClientRect());
  }
  return avoidOpacity(content, boxes);
}

/**
 * Calls `fn` (once per animation frame at most) whenever the overlap may
 * have changed without a scene frame: scrolling, resizing, the hero's phase
 * flipping (its lead is removed and the card swapped, so the text moves),
 * an avoid block changing size, and the end of the text's own transitions.
 */
export function watchAvoidLayout(wrap: Element, fn: () => void): () => void {
  let raf = 0;
  const schedule = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      fn();
    });
  };
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);
  wrap.addEventListener("transitionend", schedule);
  const mo = new MutationObserver(schedule);
  mo.observe(wrap, { subtree: true, attributes: true, attributeFilter: ["data-phase"] });
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
  if (ro) {
    ro.observe(wrap);
    for (const el of wrap.querySelectorAll("[data-scene-avoid]")) ro.observe(el);
  }
  schedule();
  return () => {
    if (raf) cancelAnimationFrame(raf);
    window.removeEventListener("scroll", schedule);
    window.removeEventListener("resize", schedule);
    wrap.removeEventListener("transitionend", schedule);
    mo.disconnect();
    ro?.disconnect();
  };
}
