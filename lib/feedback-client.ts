import type { Key } from "./i18n";

export type ConsentState = "not_asked" | "on" | "off";
export type Rating = "up" | "down";

const JSON_HEADERS = { "content-type": "application/json" };

/** Send the browser to sign in and back to this page. */
export function askSignIn(): void {
  window.location.href = `/signin?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
}

/** GET /api/v1/me/consent. Null on any failure. */
export async function fetchConsent(): Promise<ConsentState | null> {
  try {
    const res = await fetch("/api/v1/me/consent", { credentials: "same-origin", cache: "no-store" });
    return res.ok ? ((await res.json()) as { state: ConsentState }).state : null;
  } catch {
    return null;
  }
}

/** POST /api/v1/me/consent. The new state, or null when it was not saved. */
export async function saveConsent(
  choice: "on" | "off",
  source: "card" | "switch",
  wordingKey: Key,
): Promise<ConsentState | null> {
  try {
    const res = await fetch("/api/v1/me/consent", {
      method: "POST",
      headers: JSON_HEADERS,
      credentials: "same-origin",
      body: JSON.stringify({ choice, source, wordingKey, platform: "web" }),
    });
    return res.ok ? ((await res.json()) as { state: ConsentState }).state : null;
  } catch {
    return null;
  }
}

/** The viewer's own rating of a verdict (null when none, or on failure). */
export async function fetchRating(id: string): Promise<Rating | null> {
  try {
    const res = await fetch(`/api/v1/verdicts/${encodeURIComponent(id)}`, {
      credentials: "same-origin",
      cache: "no-store",
    });
    return res.ok ? (((await res.json()) as { rating?: Rating | null }).rating ?? null) : null;
  } catch {
    return null;
  }
}

/** PUT /api/v1/verdicts/{id}/rating. False when it was not saved. */
export async function saveRating(id: string, rating: Rating | null): Promise<boolean> {
  try {
    const res = await fetch(`/api/v1/verdicts/${encodeURIComponent(id)}/rating`, {
      method: "PUT",
      headers: JSON_HEADERS,
      credentials: "same-origin",
      body: JSON.stringify({ rating }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
