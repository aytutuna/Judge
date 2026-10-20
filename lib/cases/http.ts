/**
 * HTTP handlers for /api/v1/cases* and /api/v1/respond/{token}*. The route
 * files only re-export these.
 *
 * Owner gate order (create, judge, appeal, invite, delete): kill switch ->
 * body -> session -> origin (cookie sessions) -> per-user limit -> site cap
 * where a unit is reserved -> case lookup (404 for missing or not yours) ->
 * state -> reserve. The respondent needs no account: the invite token is the
 * credential, checked by format before any database read; submits pass
 * Turnstile (when configured; skipped for bearer sessions) and per-IP limits.
 * Side B is bound to its author when it is submitted: the signed-in account,
 * or for a signed-out answer a claim secret returned in that response (sent
 * back as `claim` on an appeal, and as the Respondent-Claim header on GET so
 * the view can say whether this person may add context).
 * Every response is `Cache-Control: no-store`.
 */

import { NextResponse } from "next/server";
import type { Entitlement, PremiumBlock } from "@/lib/account-types";
import { API_ERROR_STATUS, apiErrorBody, type ApiErrorBody, type ApiErrorCode } from "@/lib/api-errors";
import { getViewer, isSameOrigin, type ViewerSession } from "@/lib/auth";
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
  type CaseResponse,
  type CaseView,
  type CreateCaseResponse,
  type DeleteCaseResponse,
  type InviteResponse,
  type PartyLetter,
  type RespondResponse,
} from "@/lib/case-types";
import { clientIp } from "@/lib/client-ip";
import { getEntitlement } from "@/lib/entitlements";
import { handleEvidenceUpload, verifyEvidenceTokens, type EvidenceAudience, type VerifiedEvidence } from "@/lib/evidence";
import { casesEnabled, evidenceEnabled } from "@/lib/features";
import { idempotencyKey } from "@/lib/premium/context";
import {
  checkIpLimits,
  checkPremiumSiteCap,
  checkUserLimits,
  type LimitDecision,
  type UserBucket,
} from "@/lib/ratelimit";
import { verifyTurnstile } from "@/lib/turnstile";
import { getCase, getCaseByInviteHash, listOwnerCases, loadCaseBundle, type CaseRow } from "./db";
import { claimMatches, inviteHash, inviteUrl, isInviteToken, publicOrigin } from "./invite";
import {
  claimFor,
  createCase,
  currentInviteToken,
  deleteCase,
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
  signin_required: "Sign in to use Premium.",
  premium_required: "Premium verdicts need credits or a monthly plan.",
  no_credits: "You have no premium credits left.",
  fair_use: "You have used this month's premium verdicts.",
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
};

function fail(
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

function json<T>(body: T, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

function blocked(code: PremiumBlock, resetsAt?: string): NextResponse {
  return fail(code, undefined, resetsAt ? { resetsAt } : {});
}

async function readJson(req: Request, allowEmpty = false): Promise<{ ok: true; body: unknown } | { ok: false }> {
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
function invalidBody(issue: { message?: string; path: PropertyKey[]; code: string } | undefined): NextResponse {
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
    ? fail("daily_cap", "Premium has used today's capacity — try again tomorrow.", { retryAfterSec: decision.retryAfterSec })
    : fail("rate_limited", "Too many requests — take a breather and try again later.", {
        retryAfterSec: decision.retryAfterSec,
      });
}

/** Per-user limit, then (when a unit may be reserved) the site-wide cap. */
async function limitGate(userId: string, bucket: UserBucket, siteCap: boolean): Promise<NextResponse | null> {
  try {
    const user = await checkUserLimits(userId, bucket);
    if (!user.ok) return limitRefusal(user);
    if (!siteCap) return null;
    const site = await checkPremiumSiteCap();
    return site.ok ? null : limitRefusal(site);
  } catch (e) {
    console.error("[cases] limit check failed:", e instanceof Error ? e.message : String(e));
    return fail("unavailable");
  }
}

type Signed = { viewer: ViewerSession } | { response: NextResponse };

async function signedIn(req: Request): Promise<Signed> {
  const viewer = await getViewer(req);
  if (!viewer) return { response: fail("signin_required") };
  if (viewer.via === "cookie" && !isSameOrigin(req)) return { response: fail("bad_origin") };
  return { viewer };
}

function verifyEvidence(
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

async function entitlementOrNull(userId: string): Promise<Entitlement | null> {
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
  const ent = await entitlementOrNull(viewerId);
  if (!ent) return "premium_required";
  return ent.canUsePremium ? null : (ent.blockedReason ?? "premium_required");
}

async function ownerView(row: CaseRow, req: Request, viewerId: string, now = new Date()): Promise<CaseView> {
  const bundle = await loadCaseBundle(row);
  const token = effectiveStatus(row, now) === "awaiting_respondent" ? await currentInviteToken(row) : null;
  return buildCaseView(bundle, {
    role: "owner",
    now,
    inviteUrl: token ? inviteUrl(publicOrigin(req), token) : null,
    ownInvite: false,
    appealBlock: await appealBlockFor(row, bundle, "a", viewerId, now),
  });
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

function guarded(name: string, fn: () => Promise<NextResponse>): Promise<NextResponse> {
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
      framework: parsed.data.framework,
      lang: parsed.data.lang,
      evidence: ev.items,
      ...(key ? { idempotencyKey: key } : {}),
    });
    if (!res.ok) {
      if (res.code === "unavailable") return fail("unavailable");
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

/** DELETE /api/v1/cases/{id} */
export function deleteCaseHandler(req: Request, id: string): Promise<NextResponse> {
  return guarded("delete", async () => {
    if (!casesEnabled()) return fail("not_configured");
    const gate = await signedIn(req);
    if ("response" in gate) return gate.response;
    const row = await ownedCase(id, gate.viewer.user.id);
    if (!row) return fail("not_found");
    const res = await deleteCase(row);
    if (!res.ok) return res.code === "not_found" ? fail("not_found") : fail("in_progress", "Wait for the judges to finish first.");
    const body: DeleteCaseResponse = { deleted: true };
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
      if (res.code === "case_closed" || res.code === "unavailable") return fail(res.code);
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
    const viewer = await getViewer(req);
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

    const viewer = await getViewer(req);
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
