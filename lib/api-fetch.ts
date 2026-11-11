import { SIDES_HEADER } from "@/lib/case-types";

/** The most sides this client can show. */
const MAX_SIDES = 4;

/** fetch for the site's own API: tells the server this client can show a
 * case with up to four sides. */
export function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set(SIDES_HEADER, String(MAX_SIDES));
  return fetch(input, { ...init, headers });
}
