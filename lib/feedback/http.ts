/**
 * HTTP handlers for training consent and ratings:
 *   GET  /api/v1/me/consent             the account's current choice
 *   POST /api/v1/me/consent             record a choice (card answer or switch)
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
import { EN } from "@/lib/i18n";
import { getPublicVerdict } from "@/lib/originals/display";
import { ensureOriginalsTables } from "@/lib/originals/db";
import { checkUserLimits } from "@/lib/ratelimit";
import { getVerdictJob } from "@/lib/verdict-jobs";
import { getConsent, recordConsent, setRating } from "./db";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const ConsentRequest = z.strictObject({
  choice: z.enum(["on", "off"]),
  source: z.enum(["card", "switch"]),
  wordingKey: z.string().min(1).max(80),
  platform: z.enum(["ios", "android", "web"]),
});

const RatingRequest = z.strictObject({ rating: z.enum(["up", "down"]).nullable() });

const MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  invalid: "Invalid request",
  not_found: "No verdict with that id.",
  signin_required: "Sign in first.",
  bad_origin: "Cross-site request refused.",
  unavailable: "Try again in a minute.",
  removed: "This verdict was removed. Its link no longer works.",
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

/** GET /api/v1/me/consent -> { state: "not_asked" | "on" | "off", updatedAt, policyVersion } */
export function consentGetHandler(req: Request): Promise<NextResponse> {
  return guarded("consent read", async () => {
    const who = await signedIn(req, false);
    if ("response" in who) return who.response;
    return json(await getConsent(who.viewer.user.id));
  });
}

/** POST /api/v1/me/consent { choice, source, wordingKey, platform } -> the new state.
 * `wordingKey` is the key of the text the person saw (the card's question or
 * the switch's label); the ledger keeps its English text. */
export function consentPostHandler(req: Request): Promise<NextResponse> {
  return guarded("consent write", async () => {
    const who = await signedIn(req, true);
    if ("response" in who) return who.response;
    const parsed = ConsentRequest.safeParse(await readJson(req));
    if (!parsed.success || !Object.hasOwn(EN, parsed.data.wordingKey)) {
      return fail("invalid", 'Send { "choice": "on" | "off", "source": "card" | "switch", "wordingKey": <a string key>, "platform": "ios" | "android" | "web" }.');
    }
    const refused = await underLimit(who.viewer.user.id);
    if (refused) return refused;
    await ensureOriginalsTables();
    const { wordingKey } = parsed.data;
    const state = await recordConsent(who.viewer.user.id, {
      ...parsed.data,
      wordingText: EN[wordingKey as keyof typeof EN],
    });
    return json(state);
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
