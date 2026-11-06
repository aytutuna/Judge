// What the judging card says while it waits. The browser only hears two
// things from the server: that the names are out (the 202) and that the
// verdict is in, so everything between is paced by the clock. The order is
// the server's real order (lib/premium/run.ts); only the timing is guessed.

export const WAITING = ["names", "facts", "judges", "bothSides", "crux", "ruling"] as const;
export type Waiting = (typeof WAITING)[number];

// How long each line holds once the names are out. The last one waits for
// the verdict however long it takes.
const HOLD: Record<Exclude<Waiting, "names" | "ruling">, number> = {
  facts: 9000,
  judges: 6000,
  bothSides: 7000,
  crux: 7000,
};

/** The longest the card plays on after the verdict lands (a close call, five votes). */
export const ENDING_MAX_MS = 14000;

/** Names stay up at least this long, so the first line can be read. */
export const NAMES_MIN_MS = 2500;

/** The line being worked on `elapsed` ms in, given when the 202 came (null: not yet). */
export function waitingAt(elapsed: number, acceptedAt: number | null): number {
  if (acceptedAt === null) return 0;
  let t = Math.max(NAMES_MIN_MS, acceptedAt);
  if (elapsed < t) return 0;
  for (let i = 1; i < WAITING.length - 1; i++) {
    t += HOLD[WAITING[i] as keyof typeof HOLD];
    if (elapsed < t) return i;
  }
  return WAITING.length - 1;
}

/** The most common vote and how many judges gave it; no side unless it's more than half. */
export function agreement(votes: readonly string[]): { side: string | null; n: number } {
  const counts = new Map<string, number>();
  for (const v of votes) counts.set(v, (counts.get(v) ?? 0) + 1);
  let side: string | null = null;
  let n = 0;
  for (const [v, c] of counts) {
    if (c > n) [side, n] = [v, c];
    else if (c === n) side = null;
  }
  return { side: n * 2 > votes.length ? side : null, n };
}
