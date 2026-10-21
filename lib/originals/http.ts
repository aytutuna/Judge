/**
 * HTTP handlers for a writer's own one-sided verdicts:
 *   GET    /api/v1/verdicts/{id}/mine      the writer's view (original, names, display)
 *   PATCH  /api/v1/verdicts/{id}/display   display names and the names switch
 *   POST   /api/v1/verdicts/{id}/removal   blank personal data, close the link
 *   POST   /api/v1/verdicts/{id}/claim     move a token-owned verdict into the account
 *   GET    /api/v1/me/verdicts             the account's verdicts
 *
 * The writer is the signed-in owner (cookie or bearer) or whoever presents
 * the owner token in the X-Owner-Token header (never a URL). A case verdict
 * is readable here by its parties (owner session, bound respondent, or the
 * Respondent-Claim header); its names and removal live on the case
 * endpoints. Anyone else, a wrong or malformed token, or an unknown id gets
 * the same 404. Cookie writes need the same origin. Every response is
 * `Cache-Control: no-store`. Server only.
 */

import { NextResponse } from "next/server";
import { API_ERROR_STATUS, apiErrorBody, type ApiErrorCode } from "@/lib/api-errors";
import { getViewer, isSameOrigin, resolveViewer, type ViewerSession } from "@/lib/auth";
import { deadBearerResponse } from "@/lib/bearer-guard";
import { getCase, type CaseRow } from "@/lib/cases/db";
import { claimMatches } from "@/lib/cases/invite";
import { clientIp } from "@/lib/client-ip";
import { getVerdict } from "@/lib/db";
import { entitlementWriteBatch } from "@/lib/entitlements";
import {
  EMPTY_DISPLAY,
  firstNameOf,
  RemovalRequest,
  VerdictDisplayPatch,
  type DisplayResponse,
  type DisplayState,
  type MineResponse,
  type OriginalPayload,
  type OriginalStatus,
  type OwnerVerdictListResponse,
  type RemovalResponse,
} from "@/lib/originals-types";
import { checkIpLimits, checkUserLimits, type LimitDecision } from "@/lib/ratelimit";
import { aad, openOrNull, originalsKeyState, ownerTokenMatches, sealJson } from "./crypto";
import { caseDisplayNames, partyOriginals } from "./cases";
import { getOriginal, getVerdictMeta, listOwnerVerdicts, originalsDb, subjects, type VerdictMeta } from "./db";
import { openVerdictDisplay } from "./display";
import { removeVerdict } from "./removal";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  invalid: "Invalid request",
  not_found: "No verdict with that id.",
  bad_origin: "This request came from another site.",
  signin_required: "Sign in first.",
  unavailable: "Verdicts are unavailable right now — try again in a minute.",
  removed: "This verdict was removed. Its link no longer works.",
  names_unavailable: "Names can't be saved on this server right now.",
  case_closed: "This verdict belongs to a case or another account: change it there.",
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
    console.error(`[originals] ${name} failed:`, e instanceof Error ? e.message : String(e));
    return fail("unavailable");
  });
}

async function readJson(req: Request): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    return { ok: true, body: JSON.parse(await req.text()) as unknown };
  } catch {
    return { ok: false };
  }
}

function limitRefusal(d: Exclude<LimitDecision, { ok: true }>): NextResponse {
  if (d.code === "unavailable") return fail("unavailable");
  return fail("rate_limited", "Too many requests — take a breather and try again later.", d.retryAfterSec);
}

function ownerTokenHeader(req: Request): string | null {
  const v = req.headers.get("x-owner-token")?.trim();
  return v && v.length <= 64 ? v : null;
}

function claimHeader(req: Request): string | null {
  const v = req.headers.get("respondent-claim")?.trim();
  return v && v.length <= 64 ? v : null;
}

type Owner =
  | { meta: VerdictMeta; via: "session" | "token"; viewer: ViewerSession | null; caseParty: { row: CaseRow; party: "a" | "b" } | null }
  | { response: NextResponse };

/** Who is asking, checked against the verdict's owner. 404 for everyone else. */
async function ownerOf(req: Request, id: string, write: boolean): Promise<Owner> {
  if (!ID_PATTERN.test(id)) return { response: fail("not_found") };
  const token = ownerTokenHeader(req);
  const { viewer, deadBearer } = await resolveViewer(req);
  if (deadBearer) return { response: deadBearerResponse() };
  if (!token && !viewer && !claimHeader(req)) return { response: fail("not_found") };
  try {
    const limit = viewer && !token
      ? await checkUserLimits(viewer.user.id, "verdict_owner")
      : await checkIpLimits(clientIp(req.headers), "verdict_owner");
    if (!limit.ok) return { response: limitRefusal(limit) };
  } catch {
    return { response: fail("unavailable") };
  }
  const meta = await getVerdictMeta(id);
  if (!meta) return { response: fail("not_found") };
  const sessionWriteOk = () => !write || viewer?.via !== "cookie" || isSameOrigin(req);

  if (meta.kind === "case") {
    const row = meta.caseId ? await getCase(meta.caseId) : null;
    if (!row) return { response: fail("not_found") };
    const viewerId = viewer?.user.id ?? null;
    let party: "a" | "b" | null = null;
    if (viewerId && viewerId === row.ownerId) party = "a";
    else if (row.mode === "two_sided" && viewerId && viewerId === row.respondentUserId) party = "b";
    else if (row.mode === "two_sided" && viewerId !== row.ownerId && claimMatches(row, claimHeader(req))) party = "b";
    if (!party) return { response: fail("not_found") };
    if (!sessionWriteOk()) return { response: fail("bad_origin") };
    return { meta, via: "session", viewer, caseParty: { row, party } };
  }
  if (viewer && meta.ownerUserId && meta.ownerUserId === viewer.user.id) {
    if (!sessionWriteOk()) return { response: fail("bad_origin") };
    return { meta, via: "session", viewer, caseParty: null };
  }
  if (ownerTokenMatches(token, meta.ownerTokenHash)) return { meta, via: "token", viewer, caseParty: null };
  return { response: fail("not_found") };
}

function displayState(meta: VerdictMeta): DisplayState {
  return { ...openVerdictDisplay(meta), namesVisible: meta.namesVisible };
}

const HIDDEN: DisplayState = { ...EMPTY_DISPLAY, others: {}, namesVisible: false };

async function originalOf(meta: VerdictMeta): Promise<{ status: OriginalStatus; original: OriginalPayload | null }> {
  const subject = subjects.verdict(meta.verdictId);
  const row = await getOriginal(subject);
  if (meta.removedAt) return { status: "removed", original: null };
  if (!row?.sealed) return { status: row?.removedAt ? "removed" : "not_stored", original: null };
  const original = openOrNull<OriginalPayload>(row.sealed, aad.original(subject), subject);
  return original ? { status: "stored", original } : { status: "unreadable", original: null };
}

/** GET /api/v1/verdicts/{id}/mine */
export function mineHandler(req: Request, id: string): Promise<NextResponse> {
  return guarded("mine", async () => {
    const o = await ownerOf(req, id, false);
    if ("response" in o) return o.response;
    const { meta, via, viewer, caseParty } = o;
    const suggested = { a: firstNameOf(viewer?.user.name) };
    const caseRemoved = caseParty?.row.removedAt ?? null;
    const removedAt = meta.removedAt ?? caseRemoved;
    const base = {
      id: meta.verdictId,
      kind: meta.kind,
      createdAt: meta.createdAt,
      suggested,
      case: caseParty ? { id: caseParty.row.id, party: caseParty.party } : null,
      via,
      namesConfirmed: meta.namesConfirmed,
    };
    if (removedAt) {
      const body: MineResponse = {
        ...base,
        result: null,
        original: null,
        originalStatus: "removed",
        nameMap: [],
        display: HIDDEN,
        removed: { at: removedAt, reason: meta.removalReason },
      };
      return json(body);
    }
    const stored = await getVerdict(meta.verdictId);
    if (!stored) return fail("not_found");
    if (caseParty) {
      const own = await partyOriginals(caseParty.row, caseParty.party);
      const body: MineResponse = {
        ...base,
        result: stored.result,
        original: null,
        originalStatus: own.side.status,
        nameMap: own.names ?? [],
        display: { ...caseDisplayNames(caseParty.row, caseParty.party, true), others: {}, namesVisible: caseParty.row.namesVisible },
        removed: null,
      };
      return json(body);
    }
    const { status, original } = await originalOf(meta);
    const body: MineResponse = {
      ...base,
      result: stored.result,
      original,
      originalStatus: status,
      nameMap: original?.nameMap ?? [],
      display: displayState(meta),
      removed: null,
    };
    return json(body);
  });
}

/** PATCH /api/v1/verdicts/{id}/display */
export function displayHandler(req: Request, id: string): Promise<NextResponse> {
  return guarded("display", async () => {
    const read = await readJson(req);
    if (!read.ok) return fail("invalid", "Invalid JSON body");
    const parsed = VerdictDisplayPatch.safeParse(read.body);
    if (!parsed.success) return fail("invalid", parsed.error.issues[0]?.message ?? "Invalid request");
    const o = await ownerOf(req, id, true);
    if ("response" in o) return o.response;
    if (o.caseParty) return fail("case_closed", "Change a case's names on the case page.");
    const { meta } = o;
    if (meta.removedAt) return fail("removed");
    const p = parsed.data;
    const touchesNames = p.a !== undefined || p.b !== undefined || p.others !== undefined;
    let sealed: { sealed: string; kid: string } | null = null;
    const current = displayState(meta);
    const next: DisplayState = { ...current, others: { ...current.others } };
    if (p.namesVisible !== undefined) next.namesVisible = p.namesVisible;
    if (touchesNames) {
      if (!originalsKeyState().ok) return fail("names_unavailable");
      if (p.a !== undefined) next.a = p.a;
      if (p.b !== undefined) next.b = p.b;
      for (const [label, name] of Object.entries(p.others ?? {})) {
        if (name) next.others[label] = name;
        else delete next.others[label];
      }
      sealed = sealJson({ a: next.a, b: next.b, others: next.others }, aad.verdictDisplay(meta.verdictId));
      if (!sealed) return fail("names_unavailable");
    }
    await originalsDb();
    const nowIso = new Date().toISOString();
    const rs = await entitlementWriteBatch([
      {
        sql: touchesNames
          ? `UPDATE verdict_meta SET display_sealed = ?, display_key_id = ?, names_visible = ?,
               names_confirmed_at = COALESCE(names_confirmed_at, ?), updated_at = ?
             WHERE verdict_id = ? AND removed_at IS NULL`
          : `UPDATE verdict_meta SET names_visible = ?, names_confirmed_at = COALESCE(names_confirmed_at, ?), updated_at = ?
             WHERE verdict_id = ? AND removed_at IS NULL`,
        args: touchesNames
          ? [sealed!.sealed, sealed!.kid, next.namesVisible ? 1 : 0, nowIso, nowIso, meta.verdictId]
          : [next.namesVisible ? 1 : 0, nowIso, nowIso, meta.verdictId],
      },
    ]);
    if (rs[0].rowsAffected !== 1) return fail("removed");
    const body: DisplayResponse = { display: next, namesConfirmed: true };
    return json(body);
  });
}

/** POST /api/v1/verdicts/{id}/removal { confirm: "remove" } */
export function removalHandler(req: Request, id: string): Promise<NextResponse> {
  return guarded("removal", async () => {
    const read = await readJson(req);
    if (!read.ok) return fail("invalid", "Invalid JSON body");
    if (!RemovalRequest.safeParse(read.body).success) return fail("invalid", 'Send { "confirm": "remove" } to remove it.');
    const o = await ownerOf(req, id, true);
    if ("response" in o) return o.response;
    if (o.caseParty) return fail("case_closed", "Remove a case's side on the case page.");
    const removedAt = await removeVerdict(o.meta, "owner");
    const body: RemovalResponse = { removed: true, removedAt };
    return json(body);
  });
}

/** POST /api/v1/verdicts/{id}/claim: a signed-in writer holding the owner
 * token keeps the verdict in their account (the token stays valid). */
export function claimHandler(req: Request, id: string): Promise<NextResponse> {
  return guarded("claim", async () => {
    const viewer = await getViewer(req);
    if (!viewer) return fail("signin_required");
    if (viewer.via === "cookie" && !isSameOrigin(req)) return fail("bad_origin");
    const o = await ownerOf(req, id, true);
    if ("response" in o) return o.response;
    if (o.caseParty) return fail("case_closed");
    if (o.meta.removedAt) return fail("removed");
    if (o.meta.ownerUserId === viewer.user.id) return json({ claimed: true });
    if (o.via !== "token" || o.meta.ownerUserId) return fail("case_closed");
    await originalsDb();
    const rs = await entitlementWriteBatch([
      {
        sql: `UPDATE verdict_meta SET owner_user_id = ?, updated_at = ?
              WHERE verdict_id = ? AND owner_user_id IS NULL AND removed_at IS NULL`,
        args: [viewer.user.id, new Date().toISOString(), o.meta.verdictId],
      },
    ]);
    if (rs[0].rowsAffected !== 1) {
      const fresh = await getVerdictMeta(o.meta.verdictId);
      return fresh?.ownerUserId === viewer.user.id ? json({ claimed: true }) : fail("case_closed");
    }
    return json({ claimed: true });
  });
}

/** GET /api/v1/me/verdicts?limit=20&before=<ISO> */
export function myVerdictsHandler(req: Request): Promise<NextResponse> {
  return guarded("list", async () => {
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
    const limited = await checkUserLimits(viewer.user.id, "verdict_owner").catch(() => null);
    if (!limited) return fail("unavailable");
    if (!limited.ok) return limitRefusal(limited);
    const rows = await listOwnerVerdicts(viewer.user.id, limit + 1, before);
    const page = rows.slice(0, limit);
    const body: OwnerVerdictListResponse = {
      verdicts: page.map((r) => {
        const removed = r.removedAt !== null;
        const original =
          removed || !r.sealed
            ? null
            : openOrNull<OriginalPayload>(r.sealed, aad.original(subjects.verdict(r.id)), subjects.verdict(r.id));
        return {
          id: r.id,
          kind: r.kind,
          createdAt: r.createdAt,
          verdict: removed ? null : (r.result?.verdict ?? null),
          headline: removed ? null : (r.result?.headline ?? null),
          nameMap: original?.nameMap ?? [],
          removed,
        };
      }),
      next: rows.length > limit ? page[page.length - 1].createdAt : null,
    };
    return json(body);
  });
}
