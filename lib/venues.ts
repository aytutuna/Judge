/**
 * The places the court can be set in. A case gets one at random when it is
 * judged and keeps it, so everyone who opens it sees the same scene. The
 * list and the pick rule are shared with the apps (mobile/shared/venues and
 * the golden vectors in mobile/shared/fixtures). Pure apart from the two
 * localStorage helpers.
 */
export const VENUES = ["court", "beach", "camp", "farm", "ice", "library", "museum", "street", "tv"] as const;
export type Venue = (typeof VENUES)[number];

/** The venue named, or null for anything else (missing, unknown, not a string). */
export function parseVenue(value: unknown): Venue | null {
  return typeof value === "string" && (VENUES as readonly string[]).includes(value) ? (value as Venue) : null;
}

/**
 * A venue from `ids` other than `last` (unless it is the only one).
 * `random` returns a number in [0, 1).
 */
export function pickVenue(ids: readonly string[], last: string | null, random: () => number): string {
  const pool = ids.filter((id) => id !== last || ids.length === 1);
  return pool[Math.min(Math.floor(random() * pool.length), pool.length - 1)];
}

const LAST_KEY = "judge-venue-last";

/** A new pick that differs from the last one this device showed; remembers it. */
export function freshVenue(): Venue {
  let last: string | null = null;
  try {
    last = localStorage.getItem(LAST_KEY);
  } catch {
    // Private mode: the pick just can't avoid a repeat.
  }
  const venue = pickVenue(VENUES, last, Math.random) as Venue;
  try {
    localStorage.setItem(LAST_KEY, venue);
  } catch {
    // Nothing to remember it in.
  }
  return venue;
}
