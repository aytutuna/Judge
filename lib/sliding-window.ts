/**
 * Sliding-window counters, the way @upstash/ratelimit counts: one counter for
 * the current fixed window and one for the one before, the earlier one
 * weighted by how much of it still overlaps. Two numbers per window instead
 * of a timestamp per request, which matters for the 5,000-a-day poll bucket.
 */

export type Counter = { w: number; n: number; p: number };
export type Window = { limit: number; windowMs: number };

export type SlideResult =
  | { ok: true; counters: Counter[] }
  | { ok: false; resetAtMs: number };

/** Checks every window before recording, so a refused request costs no
 * quota; `counters` holds one entry per window, in order. */
export function slideCheck(counters: readonly (Counter | undefined)[], windows: readonly Window[], now: number): SlideResult {
  const next: Counter[] = [];
  for (const [i, { limit, windowMs }] of windows.entries()) {
    const w = Math.floor(now / windowMs);
    const c = counters[i];
    const cur = c?.w === w ? c.n : 0;
    const prev = c?.w === w ? c.p : c?.w === w - 1 ? c.n : 0;
    const used = cur + prev * (1 - (now - w * windowMs) / windowMs);
    if (used >= limit) return { ok: false, resetAtMs: (w + 1) * windowMs };
    next.push({ w, n: cur + 1, p: prev });
  }
  return { ok: true, counters: next };
}
