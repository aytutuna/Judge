/**
 * HTTP handlers for /api/v1/cases* and /api/v1/respond/{token}*. The route
 * files only re-export these.
 *
 * Owner gate order (create, judge, appeal, invite, delete): kill switch ->
 * body -> session -> origin (cookie sessions) -> per-user limit -> Premium
 * switch and site cap where a unit is reserved (judge: after the lookup, for
 * premium cases only) -> case lookup (404 for missing or not yours) -> state
 * -> reserve. Every case holds one premium unit from its creation. The
 * respondent must be signed in for everything but the GET preview: the invite
 * token is checked by format before any database read; submits pass
 * Turnstile (when configured; skipped for bearer sessions) and per-IP limits.
 * A seat is bound to the account that opens it and only that account holds it.
 * The owner may start a case without side A (text left out of the create
 * body) and write it later with POST .../side; the answer of the other
 * person can arrive first, and judging starts when both are in.
 * Each party's own originals, name map and display name are readable and
 * editable only by that party: the owner or the respondent, by session.
 * Removal (DELETE /cases/{id}, POST .../removal) blanks that party's
 * personal data and closes every link of the case; no row is deleted.
 * Every response is `Cache-Control: no-store`. The request helpers are
 * shared with one-sided verdict appeals (lib/verdict-appeals).
 */

import { NextResponse } from "next/server";
import type { Entitlement, PremiumBlock } from "@/lib/account-types";
import { track } from "@/lib/analytics/track";
import { API_ERROR_STATUS, apiErrorBody, type ApiErrorBody, type ApiErrorCode } from "@/lib/api-errors";
import { isSameOrigin, premiumEnabled, type ViewerSession } from "@/lib/auth";
import { deadBearerResponse, lookupViewer } from "@/lib/bearer-guard";
import {
  AppealRequest,
  CaseClaimRequest,
  CreateCaseRequest,
  JudgeNowRequest,
  MAX_EVIDENCE_PER_APPEAL,
  MAX_EVIDENCE_PER_SIDE,
  RespondRequest,
  RotateInviteRequest,
  SideRequest,
  type AppealBlock,
  type AppealResponse,
  type CaseClaimResponse,
  type CaseListResponse,
  type CaseRemovalResponse,
  type CaseResponse,
  type CaseView,
  type CreateCaseResponse,
  type DeleteCaseResponse,
  type InviteResponse,
  type LiveCasesResponse,
  type OpenResponse,
  type PartyLetter,
  type RespondResponse,
  type SideResponse,
} from "@/lib/case-types";
import { clientIp } from "@/lib/client-ip";
import { entitlementWriteBatch, getEntitlement } from "@/lib/entitlements";
import { handleEvidenceUpload, verifyEvidenceTokens, type EvidenceAudience, type VerifiedEvidence } from "@/lib/evidence";
import { casesEnabled, evidenceEnabled } from "@/lib/features";
import { agreementRefusal } from "@/lib/feedback/agreement";
import { partiesFor } from "@/lib/multi";
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
import {
  caseDb,
  getCase,
  getCaseByAnyInviteHash,
  getInvites,
  listOwnerCases,
  listWaitingCases,
  loadCaseBundle,
  respondentOf,
  type CaseRow,
  type SeatRow,
} from "./db";
import { acceptsManySides } from "./capability";
import { claimMatches, inviteHash, inviteUrl, isInviteToken, publicOrigin } from "./invite";
import { provenParty } from "./party";
import { claimSeat, heldSide, liveSides, nextOpenSide, recordTyping, releaseSeat, sideIsOpen, touchSeat } from "./seats";
import { respondToSide } from "./sides";
import {
  boundElsewhere,
  createCase,
  currentInviteToken,
  judgeNow,
  respondToCase,
  rotateInvite,
  submitAppeal,
  writeOwnerSide,
} from "./service";
import { parseVenue } from "@/lib/venues";
import { effectiveStatus, materializeExpiry, maybeSweepCases } from "./sweep";
import { ratingsFor } from "@/lib/feedback/db";
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
  seat_moved: "Your place was freed. Open the link again.",
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
  update_required: "This case has more than two sides. Update the app to open it.",
  age_unconfirmed: "Confirm your age to continue.",
};

/** A case with three or four sides, asked by an app that does not send
 * Judge-Sides: thrown by the lookups below and answered by `guarded`. */
class UpdateRequired extends Error {}

const isManySided = (row: CaseRow) => row.sides > 2 && row.mode !== "one_sided";

function gateSides(req: Request, row: CaseRow): void {
  if (isManySided(row) && !acceptsManySides(req, row.sides)) throw new UpdateRequired();
}

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
  const { viewer, refused } = await lookupViewer(req);
  if (refused) return { response: refused };
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

/** Why this viewer cannot appeal as `party` right now (null = allowed). */
async function appealBlockFor(
  row: CaseRow,
  bundle: Awaited<ReturnType<typeof loadCaseBundle>>,
  party: PartyLetter,
  viewerId: string | null,
  now: Date,
): Promise<AppealBlock | null> {
  const structural = structuralAppealBlock(bundle, party, viewerId, now);
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

/** The viewer's own ratings of the case's verdicts; none when the read fails. */
async function viewerRatings(userId: string, bundle: Awaited<ReturnType<typeof loadCaseBundle>>) {
  return ratingsFor(userId, bundle.verdicts.map((v) => v.verdictId)).catch(() => undefined);
}

async function ownerView(row: CaseRow, req: Request, viewerId: string, now = new Date()): Promise<CaseView> {
  const bundle = await loadCaseBundle(row);
  const open = effectiveStatus(row, now) === "awaiting_respondent" && !row.removedAt;
  const token = open ? await currentInviteToken(row) : null;
  return buildCaseView(bundle, {
    role: "owner",
    now,
    inviteUrl: token ? inviteUrl(publicOrigin(req), token) : null,
    ownInvite: false,
    appealBlock: await appealBlockFor(row, bundle, "a", viewerId, now),
    ratings: await viewerRatings(viewerId, bundle),
    originals: await viewOriginals(row, "a", true),
  });
}

/** The case page for the side `party` (B unless the link is for C or D). */
async function respondentView(
  row: CaseRow,
  party: PartyLetter,
  viewerId: string | null,
  now = new Date(),
): Promise<CaseView> {
  const bundle = await loadCaseBundle(row);
  const who = respondentOf(row, bundle.invites, party);
  return buildCaseView(bundle, {
    role: "respondent",
    party,
    now,
    inviteUrl: null,
    ownInvite: viewerId !== null && viewerId === row.ownerId,
    appealBlock: await appealBlockFor(row, bundle, party, viewerId, now),
    inAccount: viewerId !== null && row.mode === "two_sided" && who.userId === viewerId,
    ratings: viewerId ? await viewerRatings(viewerId, bundle) : undefined,
    originals: await viewOriginals(row, party, provenParty(row, bundle.invites, party, viewerId)),
  });
}

/** The owner's case, or null for a bad id, a missing case or someone else's. */
async function ownedCase(id: string, viewerId: string, req: Request): Promise<CaseRow | null> {
  if (!CASE_ID.test(id)) return null;
  const row = await getCase(id);
  if (!row || row.ownerId !== viewerId) return null;
  gateSides(req, row);
  return row;
}

type Found = { row: CaseRow; party: "b" | "c" | "d"; shared: boolean; retired: boolean };

/** The case behind an invite link. A per-side link names its side; the
 * shared one leaves it to whoever holds a seat (see sideOnLink). */
async function caseByToken(token: string, req: Request): Promise<Found | null> {
  if (!isInviteToken(token)) return null;
  const found = await getCaseByAnyInviteHash(inviteHash(token));
  if (found) gateSides(req, found.row);
  return found;
}

/** The side the request proves on the link, with the nonce of its seat at
 * that moment. An older per-side link only proves its own side. Any request
 * that proves a seat also keeps it from going idle. */
async function heldProof(
  found: Found,
  viewerId: string,
): Promise<{ party: "b" | "c" | "d"; nonce: string | null } | null> {
  const bundle = await loadCaseBundle(found.row);
  const party = heldSide(found.row, bundle.invites, bundle.seats, viewerId, null);
  if (!party || (!found.shared && party !== found.party)) return null;
  const seat = bundle.seats.find((s) => s.party === party);
  if (seat) await touchSeat(found.row.id, party, new Date());
  return { party, nonce: seat?.nonce ?? null };
}

/** The side the request proves on the link, or null. */
async function heldOnLink(found: Found, viewerId: string): Promise<"b" | "c" | "d" | null> {
  return (await heldProof(found, viewerId))?.party ?? null;
}

export function guarded(name: string, fn: () => Promise<NextResponse>): Promise<NextResponse> {
  return fn().catch((e: unknown) => {
    if (e instanceof UpdateRequired) return fail("update_required");
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
    if (parsed.data.sides && parsed.data.sides > 2 && !acceptsManySides(req, parsed.data.sides)) {
      return fail("update_required");
    }
    const gate = await signedIn(req);
    if ("response" in gate) return gate.response;
    const userId = gate.viewer.user.id;
    const unagreed = await agreementRefusal(userId);
    if (unagreed) return unagreed;
    const limited = await limitGate(userId, "case_create", true);
    if (limited) return limited;
    await maybeSweepCases();

    const ev = verifyEvidence(parsed.data.evidence, [{ type: "user", userId }], MAX_EVIDENCE_PER_SIDE);
    if ("response" in ev) return ev.response;

    const res = await createCase({
      ownerId: userId,
      ...(parsed.data.text !== undefined
        ? { text: parsed.data.text, rawText: rawField(read.body, "text") ?? parsed.data.text }
        : {}),
      displayName: parsed.data.displayName || null,
      lang: parsed.data.lang,
      evidence: ev.items,
      ...(parsed.data.sides && parsed.data.sides > 2 ? { sides: parsed.data.sides } : {}),
      venue: parseVenue(parsed.data.venue),
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

/** POST /api/v1/cases/{id}/side: the owner writes side A of a case started without it. */
export function writeSideHandler(req: Request, id: string): Promise<NextResponse> {
  return guarded("side", async () => {
    if (!casesEnabled()) return fail("not_configured");
    const key = idempotencyKey(req.headers);
    if (key === null) return fail("invalid", "Idempotency-Key must be 1 to 64 letters, digits, '_' or '-'.");
    const read = await readJson(req);
    if (!read.ok) return fail("invalid", "Invalid JSON body");
    const parsed = SideRequest.safeParse(read.body);
    if (!parsed.success) return invalidBody(parsed.error.issues[0]);
    const gate = await signedIn(req);
    if ("response" in gate) return gate.response;
    const userId = gate.viewer.user.id;
    const unagreed = await agreementRefusal(userId);
    if (unagreed) return unagreed;
    const limited = await limitGate(userId, "premium_verdict", true);
    if (limited) return limited;
    await maybeSweepCases();
    const row = await ownedCase(id, userId, req);
    if (!row) return fail("not_found");

    const ev = verifyEvidence(parsed.data.evidence, [{ type: "user", userId }], MAX_EVIDENCE_PER_SIDE);
    if ("response" in ev) return ev.response;

    const res = await writeOwnerSide({
      row,
      text: parsed.data.text,
      rawText: rawField(read.body, "text") ?? parsed.data.text,
      displayName: parsed.data.displayName || null,
      evidence: ev.items,
      origin: publicOrigin(req),
    });
    if (!res.ok) return fail(res.code);
    const entitlement = await entitlementOrNull(userId);
    const body: SideResponse = {
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
    const { viewer, refused } = await lookupViewer(req);
    if (refused) return refused;
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
    const rows = await listOwnerCases(viewer.user.id, limit + 1, before, acceptsManySides(req));
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
    const { viewer, refused } = await lookupViewer(req);
    if (refused) return refused;
    if (!viewer) return fail("signin_required");
    await maybeSweepCases();
    const row = await ownedCase(id, viewer.user.id, req);
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
    const row = await ownedCase(id, gate.viewer.user.id, req);
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
    const row = await ownedCase(id, userId, req);
    if (!row) return fail("not_found");
    const res = await judgeNow({ row, mode: parsed.data.mode, origin: publicOrigin(req) });
    if (!res.ok) {
      if (res.code === "invalid") {
        return fail(
          "invalid",
          isManySided(row)
            ? 'Send { "mode": "answered" } to judge the sides that answered, or { "mode": "only_mine" } to judge yours alone.'
            : 'Send { "mode": "only_mine" } to judge without the other side.',
        );
      }
      if (res.code === "side_missing") {
        return fail(
          "invalid",
          isManySided(row) ? "Write your side first, and wait until at least B has answered (the sides that answered must be A, B, C in order)." : "Write your side first.",
        );
      }
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
    const read = await readJson(req, true);
    if (!read.ok) return fail("invalid", "Invalid JSON body");
    const parsed = RotateInviteRequest.safeParse(read.body ?? {});
    if (!parsed.success) return invalidBody(parsed.error.issues[0]);
    const row = await ownedCase(id, gate.viewer.user.id, req);
    if (!row) return fail("not_found");
    const res = await rotateInvite(row);
    if (!res.ok) return fail(res.code);
    // Older apps read which side's link was replaced; it is the same one for all.
    const body: InviteResponse = { inviteUrl: inviteUrl(publicOrigin(req), res.token), party: parsed.data.party ?? "b" };
    return json(body);
  });
}

async function appealCommon(
  req: Request,
  load: (userId: string) => Promise<{ row: CaseRow } | { response: NextResponse }>,
  party: PartyLetter,
  audiences: (userId: string, row: CaseRow) => EvidenceAudience[],
  view: (row: CaseRow, userId: string) => Promise<CaseView>,
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
    case: await view(res.row, userId),
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
        const row = await ownedCase(id, userId, req);
        return row ? { row } : { response: fail("not_found") };
      },
      "a",
      (userId) => [{ type: "user", userId }],
      (row, userId) => ownerView(row, req, userId),
    ),
  );
}

// --- Respondent ---------------------------------------------------------------------

/** GET /api/v1/respond/{token}: what the invite shows. Signed out it is the
 * form's case page for the next open side, with nothing taken; a seat is
 * only taken by POST .../open, signed in. */
export function respondGetHandler(req: Request, token: string): Promise<NextResponse> {
  return guarded("respond get", async () => {
    if (!casesEnabled()) return fail("not_configured");
    if (!isInviteToken(token)) return fail("not_found", "No invite with that link.");
    await maybeSweepCases();
    const found = await caseByToken(token, req);
    if (!found) return fail("not_found", "No invite with that link.");
    const { viewer, deadBearer, refused } = await lookupViewer(req);
    if (deadBearer) return deadBearerResponse();
    if (refused) return refused;
    if (await staleInvite(found.row, found.party)) return fail("case_closed");
    const viewerId = viewer?.user.id ?? null;
    let party: PartyLetter = found.party;
    if (found.shared) {
      // Nobody is given a side by looking: a visitor sees the form of the
      // next open one, and a full case is closed to a signed-in visitor.
      const now = new Date();
      const bundle = await loadCaseBundle(found.row);
      const held = viewerId ? heldSide(found.row, bundle.invites, bundle.seats, viewerId, null) : null;
      if (held) {
        party = held;
        await touchSeat(found.row.id, held, now);
      } else if (found.retired) return fail("not_found", "No invite with that link.");
      else if (viewerId !== found.row.ownerId && effectiveStatus(found.row, now) === "awaiting_respondent") {
        const open = nextOpenSide(bundle, now);
        if (open) party = open;
        else if (viewerId) return fail("case_closed");
      }
    } else if (viewerId && !(await heldOnLink(found, viewerId)) && viewerId !== found.row.ownerId) {
      // An older per-side link shows its side as taken once somebody holds it.
      const bundle = await loadCaseBundle(found.row);
      const now = new Date();
      if (effectiveStatus(found.row, now) === "awaiting_respondent" && !sideIsOpen(bundle, now, found.party)) {
        return fail("case_closed");
      }
    }
    const view = await respondentView(found.row, party, viewerId);
    // Only the account that answered is addressed as that side, at every stage;
    // anyone else sees the invite, or the verdict, as a bystander.
    const body: CaseResponse = {
      case: view.inAccount === true ? view : { ...view, respondentAnswered: false },
    };
    return json(body);
  });
}

/** The link is for a side the case no longer has (it was judged without that
 * side) and nobody answered through it. */
async function staleInvite(row: CaseRow, party: PartyLetter): Promise<boolean> {
  if (partiesFor(row.sides).includes(party)) return false;
  return respondentOf(row, await getInvites(row.id), party).claimNonce === null;
}

/** The evidence audience of a respondent link: bound to the side it is for. */
const respondentAudience = (row: CaseRow, party: PartyLetter): EvidenceAudience => ({
  type: "respondent",
  caseId: row.id,
  ...(party === "c" || party === "d" ? { party } : {}),
});

/** POST /api/v1/respond/{token}: the other person's side. The link says which
 * side it writes (B, or C and D in a case with that many sides). */
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
    const found = await caseByToken(token, req);
    if (!found) return fail("not_found", "No invite with that link.");
    const { row } = found;
    if (row.removedAt) return fail("removed");

    const gate = await signedIn(req);
    if ("response" in gate) return gate.response;
    const { viewer } = gate;
    const unagreed = await agreementRefusal(viewer.user.id);
    if (unagreed) return unagreed;
    const proof = await heldProof(found, viewer.user.id);
    const held = proof?.party ?? null;
    let party: "b" | "c" | "d" = held ?? found.party;
    let retry = false;
    if (held === null && found.shared && key) {
      // A retry of an answer whose response never arrived: its key says which side it was.
      const invites = await getInvites(row.id);
      const stored = (["b", "c", "d"] as const).find((p) => respondentOf(row, invites, p).idem === key);
      if (stored) {
        party = stored;
        retry = true;
      }
    }
    if (found.retired && held === null && !retry) return fail("not_found", "No invite with that link.");
    const ip = clientIp(req.headers);
    if (viewer.via !== "bearer") {
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
    if (viewer.user.id === row.ownerId) return fail("own_case");

    const now = new Date();
    const status = effectiveStatus(row, now);
    if (status === "expired") {
      await materializeExpiry(row, now).catch(() => undefined);
      return fail("case_expired");
    }

    // Answering without having opened the link first (an older app) takes the
    // next open side here, just before the answer is stored, and gives it back
    // if the answer fails: this person has no claim yet to come back with.
    let taken: SeatRow | null = null;
    // The page showed one side; an answer must not land on another (its seat was freed meanwhile).
    const shown = parsed.data.party;
    let moved = false;
    const takeSeat = async (): Promise<boolean> => {
      if (held !== null || retry) {
        moved = shown !== undefined && party !== shown;
        return !moved;
      }
      // An older per-side link can only take its own side, and only while it is free.
      // An answer written for a side takes that side, not whichever is next.
      const bundle = await loadCaseBundle(row);
      // On the shared link an idle seat is taken for the shown side only when it is next in line anyway:
      // an account may not choose to push a quiet invitee off a seat while sides are free.
      const pushing =
        shown !== undefined &&
        bundle.seats.some((s) => s.party === shown) &&
        sideIsOpen(bundle, now, shown) &&
        nextOpenSide(bundle, now) !== shown;
      const wanted = pushing ? undefined : shown;
      taken = await claimSeat(bundle, viewer.user.id, now, found.shared ? wanted : found.party);
      if (taken) {
        party = taken.party;
        return true;
      }
      // The page showed a side that someone else now holds (it was freed, and may
      // have been answered since): the person can still be given another one.
      if (shown !== undefined) {
        const fresh = await loadCaseBundle(row);
        moved =
          fresh.seats.some((s) => s.party === shown && s.userId !== viewer.user.id) && nextOpenSide(fresh, now) !== null;
      }
      return false;
    };
    const giveBack = () => (taken ? releaseSeat(taken) : Promise.resolve());
    const noSeat = async () => {
      if (moved) return fail("seat_moved");
      // A signed-in person who already holds another side has no second one.
      const uid = viewer.user.id;
      const mine = (await loadCaseBundle(row)).seats.some((x) => x.userId === uid);
      return mine ? fail("not_party", "You already answered for another side of this case.") : fail("case_closed");
    };
    const seatNonce = () => proof?.nonce ?? taken?.nonce ?? undefined;

    if (party !== "b" || row.sides > 2) {
      // Each side has its own answer and claim: respondToSide checks that
      // this one is still open.
      if (status !== "awaiting_respondent") {
        const invites = await getInvites(row.id);
        if (key && respondentOf(row, invites, party).idem === key) {
          const body: RespondResponse = {
            case: await respondentView(row, party, viewer.user.id),
            name_map: [],
            replayed: true,
          };
          return json(body, 202);
        }
        return fail("case_closed");
      }
      const audience = found.shared ? ({ type: "respondent", caseId: row.id } as const) : respondentAudience(row, party);
      const ev = verifyEvidence(parsed.data.evidence, [audience], MAX_EVIDENCE_PER_SIDE);
      if ("response" in ev) return ev.response;
      if (!(await takeSeat())) return noSeat();
      const res = await respondToSide({
        row,
        party,
        ...(seatNonce() ? { seatNonce: seatNonce() } : {}),
        userId: viewer.user.id,
        text: parsed.data.text,
        rawText: rawField(read.body, "text") ?? parsed.data.text,
        displayName: parsed.data.displayName || null,
        evidence: ev.items,
        ...(key ? { idempotencyKey: key } : {}),
        origin: publicOrigin(req),
        now,
      });
      if (!res.ok) {
        await giveBack();
        if (res.code === "other_side") return fail("not_party", "You already answered for another side of this case.");
        return fail(res.code);
      }
      const body: RespondResponse = {
        case: await respondentView(res.row, party, viewer.user.id),
        name_map: res.nameMap,
        ...(res.replayed ? { replayed: true } : {}),
      };
      return json(body, 202);
    }

    // A case waiting for the owner's side already holds an answer: closed too.
    if (status !== "awaiting_respondent" || row.respondentClaimNonce) {
      if (key && row.respondentIdem === key) {
        const body: RespondResponse = {
          case: await respondentView(row, "b", viewer.user.id),
          name_map: [],
          replayed: true,
        };
        return json(body, 202);
      }
      return fail("case_closed");
    }

    const ev = verifyEvidence(parsed.data.evidence, [{ type: "respondent", caseId: row.id }], MAX_EVIDENCE_PER_SIDE);
    if ("response" in ev) return ev.response;

    if (!(await takeSeat())) return noSeat();
    const res = await respondToCase({
      row,
      ...(seatNonce() ? { seatNonce: seatNonce() } : {}),
      userId: viewer.user.id,
      text: parsed.data.text,
      rawText: rawField(read.body, "text") ?? parsed.data.text,
      displayName: parsed.data.displayName || null,
      evidence: ev.items,
      ...(key ? { idempotencyKey: key } : {}),
      origin: publicOrigin(req),
      now,
    });
    if (!res.ok) {
      await giveBack();
      return fail(res.code);
    }
    const body: RespondResponse = {
      case: await respondentView(res.row, "b", viewer.user.id),
      name_map: res.nameMap,
      ...(res.replayed ? { replayed: true } : {}),
    };
    return json(body, 202);
  });
}

/** POST /api/v1/respond/{token}/open: the signed-in opener takes the next
 * open side (the first side they would get by answering), bound to their
 * account. Opening again returns the same side. The owner opening their own
 * link takes nothing. */
export function respondOpenHandler(req: Request, token: string): Promise<NextResponse> {
  return guarded("respond open", async () => {
    if (!casesEnabled()) return fail("not_configured");
    if (!isInviteToken(token)) return fail("not_found", "No invite with that link.");
    const found = await caseByToken(token, req);
    if (!found) return fail("not_found", "No invite with that link.");
    const { row } = found;
    const gate = await signedIn(req);
    if ("response" in gate) return gate.response;
    const viewerId = gate.viewer.user.id;
    if (row.removedAt) return fail("removed");
    if (viewerId === row.ownerId) {
      const body: OpenResponse = { case: await respondentView(row, "b", viewerId), respondent_claim: null };
      return json(body);
    }
    const limit = await checkIpLimits(clientIp(req.headers), "respond_open").catch(() => null);
    if (!limit) return fail("unavailable");
    if (!limit.ok) return limitRefusal(limit);

    const now = new Date();
    const status = effectiveStatus(row, now);
    if (status === "expired") {
      await materializeExpiry(row, now).catch(() => undefined);
      return fail("case_expired");
    }
    const bundle = await loadCaseBundle(row);
    let party: "b" | "c" | "d";
    const held = heldSide(row, bundle.invites, bundle.seats, viewerId, null);
    if (held && (found.shared || held === found.party)) {
      party = held;
      if (bundle.seats.some((s) => s.party === party)) await touchSeat(row.id, party, now);
    } else if (found.retired) {
      return fail("not_found", "No invite with that link.");
    } else {
      // An older per-side link takes its own side while it is free (or idle).
      if (status !== "awaiting_respondent") return fail("case_closed");
      const seat = await claimSeat(bundle, viewerId, now, found.shared ? undefined : found.party);
      if (seat) party = seat.party;
      else {
        // A second tab of the same account may have taken the side meanwhile.
        const again = await loadCaseBundle(row);
        const mine = heldSide(row, again.invites, again.seats, viewerId, null);
        if (!mine || !(found.shared || mine === found.party)) return fail("case_closed");
        party = mine;
      }
    }
    const fresh = (await getCase(row.id)) ?? row;
    const body: OpenResponse = { case: await respondentView(fresh, party, viewerId), respondent_claim: null };
    return json(body);
  });
}

/** POST /api/v1/respond/{token}/typing: a heartbeat from the person writing
 * their side. It carries nothing; the owner's view reports "typing" for a
 * few seconds after the last one. Only a holder of a seat of this case can
 * send it, and anyone else gets the same 404 as a wrong link. */
export function respondTypingHandler(req: Request, token: string): Promise<NextResponse> {
  return guarded("respond typing", async () => {
    if (!casesEnabled()) return fail("not_configured");
    if (!isInviteToken(token)) return fail("not_found", "No invite with that link.");
    const found = await caseByToken(token, req);
    if (!found) return fail("not_found", "No invite with that link.");
    const { row } = found;
    const gate = await signedIn(req);
    if ("response" in gate) return gate.response;
    const bundle = await loadCaseBundle(row);
    const held = heldSide(row, bundle.invites, bundle.seats, gate.viewer.user.id, null);
    // An older per-side link only speaks for its own side.
    const party = held && (found.shared || held === found.party) ? held : null;
    const seat = party ? bundle.seats.find((s) => s.party === party) : undefined;
    if (!party || !seat || row.removedAt) return fail("not_found", "No invite with that link.");
    const now = new Date();
    if (effectiveStatus(row, now) !== "awaiting_respondent" || bundle.sides.some((s) => s.party === party)) {
      return fail("case_closed");
    }
    const limit = await checkUserLimits(`case:${row.id}:${party}`, "case_typing").catch(() => null);
    if (!limit) return fail("unavailable");
    if (!limit.ok) return limitRefusal(limit);
    await recordTyping(row.id, party, now);
    return json({ ok: true });
  });
}

/** GET /api/v1/cases/live: who has opened, is typing in and has answered
 * each of the owner's cases that still wait. Polled while the menu is open. */
export function liveCasesHandler(req: Request): Promise<NextResponse> {
  return guarded("live", async () => {
    if (!casesEnabled()) return fail("not_configured");
    const { viewer, refused } = await lookupViewer(req);
    if (refused) return refused;
    if (!viewer) return fail("signin_required");
    const limit = await checkUserLimits(viewer.user.id, "case_live").catch(() => null);
    if (!limit) return fail("unavailable");
    if (!limit.ok) return limitRefusal(limit);
    const now = new Date();
    const waiting = await listWaitingCases(viewer.user.id, now.toISOString(), 30);
    const body: LiveCasesResponse = { cases: waiting.map((c) => ({ id: c.row.id, sides: liveSides(c, now) })) };
    return json(body);
  });
}

/** POST /api/v1/respond/{token}/appeals: a signed-in Premium respondent
 * (the side the link is for): the account bound to that side. */
export function respondAppealHandler(req: Request, token: string): Promise<NextResponse> {
  return guarded("respond appeal", async () => {
    if (!casesEnabled()) return fail("not_configured");
    if (isInviteToken(token)) await maybeSweepCases();
    const found = isInviteToken(token) ? await caseByToken(token, req) : null;
    if (!found) return fail("not_found", "No invite with that link.");
    const gate = await signedIn(req);
    if ("response" in gate) return gate.response;
    const party = found.shared ? ((await heldOnLink(found, gate.viewer.user.id)) ?? "b") : found.party;
    return appealCommon(
      req,
      async (userId) => {
        const row = (await getCase(found.row.id)) ?? found.row;
        if (userId === row.ownerId) return { response: fail("not_party") };
        if (row.mode === "one_sided") return { response: fail("not_party") };
        const bound = respondentOf(row, await getInvites(row.id), party).userId;
        if (bound && bound !== userId) return { response: fail("not_party") };
        return { row };
      },
      party,
      (userId, row) => [{ type: "user", userId }, respondentAudience(row, party)],
      (row, userId) => respondentView(row, party, userId),
    );
  });
}

/** POST /api/v1/respond/{token}/evidence: the respondent's screenshots. */
export function respondEvidenceHandler(req: Request, token: string): Promise<NextResponse | Response> {
  return guarded("respond evidence", async () => {
    if (!casesEnabled() || !evidenceEnabled()) return fail("not_configured", "Screenshot evidence is not available right now.");
    if (!isInviteToken(token)) return fail("not_found", "No invite with that link.");
    const found = await caseByToken(token, req);
    if (!found) return fail("not_found", "No invite with that link.");
    const { row } = found;
    const gate = await signedIn(req);
    if ("response" in gate) return gate.response;
    const viewerId = gate.viewer.user.id;
    if (viewerId === row.ownerId) return fail("own_case");
    const unagreed = await agreementRefusal(viewerId);
    if (unagreed) return unagreed;
    const status = effectiveStatus(row, new Date());
    if (status === "expired") return fail("case_expired");
    let party: "b" | "c" | "d" = found.party;
    if (!found.shared) await heldOnLink(found, viewerId);
    if (found.shared) {
      const bundle = await loadCaseBundle(row);
      const held = await heldOnLink(found, viewerId);
      if (!held && found.retired) return fail("not_found", "No invite with that link.");
      const side = held ?? nextOpenSide(bundle, new Date());
      if (!side) return fail("case_closed");
      party = side;
    }
    const answered = respondentOf(row, await getInvites(row.id), party).claimNonce !== null;
    if (status !== "awaiting_respondent" || answered) return fail("case_closed");
    const ip = clientIp(req.headers);
    try {
      const byIp = await checkIpLimits(ip, "respond_evidence");
      if (!byIp.ok) return limitRefusal(byIp);
      const byCase = await checkUserLimits(`case:${row.id}:${party}:${viewerId}`, "case_evidence");
      if (!byCase.ok) return limitRefusal(byCase);
    } catch {
      return fail("unavailable");
    }
    const res = await handleEvidenceUpload(req, found.shared ? { type: "respondent", caseId: row.id } : respondentAudience(row, party));
    res.headers.set("Cache-Control", "no-store");
    return res as NextResponse;
  });
}

// --- Originals, display names, removal --------------------------------------------

/** Per-account limit for a session. */
async function ownerLimit(viewerId: string): Promise<NextResponse | null> {
  try {
    const decision = await checkUserLimits(viewerId, "verdict_owner");
    return decision.ok ? null : limitRefusal(decision);
  } catch {
    return fail("unavailable");
  }
}

type Party = { row: CaseRow; viewer: ViewerSession; party: PartyLetter } | { response: NextResponse };

/** The owner of case `id` (session). Writes need the same origin for cookies. */
async function ownerParty(req: Request, id: string, write: boolean): Promise<Party> {
  if (!casesEnabled()) return { response: fail("not_configured") };
  const { viewer, refused } = await lookupViewer(req);
  if (refused) return { response: refused };
  if (!viewer) return { response: fail("signin_required") };
  if (write && viewer.via === "cookie" && !isSameOrigin(req)) return { response: fail("bad_origin") };
  const limited = await ownerLimit(viewer.user.id);
  if (limited) return { response: limited };
  const row = await ownedCase(id, viewer.user.id, req);
  return row ? { row, viewer, party: "a" } : { response: fail("not_found") };
}

/** The side the link `token` is for, held by the signed-in account. */
async function respondentParty(req: Request, token: string, write: boolean): Promise<Party> {
  if (!casesEnabled()) return { response: fail("not_configured") };
  if (!isInviteToken(token)) return { response: fail("not_found", "No invite with that link.") };
  const { viewer, deadBearer, refused } = await lookupViewer(req);
  if (deadBearer) return { response: deadBearerResponse() };
  if (refused) return { response: refused };
  if (!viewer) return { response: fail("signin_required") };
  if (write && viewer.via === "cookie" && !isSameOrigin(req)) return { response: fail("bad_origin") };
  const limited = await ownerLimit(viewer.user.id);
  if (limited) return { response: limited };
  const found = await caseByToken(token, req);
  if (!found) return { response: fail("not_found", "No invite with that link.") };
  const { row } = found;
  if (row.mode !== "two_sided") return { response: fail("case_closed") };
  const viewerId = viewer.user.id;
  const party = (await heldOnLink(found, viewerId)) ?? found.party;
  if (!provenParty(row, await getInvites(row.id), party, viewerId)) {
    return { response: fail("not_party") };
  }
  return { row, viewer, party };
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

/** GET /api/v1/respond/{token}/originals: the link's side and appeal as written. */
export function respondOriginalsHandler(req: Request, token: string): Promise<NextResponse> {
  return guarded("respond originals", async () => {
    const p = await respondentParty(req, token, false);
    if ("response" in p) return p.response;
    return json(await originalsBody(p.row, p.party));
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
    const body: CaseResponse = { case: await ownerView(fresh, req, p.viewer.user.id) };
    return json(body);
  });
}

/** PATCH /api/v1/respond/{token}/display { displayName? } */
export function respondDisplayHandler(req: Request, token: string): Promise<NextResponse> {
  return guarded("respond display", async () => {
    const read = await readJson(req);
    if (!read.ok) return fail("invalid", "Invalid JSON body");
    const parsed = CaseDisplayPatch.safeParse(read.body);
    if (!parsed.success) return fail("invalid", parsed.error.issues[0]?.message ?? "Invalid request");
    if (parsed.data.namesVisible !== undefined) return fail("not_party", "Only the person who started the case can switch names off.");
    const p = await respondentParty(req, token, true);
    if ("response" in p) return p.response;
    const refused = await updateCaseDisplay(p.row, p.party, { displayName: parsed.data.displayName });
    if (refused) return refused;
    const fresh = (await getCase(p.row.id)) ?? p.row;
    const body: CaseResponse = { case: await respondentView(fresh, p.party, p.viewer.user.id) };
    return json(body);
  });
}

async function removal(
  req: Request,
  load: () => Promise<Party>,
  view: (row: CaseRow, party: PartyLetter, viewerId: string) => Promise<CaseView>,
): Promise<NextResponse> {
  const read = await readJson(req);
  if (!read.ok) return fail("invalid", "Invalid JSON body");
  const parsed = RemovalRequest.safeParse(read.body);
  if (!parsed.success) return fail("invalid", 'Send { "confirm": "remove" } to remove it.');
  const p = await load();
  if ("response" in p) return p.response;
  const party = p.party;
  const res = await removeCaseSide(p.row, party, `party_${party}`);
  if (!res.ok) return res.code === "not_found" ? fail("not_found") : fail("in_progress", "Wait for the judges to finish first.");
  const body: CaseRemovalResponse = {
    removed: true,
    removedAt: res.removedAt,
    case: await view(res.row, party, p.viewer.user.id),
  };
  return json(body);
}

/** POST /api/v1/cases/{id}/removal { confirm: "remove" }: the owner's side. */
export function caseRemovalHandler(req: Request, id: string): Promise<NextResponse> {
  return guarded("removal", () =>
    removal(req, () => ownerParty(req, id, true), (row, _party, viewerId) => ownerView(row, req, viewerId)),
  );
}

/** POST /api/v1/cases/{id}/claim { claim }: a signed-in respondent who
 * answered signed out, before an account was needed, links that side to
 * their account; it is the only use the claim has left. Wrong claim, the
 * owner, a one-sided case or a side already bound to someone else all get
 * the same 404, checked before anything about the case is told. An account
 * that already answers for another side, or holds a seat on one that was
 * answered, gets 409 case_closed; an unanswered seat is let go instead. */
export function respondentClaimHandler(req: Request, id: string): Promise<NextResponse> {
  return guarded("claim", async () => {
    if (!casesEnabled()) return fail("not_configured");
    const read = await readJson(req);
    if (!read.ok) return fail("invalid", "Invalid JSON body");
    const parsed = CaseClaimRequest.safeParse(read.body);
    if (!parsed.success) return fail("invalid", 'Send { "claim": "..." } from your answer.');
    const gate = await signedIn(req);
    if ("response" in gate) return gate.response;
    const userId = gate.viewer.user.id;
    const limited = await ownerLimit(userId);
    if (limited) return limited;
    if (!CASE_ID.test(id)) return fail("not_found");
    const row = await getCase(id);
    if (!row || row.mode !== "two_sided" || row.ownerId === userId) return fail("not_found");
    gateSides(req, row);
    // The claim secret says which side it is: B's, or C's or D's in a case with that many.
    const invites = await getInvites(row.id);
    const party = (["b", "c", "d"] as const).find((p) =>
      claimMatches({ id: row.id, respondentClaimNonce: respondentOf(row, invites, p).claimNonce }, parsed.data.claim),
    );
    if (!party) return fail("not_found");
    const removedAt = { b: row.removedBAt, c: row.removedCAt, d: row.removedDAt }[party];
    if (removedAt) return fail("removed");
    const claimed: CaseClaimResponse = { claimed: true };
    const bound = respondentOf(row, invites, party).userId;
    if (bound === userId) return json(claimed);
    if (bound) return fail("not_found");
    // One person is one side of a case: linked to another, or seated on another.
    if (boundElsewhere(row, invites, party, userId)) return fail("case_closed");
    await caseDb();
    const nowIso = new Date().toISOString();
    // A seat of this account with something answered on it blocks the link; one
    // without gives way to it, in the same batch so a refused link costs nothing.
    const answeredSeat = `EXISTS (SELECT 1 FROM case_sides s WHERE s.case_id = st.case_id AND s.party = st.party)`;
    const rs = await entitlementWriteBatch([
      party === "b"
        ? {
            sql: `UPDATE cases SET respondent_user_id = ?, updated_at = ?
                  WHERE id = ? AND respondent_user_id IS NULL AND respondent_claim_nonce = ? AND owner_id <> ?
                    AND removed_b_at IS NULL
                    AND NOT EXISTS (SELECT 1 FROM case_invites WHERE case_id = cases.id AND user_id = ?)
                    AND NOT EXISTS (SELECT 1 FROM case_seats st WHERE st.case_id = cases.id AND st.user_id = ? AND st.party <> 'b' AND ${answeredSeat})`,
            args: [userId, nowIso, row.id, row.respondentClaimNonce, userId, userId, userId],
          }
        : {
            sql: `UPDATE case_invites SET user_id = ?, updated_at = ?
                  WHERE case_id = ? AND party = ? AND user_id IS NULL AND claim_nonce = ?
                    AND EXISTS (SELECT 1 FROM cases c WHERE c.id = case_invites.case_id AND c.owner_id <> ?
                                  AND c.removed_${party}_at IS NULL AND c.respondent_user_id IS NOT ?)
                    AND NOT EXISTS (SELECT 1 FROM case_invites i WHERE i.case_id = case_invites.case_id AND i.user_id = ?)
                    AND NOT EXISTS (SELECT 1 FROM case_seats st WHERE st.case_id = case_invites.case_id AND st.user_id = ? AND st.party <> ? AND ${answeredSeat})`,
            args: [userId, nowIso, row.id, party, respondentOf(row, invites, party).claimNonce, userId, userId, userId, userId, party],
          },
      {
        sql: `DELETE FROM case_seats AS st WHERE st.case_id = ? AND st.user_id = ? AND st.party <> ? AND NOT ${answeredSeat}
                AND (EXISTS (SELECT 1 FROM cases c WHERE c.id = st.case_id AND c.respondent_user_id = ?)
                  OR EXISTS (SELECT 1 FROM case_invites i WHERE i.case_id = st.case_id AND i.user_id = ?))`,
        args: [row.id, userId, party, userId, userId],
      },
    ]);
    if (rs[0].rowsAffected !== 1) {
      const fresh = await getCase(row.id);
      const freshBound = respondentOf(fresh ?? row, await getInvites(row.id), party).userId;
      if (fresh && { b: fresh.removedBAt, c: fresh.removedCAt, d: fresh.removedDAt }[party]) return fail("removed");
      if (freshBound === userId) return json(claimed);
      const answered = await loadCaseBundle(fresh ?? row);
      const seated = answered.seats.some(
        (st) => st.userId === userId && st.party !== party && answered.sides.some((x) => x.party === st.party),
      );
      return seated ? fail("case_closed") : fail("not_found");
    }
    void track("case_claimed", { userId });
    return json(claimed);
  });
}

/** POST /api/v1/respond/{token}/removal { confirm: "remove" }: the link's side. */
export function respondRemovalHandler(req: Request, token: string): Promise<NextResponse> {
  return guarded("respond removal", () =>
    removal(req, () => respondentParty(req, token, true), (row, party, viewerId) =>
      respondentView(row, party, viewerId),
    ),
  );
}
