/**
 * Releasing a dragged card: it flies off when let go fast enough or far
 * enough, else it springs back. The iOS and Android judging screens use the
 * same numbers (points / dp, milliseconds).
 */

export type Sample = { x: number; y: number; t: number };

export const THROW_DISTANCE = 110;
/** Pixels per millisecond. */
export const THROW_SPEED = 0.7;
/** A flick has to travel at least this far, so a twitch doesn't throw. */
export const FLICK_MIN_MOVE = 24;
/** Only the last stretch of the drag counts as the release speed. */
export const VELOCITY_WINDOW_MS = 100;

/** Release velocity in px/ms from the pointer's recent samples. */
export function releaseVelocity(samples: readonly Sample[]): { vx: number; vy: number } {
  const last = samples[samples.length - 1];
  if (!last) return { vx: 0, vy: 0 };
  const first = samples.find((s) => last.t - s.t <= VELOCITY_WINDOW_MS) ?? last;
  const dt = last.t - first.t;
  if (dt <= 0) return { vx: 0, vy: 0 };
  return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt };
}

export function isThrow(dx: number, dy: number, vx: number, vy: number): boolean {
  const moved = Math.hypot(dx, dy);
  return moved >= THROW_DISTANCE || (moved >= FLICK_MIN_MOVE && Math.hypot(vx, vy) >= THROW_SPEED);
}

/** Where a thrown card ends up, `reach` away from where it was let go: along
 * the release velocity, or along the drag when it was let go standing still. */
export function throwTarget(dx: number, dy: number, vx: number, vy: number, reach: number): { x: number; y: number } {
  const fast = Math.hypot(vx, vy) > 0.05;
  const [ux, uy] = fast ? [vx, vy] : [dx, dy];
  const len = Math.hypot(ux, uy) || 1;
  return { x: dx + (ux / len) * reach, y: dy + (uy / len) * reach };
}
