/**
 * HTTP handlers for training consent and ratings:
 *   GET  /api/v1/me/consent             the account's current choice
 *   POST /api/v1/me/consent             record a choice (card answer or switch)
 *   POST /api/v1/me/agreement           the one-time sensitive-details agreement
 *   PUT  /api/v1/verdicts/{id}/rating   set, change or clear "Fair verdict?"
 *
 * All need a signed-in account (cookie or bearer); a signed-out request is
 * 401 signin_required, so the controls can look the same and ask for a
 * sign-in on tap. Cookie writes need the same origin. Every response is
 * `Cache-Control: no-store`. Server only.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { API_ERROR_STATUS, apiErrorBody, type ApiErrorCode } from "@/lib/api-errors";
import { isSameOrigin, type ViewerSession } from "@/lib/auth";
import { deadBearerResponse, lookupViewer } from "@/lib/bearer-guard";
import { loadLocale, t } from "@/lib/i18n";
import { isLang, type Lang } from "@/lib/langs";
import { getPublicVerdict } from "@/lib/originals/display";
import { ensureOriginalsTables } from "@/lib/originals/db";
import { checkUserLimits } from "@/lib/ratelimit";
import { getVerdictJob } from "@/lib/verdict-jobs";
import { recordSensitiveAgreement } from "./agreement";
import { consentStatus } from "./ask";
import { recordConsent, setRating } from "./db";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const ConsentRequest = z.strictObject({
  choice: z.enum(["on", "off"]),
  source: z.enum(["card", "switch"]),
  wordingKey: z.enum(["consent.cardBody", "consent.switchDetail"]),
  lang: z.string().refine(isLang),
  platform: z.enum(["ios", "android", "web"]),
});

const AgreementRequest = z.strictObject({
  lang: z.string().refine(isLang),
  platform: z.enum(["ios", "android", "web"]),
});

const RatingRequest = z.strictObject({
  rating: z.enum(["up", "down"]).nullable(),
});

const MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  invalid: "Invalid request",
  not_found: "No verdict with that id.",
  signin_required: "Sign in first.",
  bad_origin: "Cross-site request refused.",
  unavailable: "Try again in a minute.",
  removed: "This verdict was removed. Its link no longer works.",
  not_for_teens: "Not available for this account.",
};

function fail(code: ApiErrorCode, error?: string, retryAfterSec?: number): NextResponse {
  return NextResponse.json(apiErrorBody(code, error ?? MESSAGES[code] ?? code, retryAfterSec ? { retryAfterSec } : {}), {
    status: API_ERROR_STATUS[code],
    headers: retryAfterSec ? { ...NO_STORE, "Retry-After": String(retryAfterSec) } : NO_STORE,
  });
}

function json<T>(body: T): NextResponse {
  return NextResponse.json(body, { headers: NO_STORE });
}

function guarded(name: string, fn: () => Promise<NextResponse>): Promise<NextResponse> {
  return fn().catch((e: unknown) => {
    console.error(`[feedback] ${name} failed:`, e instanceof Error ? e.message : String(e));
    return fail("unavailable");
  });
}

async function readJson(req: Request): Promise<unknown> {
  try {
    return JSON.parse(await req.text());
  } catch {
    return undefined;
  }
}

/** The signed-in viewer, or the response to send instead. `write`: a cookie
 * session must come from this site. */
async function signedIn(req: Request, write: boolean): Promise<{ viewer: ViewerSession } | { response: NextResponse }> {
  const { viewer, deadBearer, refused } = await lookupViewer(req);
  if (deadBearer) return { response: deadBearerResponse() };
  if (refused) return { response: refused };
  if (!viewer) return { response: fail("signin_required") };
  if (write && viewer.via === "cookie" && !isSameOrigin(req)) return { response: fail("bad_origin") };
  return { viewer };
}

async function underLimit(userId: string): Promise<NextResponse | null> {
  const limit = await checkUserLimits(userId, "verdict_owner").catch(() => null);
  if (!limit) return fail("unavailable");
  if (limit.ok) return null;
  if (limit.code === "unavailable") return fail("unavailable");
  return fail("rate_limited", "Too many requests — take a breather and try again later.", limit.retryAfterSec);
}

/** GET /api/v1/me/consent -> { state: "not_asked" | "on" | "off", updatedAt, policyVersion, ask, sensitiveAgreed }.
 * `ask` is true only while state is not_asked and the account has at least
 * two finished verdicts and is not under 18: the only time a client shows the card.
 * `sensitiveAgreed`: the account has made the one-time agreement. */
export function consentGetHandler(req: Request): Promise<NextResponse> {
  return guarded("consent read", async () => {
    const who = await signedIn(req, false);
    if ("response" in who) return who.response;
    const status = await consentStatus(who.viewer.user.id);
    return json(who.viewer.age.teen ? { ...status, ask: false } : status);
  });
}

/** POST /api/v1/me/consent { choice, source, wordingKey, lang, platform } -> the new state (ask: false).
 * `wordingKey` is the key of the text the person saw (the card's body or the
 * switch's detail) and `lang` the language they saw it in; the ledger keeps
 * that text as it reads now. An account under 18 may switch it off, never on
 * (403 not_for_teens). */
export function consentPostHandler(req: Request): Promise<NextResponse> {
  return guarded("consent write", async () => {
    const who = await signedIn(req, true);
    if ("response" in who) return who.response;
    const parsed = ConsentRequest.safeParse(await readJson(req));
    if (!parsed.success) {
      return fail(
        "invalid",
        'Send { "choice": "on" | "off", "source": "card" | "switch", "wordingKey": "consent.cardBody" | "consent.switchDetail", "lang": <a language code>, "platform": "ios" | "android" | "web" }.',
      );
    }
    if (who.viewer.age.teen && parsed.data.choice === "on") return fail("not_for_teens");
    const refused = await underLimit(who.viewer.user.id);
    if (refused) return refused;
    await ensureOriginalsTables();
    const { wordingKey } = parsed.data;
    const lang = parsed.data.lang as Lang;
    await loadLocale(lang);
    const state = await recordConsent(who.viewer.user.id, {
      ...parsed.data,
      lang,
      wordingText: t(lang, wordingKey),
    });
    return json({ ...state, ask: false });
  });
}

/** POST /api/v1/me/agreement { lang, platform } -> { agreed: true, at }.
 * Records that the person ticked the private-details notice (shown in `lang`)
 * once for the account. Calling it again changes nothing. */
export function agreementPostHandler(req: Request): Promise<NextResponse> {
  return guarded("agreement", async () => {
    const who = await signedIn(req, true);
    if ("response" in who) return who.response;
    const parsed = AgreementRequest.safeParse(await readJson(req));
    if (!parsed.success) return fail("invalid", 'Send { "lang": <a language code>, "platform": "ios" | "android" | "web" }.');
    const refused = await underLimit(who.viewer.user.id);
    if (refused) return refused;
    const at = await recordSensitiveAgreement(who.viewer.user.id, parsed.data.lang as Lang, parsed.data.platform);
    return json({ agreed: true, at });
  });
}

/** PUT /api/v1/verdicts/{id}/rating { rating: "up" | "down" | null } -> { rating }.
 * null clears it. Any signed-in viewer of a shared verdict may rate it. */
export function ratingPutHandler(req: Request, id: string): Promise<NextResponse> {
  return guarded("rating", async () => {
    const who = await signedIn(req, true);
    if ("response" in who) return who.response;
    if (!ID_PATTERN.test(id)) return fail("not_found");
    const parsed = RatingRequest.safeParse(await readJson(req));
    if (!parsed.success) return fail("invalid", 'Send { "rating": "up" | "down" | null }.');
    const refused = await underLimit(who.viewer.user.id);
    if (refused) return refused;
    const job = await getVerdictJob(id);
    if (job && job.status !== "ready") return fail("not_found");
    const found = await getPublicVerdict(id);
    if (!found) return fail("not_found");
    if (found.removed) return fail("removed");
    await setRating(id, who.viewer.user.id, parsed.data.rating);
    return json({ rating: parsed.data.rating });
  });
}
