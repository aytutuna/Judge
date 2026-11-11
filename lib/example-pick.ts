/**
 * Which "Try an example" to show next. Pure, so the apps can port it and be
 * checked against the golden vectors in mobile/shared/fixtures.
 *
 * `seen` lists the ids already shown in the current round, oldest first; its
 * last entry is the example on screen. Unseen ids are picked from at random
 * until all have been shown, then a new round starts, which never opens with
 * the example just shown. Ids in `seen` that no longer exist are ignored.
 * `random` returns a number in [0, 1).
 */
export function nextExample(ids: readonly string[], seen: readonly string[], random: () => number): { id: string; seen: string[] } {
  const known = seen.filter((id) => ids.includes(id));
  const last = known.length ? known[known.length - 1] : null;
  const unseen = ids.filter((id) => !known.includes(id));
  const fresh = unseen.length === 0;
  const pool = (fresh ? ids : unseen).filter((id) => id !== last || ids.length === 1);
  const id = pool[Math.min(Math.floor(random() * pool.length), pool.length - 1)];
  return { id, seen: fresh ? [id] : [...known, id] };
}

const SEEN_KEY = "judge-examples-seen";

export function loadSeen(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function saveSeen(seen: readonly string[]): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    // Private mode or a full disk: the next pick just starts from nothing.
  }
}
