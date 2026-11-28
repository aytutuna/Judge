/**
 * Sliding-window counters, the way @upstash/ratelimit counts: one counter for
 * the current fixed window and one for the one before, the earlier one
 * weighted by how much of it still overlaps. Two numbers per window instead
 * of a timestamp per request, which matters for the 5,000-a-day poll bucket.
 */

/** `w` is the window number, `n` the count in it, `p` the count in the one before, `ms` the window length. */
export type Counter = { w: number; n: number; p: number; ms: number };
export type Window = { limit: number; windowMs: number };

export type SlideResult =
  | { ok: true; counters: Counter[] }
  | { ok: false; resetAtMs: number };

/** When a refused request would pass: when the weighted count has fallen
 * under the limit, in this window if the earlier one can still carry it
 * there, else in the next. */
function reopensAt(cur: number, prev: number, limit: number, w: number, windowMs: number): number {
  const start = w * windowMs;
  if (cur < limit && prev > 0) return Math.ceil(start + windowMs * (1 - (limit - cur) / prev)) + 1;
  // In the next window this window's count is the earlier one.
  return Math.ceil(start + windowMs + windowMs * (1 - limit / Math.max(cur, limit))) + 1;
}

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
    if (used >= limit) return { ok: false, resetAtMs: reopensAt(cur, prev, limit, w, windowMs) };
    next.push({ w, n: cur + 1, p: prev, ms: windowMs });
  }
  return { ok: true, counters: next };
}

/** When nothing in these counters can still change an answer (two windows after the latest). */
export function expiresAt(counters: readonly Counter[]): number {
  return Math.max(...counters.map((c) => (c.w + 2) * c.ms));
}
