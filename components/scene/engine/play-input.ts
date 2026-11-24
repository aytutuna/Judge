import type { BalanceEngine } from "./index";

const INTERACTIVE =
  "a, button, input, textarea, select, label, summary, video, iframe, [tabindex], [contenteditable], [role=button], [role=link], [role=tab], [role=switch], [role=checkbox]";

/**
 * Pointer and touch wiring for ball play. `target` is the canvas, or the
 * document for a canvas that sits behind page content: a press there only
 * grabs when it lands on a ball, anything else is left to the page. `onHold`
 * hears when a ball is picked up and put down (the apps tell their native
 * scroll view). `enabled` is asked at every press; for a canvas behind the
 * page it also decides whether the non-passive touchstart listener (which
 * makes every touch wait for the main thread) is attached at all, so the
 * host calls `sync` when the answer may have changed.
 */
export function watchPlay(
  canvas: HTMLCanvasElement,
  eng: BalanceEngine,
  target: HTMLCanvasElement | Document = canvas,
  onHold?: (held: boolean) => void,
  enabled: () => boolean = () => true,
): { stop(): void; sync(): void } {
  const behind = target !== canvas;
  const cursorEl = behind ? document.documentElement : canvas;
  const at = (e: { clientX: number; clientY: number }) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  const onControl = (t: EventTarget | null) => behind && t instanceof Element && t.closest(INTERACTIVE) !== null;
  let grabId: number | null = null;
  const noSelect = (e: Event) => e.preventDefault();
  const touchMove = (e: Event) => e.preventDefault();
  const drop = () => {
    grabId = null;
    cursorEl.style.cursor = "";
    target.removeEventListener("touchmove", touchMove);
    document.removeEventListener("selectstart", noSelect);
    onHold?.(false);
  };
  const down = (e: Event) => {
    const p = e as PointerEvent;
    if (grabId !== null) return;
    if (p.pointerType === "mouse" && (p.button !== 0 || p.ctrlKey)) return;
    if (onControl(p.target) || !enabled()) return;
    if (!eng.pointerDown(...at(p))) return;
    grabId = p.pointerId;
    p.preventDefault();
    if (!behind) canvas.setPointerCapture(p.pointerId);
    cursorEl.style.cursor = "grabbing";
    // A mouse drag over page text would otherwise start a selection.
    document.addEventListener("selectstart", noSelect);
    target.addEventListener("touchmove", touchMove, { passive: false });
    onHold?.(true);
  };
  const move = (e: Event) => {
    const p = e as PointerEvent;
    if (grabId === null) {
      if (p.pointerType !== "touch") cursorEl.style.cursor = eng.hitBall(...at(p)) ? "grab" : "";
    } else if (p.pointerId === grabId && !eng.pointerMove(...at(p))) drop();
  };
  const up = (e: Event) => {
    const p = e as PointerEvent;
    if (p.pointerId !== grabId) return;
    drop();
    eng.pointerUp(...at(p));
  };
  const cancel = (e: Event) => {
    if ((e as PointerEvent).pointerId !== grabId) return;
    drop();
    eng.pointerCancel();
  };
  // pointerdown runs before touchstart, so a grab is already on by then.
  // A swipe that starts off the balls still scrolls the page.
  const touch = (e: Event) => {
    const t = e as TouchEvent;
    if (onControl(e.target) || !enabled()) return;
    if (grabId !== null || (t.touches.length === 1 && eng.hitBall(...at(t.touches[0])))) e.preventDefault();
  };
  target.addEventListener("pointerdown", down);
  target.addEventListener("pointermove", move);
  target.addEventListener("pointerup", up);
  target.addEventListener("pointercancel", cancel);
  target.addEventListener("lostpointercapture", cancel);
  let touching = false;
  const sync = () => {
    const want = !behind || enabled();
    if (want === touching) return;
    touching = want;
    if (want) target.addEventListener("touchstart", touch, { passive: false });
    else target.removeEventListener("touchstart", touch);
  };
  sync();
  const stop = () => {
    if (grabId !== null) {
      drop();
      eng.pointerCancel();
    }
    target.removeEventListener("pointerdown", down);
    target.removeEventListener("pointermove", move);
    target.removeEventListener("pointerup", up);
    target.removeEventListener("pointercancel", cancel);
    target.removeEventListener("lostpointercapture", cancel);
    target.removeEventListener("touchstart", touch);
  };
  return { stop, sync };
}
