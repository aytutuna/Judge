import type { Lang } from "./i18n";

export type ConsentState = "not_asked" | "on" | "off";
export type Rating = "up" | "down";

const JSON_HEADERS = { "content-type": "application/json" };

/** Send the browser to sign in and back to this page. */
export function askSignIn(): void {
  window.location.href = `/signin?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
}

/** GET /api/v1/me/consent: the stored choice and whether the card should be shown now. Null on any failure. */
export async function fetchConsent(): Promise<{ state: ConsentState; ask: boolean } | null> {
  try {
    const res = await fetch("/api/v1/me/consent", { credentials: "same-origin", cache: "no-store" });
    return res.ok ? ((await res.json()) as { state: ConsentState; ask: boolean }) : null;
  } catch {
    return null;
  }
}

/** POST /api/v1/me/agreement. 401 when signed out. */
export async function saveAgreement(lang: Lang): Promise<"ok" | "signin" | "failed"> {
  try {
    const res = await fetch("/api/v1/me/agreement", {
      method: "POST",
      headers: JSON_HEADERS,
      credentials: "same-origin",
      body: JSON.stringify({ lang, platform: "web" }),
    });
    if (res.ok) return "ok";
    return res.status === 401 ? "signin" : "failed";
  } catch {
    return "failed";
  }
}

/** GET /api/v1/me/export, saved as a file. False when it could not be fetched. */
export async function downloadMyData(): Promise<boolean> {
  try {
    const res = await fetch("/api/v1/me/export", { credentials: "same-origin", cache: "no-store" });
    if (!res.ok) return false;
    const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "judge-data.json";
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}

/** POST /api/v1/me/consent. The new state, or null when it was not saved. */
export async function saveConsent(
  choice: "on" | "off",
  source: "card" | "switch",
  wordingKey: "consent.cardBody" | "consent.switchDetail",
  lang: Lang,
): Promise<ConsentState | null> {
  try {
    const res = await fetch("/api/v1/me/consent", {
      method: "POST",
      headers: JSON_HEADERS,
      credentials: "same-origin",
      body: JSON.stringify({ choice, source, wordingKey, lang, platform: "web" }),
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
