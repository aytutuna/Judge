/**
 * HTTP handlers for /api/v1/cases* and /api/v1/respond/{token}*. The route
 * files only re-export these.
 *
 * Owner gate order (create, judge, appeal, invite, delete): kill switch ->
 * body -> session -> origin (cookie sessions) -> per-user limit -> Premium
 * switch and site cap where a unit is reserved (judge: after the lookup, for
 * premium cases only) -> case lookup (404 for missing or not yours) -> state
 * -> reserve. Every case holds one premium unit from its creation. The
 * respondent needs no account: the invite token is the
 * credential, checked by format before any database read; submits pass
 * Turnstile (when configured; skipped for bearer sessions) and per-IP limits.
 * Side B is bound to its author when it is submitted: the signed-in account,
 * or for a signed-out answer a claim secret returned in that response (sent
 * back as `claim` on an appeal, and as the Respondent-Claim header on GET so
 * the view can say whether this person may add context).
 * Each party's own originals, name map and display name are readable and
 * editable only by that party: the owner by session, Party B by the bound
 * account or the claim secret (Respondent-Claim header or `claim`).
 * Removal (DELETE /cases/{id}, POST .../removal) blanks that party's
 * personal data and closes every link of the case; no row is deleted.
 * Every response is `Cache-Control: no-store`. The request helpers are
 * shared with one-sided verdict appeals (lib/verdict-appeals).
 */

import { NextResponse } from "next/server";
import type { Entitlement, PremiumBlock } from "@/lib/account-types";
import { API_ERROR_STATUS, apiErrorBody, type ApiErrorBody, type ApiErrorCode } from "@/lib/api-errors";
import { getViewer, isSameOrigin, premiumEnabled, resolveViewer, type ViewerSession } from "@/lib/auth";
import { deadBearerResponse } from "@/lib/bearer-guard";
import {
  AppealRequest,
  CreateCaseRequest,
  JudgeNowRequest,
  MAX_EVIDENCE_PER_APPEAL,
  MAX_EVIDENCE_PER_SIDE,
  RespondRequest,
  type AppealBlock,
  type AppealResponse,
  type CaseListResponse,
  type CaseRemovalResponse,
  type CaseResponse,
  type CaseView,
  type CreateCaseResponse,
  type DeleteCaseResponse,
  type InviteResponse,
  type PartyLetter,
  type RespondResponse,
} from "@/lib/case-types";
import { clientIp } from "@/lib/client-ip";
import { entitlementWriteBatch, getEntitlement } from "@/lib/entitlements";
import { handleEvidenceUpload, verifyEvidenceTokens, type EvidenceAudience, type VerifiedEvidence } from "@/lib/evidence";
import { casesEnabled, evidenceEnabled } from "@/lib/features";
import { originalsKeyState } from "@/lib/originals/crypto";
import { caseDisplayNames, partyOriginals } from "@/lib/originals/cases";
import { removeCaseSide } from "@/lib/originals/removal";
import { sealCaseDisplay } from "@/lib/originals/save";
import {
  CaseDisplayPatch,
  RemovalRequest,
  type CaseOriginalsResponse,
  type OriginalStatus,
} from "@/lib/originals-types";
import { idempotencyKey } from "@/lib/premium/context";
import {
  checkIpLimits,
  checkPremiumSiteCap,
  checkUserLimits,
  type LimitDecision,
  type UserBucket,
} from "@/lib/ratelimit";
import { verifyTurnstile } from "@/lib/turnstile";
import { caseDb, getCase, getCaseByInviteHash, listOwnerCases, loadCaseBundle, type CaseRow } from "./db";
import { claimMatches, inviteHash, inviteUrl, isInviteToken, publicOrigin } from "./invite";
import {
  claimFor,
  createCase,
  currentInviteToken,
  judgeNow,
  respondToCase,
  rotateInvite,
  submitAppeal,
} from "./service";
import { effectiveStatus, materializeExpiry, maybeSweepCases } from "./sweep";
import { buildCaseView, caseSummary, structuralAppealBlock } from "./view";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const CASE_ID = /^[A-Za-z0-9_-]{12}$/;
const UNAVAILABLE_MESSAGE = "Cases are unavailable right now — try again in a minute.";

const MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  invalid: "Invalid request",
  signin_required: "Sign in first.",
  premium_required: "Verdicts need credits or a monthly plan.",
  no_credits: "You have no verdicts left.",
  fair_use: "You have used this month's verdicts.",
  bad_origin: "This request came from another site.",
  not_found: "No case with that id.",
  not_configured: "Two-sided cases are not available on this server right now.",
  unavailable: UNAVAILABLE_MESSAGE,
  case_closed: "This case is not taking that anymore.",
  case_expired: "This invite has expired.",
  appeal_used: "This party already added context to this case.",
  not_party: "Only the people in this case can do that.",
  own_case: "This is your own invite: send it to the other person.",
  in_progress: "Something in this case is still being judged.",
  evidence_invalid: "An evidence image expired or could not be verified. Add it again.",
  too_many_files: "Too many images.",
  captcha_failed: "Bot check failed — reload the page and try again.",
  anonymize_failed: "We couldn't take the names out of your text. Try again, or write initials instead of full names.",
  removed: "This case was removed. Its links no longer work.",
  names_unavailable: "Names can't be saved on this server right now.",
};

export function fail(
  code: ApiErrorCode,
  error?: string,
  opts: { retryAfterSec?: number; resetsAt?: string } = {},
): NextResponse {
  const extra: Omit<ApiErrorBody, "code" | "error"> = {};
  if (opts.retryAfterSec !== undefined) extra.retryAfterSec = opts.retryAfterSec;
  if (opts.resetsAt !== undefined) extra.resetsAt = opts.resetsAt;
  return NextResponse.json(apiErrorBody(code, error ?? MESSAGES[code] ?? code, extra), {
    status: API_ERROR_STATUS[code],
    headers: opts.retryAfterSec !== undefined ? { ...NO_STORE, "Retry-After": String(opts.retryAfterSec) } : NO_STORE,
  });
}

export function json<T>(body: T, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export function blocked(code: PremiumBlock, resetsAt?: string): NextResponse {
  return fail(code, undefined, resetsAt ? { resetsAt } : {});
}

export async function readJson(req: Request, allowEmpty = false): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    const raw = await req.text();
    if (!raw.trim()) return allowEmpty ? { ok: true, body: {} } : { ok: false };
    return { ok: true, body: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false };
  }
}

/** A zod issue mapped like the verdict route: text length -> too_short /
 * too_long, too many evidence tokens -> too_many_files, else invalid. */
export function invalidBody(issue: { message?: string; path: PropertyKey[]; code: string } | undefined): NextResponse {
  const field = issue?.path[0];
  let code: ApiErrorCode = "invalid";
  if (field === "text" && issue?.code === "too_small") code = "too_short";
  else if (field === "text" && issue?.code === "too_big") code = "too_long";
  else if (field === "evidence" && issue?.code === "too_big" && issue.path.length === 1) code = "too_many_files";
  return fail(code, issue?.message ?? "Invalid request");
}

function limitRefusal(decision: Exclude<LimitDecision, { ok: true }>): NextResponse {
  if (decision.code === "unavailable") return fail("unavailable");
  return decision.code === "daily_cap"
    ? fail("daily_cap", "Judging has reached today's capacity — try again tomorrow.", { retryAfterSec: decision.retryAfterSec })
    : fail("rate_limited", "Too many requests — take a breather and try again later.", {
        retryAfterSec: decision.retryAfterSec,
      });
}

/** Per-user limit, then (when a unit may be reserved) the site-wide cap. */
export async function limitGate(userId: string, bucket: UserBucket, siteCap: boolean): Promise<NextResponse | null> {
  try {
    const user = await checkUserLimits(userId, bucket);
    if (!user.ok) return limitRefusal(user);
  } catch (e) {
    console.error("[cases] limit check failed:", e instanceof Error ? e.message : String(e));
    return fail("unavailable");
  }
  return siteCap ? premiumGate(userId) : null;
}

const PREMIUM_OFF = "Verdicts are not available on this server right now.";

/** What a premium run needs on top of the per-user limit: Premium switched
 * on, and the site-wide cap. */
async function premiumGate(userId: string): Promise<NextResponse | null> {
  if (!premiumEnabled()) return fail("not_configured", PREMIUM_OFF);
  try {
    const site = await checkPremiumSiteCap(userId);
    return site.ok ? null : limitRefusal(site);
  } catch (e) {
    console.error("[cases] limit check failed:", e instanceof Error ? e.message : String(e));
    return fail("unavailable");
  }
}

type Signed = { viewer: ViewerSession } | { response: NextResponse };

export async function signedIn(req: Request): Promise<Signed> {
  const viewer = await getViewer(req);
  if (!viewer) return { response: fail("signin_required") };
  if (viewer.via === "cookie" && !isSameOrigin(req)) return { response: fail("bad_origin") };
  return { viewer };
}

export function verifyEvidence(
  tokens: string[] | undefined,
  audiences: EvidenceAudience[],
  max: number,
): { ok: true; items: VerifiedEvidence[] } | { response: NextResponse } {
  if (!tokens || tokens.length === 0) return { ok: true, items: [] };
  if (!evidenceEnabled()) return { response: fail("evidence_invalid", "Screenshot evidence is not available right now.") };
  if (tokens.length > max) return { response: fail("too_many_files", `Attach at most ${max} images.`) };
  let last: "evidence_invalid" | "too_many_files" = "evidence_invalid";
  for (const audience of audiences) {
    const res = verifyEvidenceTokens(tokens, audience, max);
    if (res.ok) return { ok: true, items: res.items };
    last = res.code;
  }
  return { response: fail(last) };
}

export async function entitlementOrNull(userId: string): Promise<Entitlement | null> {
  try {
    return await getEntitlement(userId);
  } catch (e) {
    console.error("[cases] entitlement read failed:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

/** Why this viewer cannot appeal as `party` right now (null = allowed).
 * `claimOk`: the request carries side B's claim secret. */
async function appealBlockFor(
  row: CaseRow,
  bundle: Awaited<ReturnType<typeof loadCaseBundle>>,
  party: PartyLetter,
  viewerId: string | null,
  now: Date,
  claimOk = false,
): Promise<AppealBlock | null> {
  const structural = structuralAppealBlock(bundle, party, viewerId, now, claimOk);
  if (structural || !viewerId) return structural;
  return premiumAppealBlock(viewerId);
}

/** Whether this account can spend a premium unit on an appeal (null = yes). */
export async function premiumAppealBlock(userId: string): Promise<AppealBlock | null> {
  if (!premiumEnabled()) return "premium_required";
  const ent = await entitlementOrNull(userId);
  if (!ent) return "premium_required";
  return ent.canUsePremium ? null : (ent.blockedReason ?? "premium_required");
}

/** The raw string a JSON body carried for `field` (before zod trims it). */
export function rawField(body: unknown, field: string): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const v = (body as Record<string, unknown>)[field];
  return typeof v === "string" ? v : undefined;
}

/** The decrypted parts of a view for a proven party (names only then). */
async function viewOriginals(row: CaseRow, party: PartyLetter, proven: boolean) {
  const display = caseDisplayNames(row, party, proven);
  if (!proven) return { names: null, display, yourOriginal: "not_stored" as OriginalStatus };
  try {
    const own = await partyOriginals(row, party);
    return { names: own.names, display, yourOriginal: own.side.status };
  } catch (e) {
    console.error("[cases] originals read failed:", e instanceof Error ? e.message : String(e));
    return { names: null, display, yourOriginal: "unreadable" as OriginalStatus };
  }
}

async function ownerView(row: CaseRow, req: Request, viewerId: string, now = new Date()): Promise<CaseView> {
  const bundle = await loadCaseBundle(row);
  const token =
    effectiveStatus(row, now) === "awaiting_respondent" && !row.removedAt ? await currentInviteToken(row) : null;
  return buildCaseView(bundle, {
    role: "owner",
    now,
    inviteUrl: token ? inviteUrl(publicOrigin(req), token) : null,
    ownInvite: false,
    appealBlock: await appealBlockFor(row, bundle, "a", viewerId, now),
    originals: await viewOriginals(row, "a", true),
  });
}

/** Whether this request proves it comes from Party B: the account bound to
 * side B, or the claim secret from answering. Never the owner. */
function provenRespondent(row: CaseRow, viewerId: string | null, claim: string | null): boolean {
  if (row.mode !== "two_sided" || (viewerId !== null && viewerId === row.ownerId)) return false;
  if (row.respondentUserId && viewerId === row.respondentUserId) return true;
  return claimMatches(row, claim);
}

async function respondentView(
  row: CaseRow,
  viewerId: string | null,
  claim: string | null = null,
  now = new Date(),
): Promise<CaseView> {
  const bundle = await loadCaseBundle(row);
  return buildCaseView(bundle, {
    role: "respondent",
    now,
    inviteUrl: null,
    ownInvite: viewerId !== null && viewerId === row.ownerId,
    appealBlock: await appealBlockFor(row, bundle, "b", viewerId, now, claimMatches(row, claim)),
    originals: await viewOriginals(row, "b", provenRespondent(row, viewerId, claim)),
  });
}

/** The respondent claim secret a GET carries, if any. */
function claimHeader(req: Request): string | null {
  const v = req.headers.get("respondent-claim");
  return v && v.length <= 64 ? v.trim() : null;
}

/** The owner's case, or null for a bad id, a missing case or someone else's. */
async function ownedCase(id: string, viewerId: string): Promise<CaseRow | null> {
  if (!CASE_ID.test(id)) return null;
  const row = await getCase(id);
  return row && row.ownerId === viewerId ? row : null;
}

async function caseByToken(token: string): Promise<CaseRow | null> {
  if (!isInviteToken(token)) return null;
  return getCaseByInviteHash(inviteHash(token));
}

export function guarded(name: string, fn: () => Promise<NextResponse>): Promise<NextResponse> {
  return fn().catch((e: unknown) => {
    console.error(`[cases] ${name} failed:`, e instanceof Error ? e.message : String(e));
    return fail("unavailable");
  });
}

// --- Owner ------------------------------------------------------------------------

/** POST /api/v1/cases */
export function createCaseHandler(req: Request): Promise<NextResponse> {
  return guarded("create", async () => {
    if (!casesEnabled()) return fail("not_configured");
    const key = idempotencyKey(req.headers);
    if (key === null) return fail("invalid", "Idempotency-Key must be 1 to 64 letters, digits, '_' or '-'.");
    const read = await readJson(req);
    if (!read.ok) return fail("invalid", "Invalid JSON body");
    const parsed = CreateCaseRequest.safeParse(read.body);
    if (!parsed.success) return invalidBody(parsed.error.issues[0]);
    const gate = await signedIn(req);
    if ("response" in gate) return gate.response;
    const userId = gate.viewer.user.id;
    const limited = await limitGate(userId, "case_create", true);
    if (limited) return limited;
    await maybeSweepCases();

    const ev = verifyEvidence(parsed.data.evidence, [{ type: "user", userId }], MAX_EVIDENCE_PER_SIDE);
    if ("response" in ev) return ev.response;

    const res = await createCase({
      ownerId: userId,
      text: parsed.data.text,
      rawText: rawField(read.body, "text") ?? parsed.data.text,
      displayName: parsed.data.displayName || null,
      lang: parsed.data.lang,
      evidence: ev.items,
      ...(key ? { idempotencyKey: key } : {}),
    });
    if (!res.ok) {
      if (res.code === "unavailable" || res.code === "anonymize_failed") return fail(res.code);
      if (res.code === "in_progress") return fail("in_progress", "This case is already being created.");
      return blocked(res.code, "resetsAt" in res ? res.resetsAt : undefined);
    }
    const entitlement = await entitlementOrNull(userId);
    const body: CreateCaseResponse = {
      case: await ownerView(res.row, req, userId),
      name_map: res.nameMap,
      ...(entitlement ? { entitlement } : {}),
      ...(res.replayed ? { replayed: true } : {}),
    };
    return json(body, res.replayed ? 200 : 201);
  });
}

/** GET /api/v1/cases?limit=20&before=<ISO createdAt> */
export function listCasesHandler(req: Request): Promise<NextResponse> {
  return guarded("list", async () => {
    if (!casesEnabled()) return fail("not_configured");
    const viewer = await getViewer(req);
    if (!viewer) return fail("signin_required");
    const params = new URL(req.url).searchParams;
    const rawLimit = params.get("limit");
    const limit = rawLimit === null ? 20 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) return fail("invalid", "limit must be 1 to 50");
    const rawBefore = params.get("before");
    let before: string | null = null;
    if (rawBefore !== null) {
      const d = new Date(rawBefore);
      if (Number.isNaN(d.getTime())) return fail("invalid", "before must be an ISO date");
      before = d.toISOString();
    }
    await maybeSweepCases();
    const rows = await listOwnerCases(viewer.user.id, limit + 1, before);
    const now = new Date();
    const page = rows.slice(0, limit);
    const body: CaseListResponse = {
      cases: page.map((r) => caseSummary(r, now)),
      next: rows.length > limit ? page[page.length - 1].createdAt : null,
    };
    return json(body);
  });
}

/** GET /api/v1/cases/{id} */
export function getCaseHandler(req: Request, id: string): Promise<NextResponse> {
  return guarded("get", async () => {
    if (!casesEnabled()) return fail("not_configured");
    const viewer = await getViewer(req);
    if (!viewer) return fail("signin_required");
    await maybeSweepCases();
    const row = await ownedCase(id, viewer.user.id);
    if (!row) return fail("not_found");
    const body: CaseResponse = { case: await ownerView(row, req, viewer.user.id) };
    return json(body);
  });
}

/** DELETE /api/v1/cases/{id}: kept for older clients. Runs the owner's
 * removal of their side (nothing is deleted). */
export function deleteCaseHandler(req: Request, id: string): Promise<NextResponse> {
  return guarded("delete", async () => {
    if (!casesEnabled()) return fail("not_configured");
    const gate = await signedIn(req);
    if ("response" in gate) return gate.response;
    const row = await ownedCase(id, gate.viewer.user.id);
    if (!row) return fail("not_found");
    const res = await removeCaseSide(row, "a", "party_a");
    if (!res.ok) return res.code === "not_found" ? fail("not_found") : fail("in_progress", "Wait for the judges to finish first.");
    const body: DeleteCaseResponse = { deleted: true, removed: true, removedAt: res.removedAt };
    return json(body);
  });
}

/** POST /api/v1/cases/{id}/judge { "mode": "only_mine" } */
export function judgeCaseHandler(req: Request, id: string): Promise<NextResponse> {
  return guarded("judge", async () => {
    if (!casesEnabled()) return fail("not_configured");
    const read = await readJson(req, true);
    if (!read.ok) return fail("invalid", "Invalid JSON body");
    const parsed = JudgeNowRequest.safeParse(read.body);
    if (!parsed.success) return invalidBody(parsed.error.issues[0]);
    const gate = await signedIn(req);
    if ("response" in gate) return gate.response;
    const userId = gate.viewer.user.id;
    const limited = await limitGate(userId, "premium_verdict", true);
    if (limited) return limited;
    await maybeSweepCases();
    const row = await ownedCase(id, userId);
    if (!row) return fail("not_found");
    const res = await judgeNow({ row, mode: parsed.data.mode, origin: publicOrigin(req) });
    if (!res.ok) {
      if (res.code === "invalid") return fail("invalid", 'Send { "mode": "only_mine" } to judge without the other side.');
      if (res.code === "case_closed" || res.code === "unavailable" || res.code === "removed") return fail(res.code);
      return blocked(res.code, "resetsAt" in res ? res.resetsAt : undefined);
    }
    const body: CaseResponse = { case: await ownerView(res.row, req, userId) };
    return json(body, res.started ? 202 : 200);
  });
}

/** POST /api/v1/cases/{id}/invite: a new link (the old one stops working). */
export function rotateInviteHandler(req: Request, id: string): Promise<NextResponse> {
  return guarded("invite", async () => {
    if (!casesEnabled()) return fail("not_configured");
    const gate = await signedIn(req);
    if ("response" in gate) return gate.response;
    const limited = await limitGate(gate.viewer.user.id, "case_create", false);
    if (limited) return limited;
    const row = await ownedCase(id, gate.viewer.user.id);
    if (!row) return fail("not_found");
    const res = await rotateInvite(row);
    if (!res.ok) return fail(res.code);
    const body: InviteResponse = { inviteUrl: inviteUrl(publicOrigin(req), res.token) };
    return json(body);
  });
}

async function appealCommon(
  req: Request,
  load: (userId: string) => Promise<{ row: CaseRow } | { response: NextResponse }>,
  party: PartyLetter,
  audiences: (userId: string, row: CaseRow) => EvidenceAudience[],
  view: (row: CaseRow, userId: string, claim: string | null) => Promise<CaseView>,
): Promise<NextResponse> {
  if (!casesEnabled()) return fail("not_configured");
  const key = idempotencyKey(req.headers);
  if (key === null) return fail("invalid", "Idempotency-Key must be 1 to 64 letters, digits, '_' or '-'.");
  const read = await readJson(req);
  if (!read.ok) return fail("invalid", "Invalid JSON body");
  const parsed = AppealRequest.safeParse(read.body);
  if (!parsed.success) return invalidBody(parsed.error.issues[0]);
  const gate = await signedIn(req);
  if ("response" in gate) return gate.response;
  const userId = gate.viewer.user.id;
  const limited = await limitGate(userId, "premium_verdict", true);
  if (limited) return limited;
  await maybeSweepCases();
  const loaded = await load(userId);
  if ("response" in loaded) return loaded.response;
  const { row } = loaded;

  const ev = verifyEvidence(parsed.data.evidence, audiences(userId, row), MAX_EVIDENCE_PER_APPEAL);
  if ("response" in ev) return ev.response;
  const res = await submitAppeal({
    row,
    party,
    userId,
    text: parsed.data.text,
    rawText: rawField(read.body, "text") ?? parsed.data.text,
    evidence: ev.items,
    ...(party === "b" && parsed.data.claim ? { claim: parsed.data.claim } : {}),
    ...(key ? { idempotencyKey: key } : {}),
  });
  if (!res.ok) {
    switch (res.code) {
      case "premium_required":
      case "no_credits":
      case "fair_use":
        return blocked(res.code, "resetsAt" in res ? res.resetsAt : undefined);
      case "in_progress":
        return fail("in_progress", "The judges are already re-judging this case.");
      default:
        return fail(res.code);
    }
  }
  const entitlement = await entitlementOrNull(userId);
  const body: AppealResponse = {
    case: await view(res.row, userId, parsed.data.claim ?? null),
    name_map: res.nameMap,
    ...(entitlement ? { entitlement } : {}),
    ...(res.replayed ? { replayed: true } : {}),
  };
  return json(body, 202);
}

/** POST /api/v1/cases/{id}/appeals: the owner adds context (Party A). */
export function ownerAppealHandler(req: Request, id: string): Promise<NextResponse> {
  return guarded("appeal", () =>
    appealCommon(
      req,
      async (userId) => {
        const row = await ownedCase(id, userId);
        return row ? { row } : { response: fail("not_found") };
      },
      "a",
      (userId) => [{ type: "user", userId }],
      (row, userId) => ownerView(row, req, userId),
    ),
  );
}

// --- Respondent ---------------------------------------------------------------------

/** GET /api/v1/respond/{token} */
export function respondGetHandler(req: Request, token: string): Promise<NextResponse> {
  return guarded("respond get", async () => {
    if (!casesEnabled()) return fail("not_configured");
    if (!isInviteToken(token)) return fail("not_found", "No invite with that link.");
    await maybeSweepCases();
    const row = await caseByToken(token);
    if (!row) return fail("not_found", "No invite with that link.");
    const { viewer, deadBearer } = await resolveViewer(req);
    if (deadBearer) return deadBearerResponse();
    const body: CaseResponse = { case: await respondentView(row, viewer?.user.id ?? null, claimHeader(req)) };
    return json(body);
  });
}

/** POST /api/v1/respond/{token}: the other person's side. */
export function respondPostHandler(req: Request, token: string): Promise<NextResponse> {
  return guarded("respond", async () => {
    if (!casesEnabled()) return fail("not_configured");
    const key = idempotencyKey(req.headers);
    if (key === null) return fail("invalid", "Idempotency-Key must be 1 to 64 letters, digits, '_' or '-'.");
    const read = await readJson(req);
    if (!read.ok) return fail("invalid", "Invalid JSON body");
    const parsed = RespondRequest.safeParse(read.body);
    if (!parsed.success) return invalidBody(parsed.error.issues[0]);
    if (!isInviteToken(token)) return fail("not_found", "No invite with that link.");
    const row = await caseByToken(token);
    if (!row) return fail("not_found", "No invite with that link.");
    if (row.removedAt) return fail("removed");

    const { viewer, deadBearer } = await resolveViewer(req);
    if (deadBearer) return deadBearerResponse();
    const ip = clientIp(req.headers);
    if (viewer?.via !== "bearer") {
      const captcha = await verifyTurnstile(parsed.data.turnstileToken, ip);
      if (captcha === "invalid") return fail("captcha_failed");
      if (captcha === "error") return fail("unavailable");
    }
    let limit: LimitDecision;
    try {
      limit = await checkIpLimits(ip, "respond_submit");
    } catch {
      return fail("unavailable");
    }
    if (!limit.ok) return limitRefusal(limit);
    if (viewer && viewer.user.id === row.ownerId) return fail("own_case");

    const now = new Date();
    const status = effectiveStatus(row, now);
    if (status === "expired") {
      await materializeExpiry(row, now).catch(() => undefined);
      return fail("case_expired");
    }
    if (status !== "awaiting_respondent") {
      if (key && row.respondentIdem === key) {
        const claim = claimFor(row);
        const body: RespondResponse = {
          case: await respondentView(row, viewer?.user.id ?? null, claim),
          name_map: [],
          ...(claim ? { respondent_claim: claim } : {}),
          replayed: true,
        };
        return json(body, 202);
      }
      return fail("case_closed");
    }

    const ev = verifyEvidence(parsed.data.evidence, [{ type: "respondent", caseId: row.id }], MAX_EVIDENCE_PER_SIDE);
    if ("response" in ev) return ev.response;

    const res = await respondToCase({
      row,
      userId: viewer?.user.id ?? null,
      text: parsed.data.text,
      rawText: rawField(read.body, "text") ?? parsed.data.text,
      displayName: parsed.data.displayName || null,
      evidence: ev.items,
      ...(key ? { idempotencyKey: key } : {}),
      origin: publicOrigin(req),
      now,
    });
    if (!res.ok) return fail(res.code);
    const body: RespondResponse = {
      case: await respondentView(res.row, viewer?.user.id ?? null, res.claim),
      name_map: res.nameMap,
      ...(res.claim ? { respondent_claim: res.claim } : {}),
      ...(res.replayed ? { replayed: true } : {}),
    };
    return json(body, 202);
  });
}

/** POST /api/v1/respond/{token}/appeals: a signed-in Premium respondent
 * (Party B): the account bound to side B, or one presenting its claim. */
export function respondAppealHandler(req: Request, token: string): Promise<NextResponse> {
  return guarded("respond appeal", () =>
    appealCommon(
      req,
      async (userId) => {
        const row = await caseByToken(token);
        if (!row) return { response: fail("not_found", "No invite with that link.") };
        if (userId === row.ownerId) return { response: fail("not_party") };
        if (row.mode === "one_sided") return { response: fail("not_party") };
        if (row.respondentUserId && row.respondentUserId !== userId) return { response: fail("not_party") };
        // Unbound: submitAppeal checks the claim secret.
        return { row };
      },
      "b",
      (userId, row) => [
        { type: "user", userId },
        { type: "respondent", caseId: row.id },
      ],
      (row, userId, claim) => respondentView(row, userId, claim),
    ),
  );
}

/** POST /api/v1/respond/{token}/evidence: the respondent's screenshots. */
export function respondEvidenceHandler(req: Request, token: string): Promise<NextResponse | Response> {
  return guarded("respond evidence", async () => {
    if (!casesEnabled() || !evidenceEnabled()) return fail("not_configured", "Screenshot evidence is not available right now.");
    if (!isInviteToken(token)) return fail("not_found", "No invite with that link.");
    const row = await caseByToken(token);
    if (!row) return fail("not_found", "No invite with that link.");
    const status = effectiveStatus(row, new Date());
    if (status === "expired") return fail("case_expired");
    if (status !== "awaiting_respondent") return fail("case_closed");
    const ip = clientIp(req.headers);
    try {
      const byIp = await checkIpLimits(ip, "respond_evidence");
      if (!byIp.ok) return limitRefusal(byIp);
      const byCase = await checkUserLimits(`case:${row.id}:b`, "case_evidence");
      if (!byCase.ok) return limitRefusal(byCase);
    } catch {
      return fail("unavailable");
    }
    const res = await handleEvidenceUpload(req, { type: "respondent", caseId: row.id });
    res.headers.set("Cache-Control", "no-store");
    return res as NextResponse;
  });
}

// --- Originals, display names, removal --------------------------------------------

/** Per-account limit for a session, else per-IP (claim holders). */
async function ownerLimit(viewerId: string | null, req: Request): Promise<NextResponse | null> {
  try {
    const decision = viewerId
      ? await checkUserLimits(viewerId, "verdict_owner")
      : await checkIpLimits(clientIp(req.headers), "verdict_owner");
    return decision.ok ? null : limitRefusal(decision);
  } catch {
    return fail("unavailable");
  }
}

type Party = { row: CaseRow; viewer: ViewerSession | null } | { response: NextResponse };

/** The owner of case `id` (session). Writes need the same origin for cookies. */
async function ownerParty(req: Request, id: string, write: boolean): Promise<Party> {
  if (!casesEnabled()) return { response: fail("not_configured") };
  const viewer = await getViewer(req);
  if (!viewer) return { response: fail("signin_required") };
  if (write && viewer.via === "cookie" && !isSameOrigin(req)) return { response: fail("bad_origin") };
  const limited = await ownerLimit(viewer.user.id, req);
  if (limited) return { response: limited };
  const row = await ownedCase(id, viewer.user.id);
  return row ? { row, viewer } : { response: fail("not_found") };
}

/** Party B of the case behind invite `token`: the bound account, or the
 * claim secret (header, or `claim` in a write body). */
async function respondentParty(req: Request, token: string, write: boolean, bodyClaim?: string): Promise<Party> {
  if (!casesEnabled()) return { response: fail("not_configured") };
  if (!isInviteToken(token)) return { response: fail("not_found", "No invite with that link.") };
  const { viewer, deadBearer } = await resolveViewer(req);
  if (deadBearer) return { response: deadBearerResponse() };
  if (write && viewer?.via === "cookie" && !isSameOrigin(req)) return { response: fail("bad_origin") };
  const limited = await ownerLimit(viewer?.user.id ?? null, req);
  if (limited) return { response: limited };
  const row = await caseByToken(token);
  if (!row) return { response: fail("not_found", "No invite with that link.") };
  if (row.mode !== "two_sided") return { response: fail("case_closed") };
  const claim = bodyClaim ?? claimHeader(req);
  if (!provenRespondent(row, viewer?.user.id ?? null, claim)) return { response: fail("not_party") };
  return { row, viewer };
}

async function originalsBody(row: CaseRow, party: PartyLetter): Promise<CaseOriginalsResponse> {
  const own = await partyOriginals(row, party);
  return { party, side: own.side, appeal: own.appeal };
}

/** GET /api/v1/cases/{id}/originals: the owner's side and appeal as written. */
export function caseOriginalsHandler(req: Request, id: string): Promise<NextResponse> {
  return guarded("originals", async () => {
    const p = await ownerParty(req, id, false);
    if ("response" in p) return p.response;
    return json(await originalsBody(p.row, "a"));
  });
}

/** GET /api/v1/respond/{token}/originals: Party B's side and appeal as written. */
export function respondOriginalsHandler(req: Request, token: string): Promise<NextResponse> {
  return guarded("respond originals", async () => {
    const p = await respondentParty(req, token, false);
    if ("response" in p) return p.response;
    return json(await originalsBody(p.row, "b"));
  });
}

/** One party's display name and (owner only) the names switch. */
async function updateCaseDisplay(
  row: CaseRow,
  party: PartyLetter,
  patchBody: { namesVisible?: boolean; displayName?: string | null },
): Promise<NextResponse | null> {
  if (row.removedAt) return fail("removed");
  const sets: string[] = [];
  const args: (string | number | null)[] = [];
  if (patchBody.displayName !== undefined) {
    let sealed: { sealed: string; kid: string } | null = null;
    if (patchBody.displayName) {
      if (!originalsKeyState().ok) return fail("names_unavailable");
      sealed = sealCaseDisplay(row.id, party, patchBody.displayName);
      if (!sealed) return fail("names_unavailable");
    }
    sets.push(`display_${party}_sealed = ?`, "display_key_id = COALESCE(?, display_key_id)");
    args.push(sealed?.sealed ?? null, sealed?.kid ?? null);
  }
  if (patchBody.namesVisible !== undefined) {
    sets.push("names_visible = ?");
    args.push(patchBody.namesVisible ? 1 : 0);
  }
  if (sets.length === 0) return null;
  await caseDb();
  const rs = await entitlementWriteBatch([
    {
      sql: `UPDATE cases SET ${sets.join(", ")}, updated_at = ? WHERE id = ? AND removed_at IS NULL`,
      args: [...args, new Date().toISOString(), row.id],
    },
  ]);
  return rs[0].rowsAffected === 1 ? null : fail("removed");
}

/** PATCH /api/v1/cases/{id}/display { namesVisible?, displayName? } */
export function caseDisplayHandler(req: Request, id: string): Promise<NextResponse> {
  return guarded("display", async () => {
    const read = await readJson(req);
    if (!read.ok) return fail("invalid", "Invalid JSON body");
    const parsed = CaseDisplayPatch.safeParse(read.body);
    if (!parsed.success) return fail("invalid", parsed.error.issues[0]?.message ?? "Invalid request");
    const p = await ownerParty(req, id, true);
    if ("response" in p) return p.response;
    const refused = await updateCaseDisplay(p.row, "a", parsed.data);
    if (refused) return refused;
    const fresh = (await getCase(p.row.id)) ?? p.row;
    const body: CaseResponse = { case: await ownerView(fresh, req, p.viewer!.user.id) };
    return json(body);
  });
}

/** PATCH /api/v1/respond/{token}/display { displayName?, claim? } */
export function respondDisplayHandler(req: Request, token: string): Promise<NextResponse> {
  return guarded("respond display", async () => {
    const read = await readJson(req);
    if (!read.ok) return fail("invalid", "Invalid JSON body");
    const parsed = CaseDisplayPatch.safeParse(read.body);
    if (!parsed.success) return fail("invalid", parsed.error.issues[0]?.message ?? "Invalid request");
    if (parsed.data.namesVisible !== undefined) return fail("not_party", "Only the person who started the case can switch names off.");
    const p = await respondentParty(req, token, true, parsed.data.claim);
    if ("response" in p) return p.response;
    const refused = await updateCaseDisplay(p.row, "b", { displayName: parsed.data.displayName });
    if (refused) return refused;
    const fresh = (await getCase(p.row.id)) ?? p.row;
    const claim = parsed.data.claim ?? claimHeader(req);
    const body: CaseResponse = { case: await respondentView(fresh, p.viewer?.user.id ?? null, claim) };
    return json(body);
  });
}

async function removal(
  req: Request,
  load: (body: { claim?: string }) => Promise<Party>,
  party: PartyLetter,
  view: (row: CaseRow, viewerId: string | null, claim: string | null) => Promise<CaseView>,
): Promise<NextResponse> {
  const read = await readJson(req);
  if (!read.ok) return fail("invalid", "Invalid JSON body");
  const parsed = RemovalRequest.safeParse(read.body);
  if (!parsed.success) return fail("invalid", 'Send { "confirm": "remove" } to remove it.');
  const p = await load(parsed.data);
  if ("response" in p) return p.response;
  const res = await removeCaseSide(p.row, party, party === "a" ? "party_a" : "party_b");
  if (!res.ok) return res.code === "not_found" ? fail("not_found") : fail("in_progress", "Wait for the judges to finish first.");
  const body: CaseRemovalResponse = {
    removed: true,
    removedAt: res.removedAt,
    case: await view(res.row, p.viewer?.user.id ?? null, parsed.data.claim ?? claimHeader(req)),
  };
  return json(body);
}

/** POST /api/v1/cases/{id}/removal { confirm: "remove" }: the owner's side. */
export function caseRemovalHandler(req: Request, id: string): Promise<NextResponse> {
  return guarded("removal", () =>
    removal(req, () => ownerParty(req, id, true), "a", (row, viewerId) => ownerView(row, req, viewerId ?? row.ownerId)),
  );
}

/** POST /api/v1/respond/{token}/removal { confirm: "remove", claim? }: Party B's side. */
export function respondRemovalHandler(req: Request, token: string): Promise<NextResponse> {
  return guarded("respond removal", () =>
    removal(req, (body) => respondentParty(req, token, true, body.claim), "b", (row, viewerId, claim) =>
      respondentView(row, viewerId, claim),
    ),
  );
}
