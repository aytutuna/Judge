/**
 * Scheduling helpers for the engine: the rAF loop, adaptive pixel ratio, and
 * the signals that pause it (stage offscreen, tab hidden, reduced motion).
 * No three.js here.
 */

export type Loop = { start(): void; stop(): void; readonly running: boolean };

/** rAF loop with dt in seconds, clamped so a long pause never explodes the
 * springs. */
export function createLoop(frame: (dt: number, now: number) => void): Loop {
  let raf = 0;
  let running = false;
  let last = 0;
  const tick = (now: number) => {
    raf = 0;
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    frame(dt, now);
    if (running && !raf) raf = requestAnimationFrame(tick);
  };
  return {
    start() {
      if (running) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    },
    stop() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
    get running() {
      return running;
    },
  };
}

/** Steps the pixel ratio down by `step` (to `floor`) whenever the average
 * rendered frame over `window` frames exceeds `budgetMs`. */
export function createDprGovernor(opts: {
  start: number;
  floor?: number;
  step?: number;
  budgetMs?: number;
  window?: number;
  onChange: (dpr: number) => void;
}) {
  const floor = opts.floor ?? 1;
  const step = opts.step ?? 0.25;
  const budget = opts.budgetMs ?? 22;
  const size = opts.window ?? 60;
  let dpr = opts.start;
  let sum = 0;
  let count = 0;
  return {
    get dpr() {
      return dpr;
    },
    sample(frameMs: number) {
      // Ignore stalls (tab switches, GC pauses): they are not GPU load.
      if (frameMs <= 0 || frameMs > 120 || dpr <= floor) return;
      sum += frameMs;
      count += 1;
      if (count < size) return;
      const avg = sum / count;
      sum = 0;
      count = 0;
      if (avg > budget) {
        dpr = Math.max(floor, Math.round((dpr - step) * 100) / 100);
        opts.onChange(dpr);
      }
    },
    reset() {
      sum = 0;
      count = 0;
    },
  };
}

/** Calls back with true while `el` is within 100px of the viewport and the
 * tab is visible. */
export function watchActivity(el: Element, onChange: (active: boolean) => void): () => void {
  let near = true;
  const emit = () => onChange(near && !document.hidden);
  const io =
    typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver(
          (entries) => {
            near = entries[entries.length - 1]?.isIntersecting ?? near;
            emit();
          },
          { rootMargin: "100px" },
        )
      : null;
  io?.observe(el);
  document.addEventListener("visibilitychange", emit);
  emit();
  return () => {
    io?.disconnect();
    document.removeEventListener("visibilitychange", emit);
  };
}
