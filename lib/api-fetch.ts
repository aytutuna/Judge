import { SIDES_HEADER } from "@/lib/case-types";
import { TRIAL_HEADER } from "@/lib/trial-compat";

/** The most sides this client can show. */
const MAX_SIDES = 4;

/** fetch for the site's own API: tells the server this client can show a
 * case with up to four sides. */
export function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set(SIDES_HEADER, String(MAX_SIDES));
  headers.set(TRIAL_HEADER, "minor");
  return fetch(input, { ...init, headers });
}

let askAgreement: (() => Promise<boolean>) | null = null;

/** The agreement dialog (components/AgreementGate) registers itself here. */
export function setAgreementAsker(ask: (() => Promise<boolean>) | null): void {
  askAgreement = ask;
}

/** apiFetch for requests that start work on someone's text. When the server
 * asks for the one-time private-details agreement, the dialog is shown and
 * the request is sent again once it is ticked. */
export async function apiFetchAgreed(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const res = await apiFetch(input, init);
  if (res.status !== 403 || !askAgreement) return res;
  const body = (await res.clone().json().catch(() => null)) as { code?: string } | null;
  if (body?.code !== "agreement_required") return res;
  return (await askAgreement()) ? apiFetch(input, init) : res;
}
