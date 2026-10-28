/**
 * GET /api/v1/me/history?limit=20&cursor=<opaque>: the signed-in account's
 * one-sided verdicts and the cases it started or answered, in one list,
 * newest first, each with its state from the viewer's side (lib/history-state).
 * The cursor is base64url JSON [at, key] of the last row returned; rows
 * with the same time are told apart by key, so a page edge never skips or
 * repeats one. Every response is `Cache-Control: no-store`. Server only.
 */

import { NextResponse } from "next/server";
import { API_ERROR_STATUS, apiErrorBody, type ApiErrorCode } from "@/lib/api-errors";
import { getViewer } from "@/lib/auth";
import { CASE_EXPIRY_DAYS, type PartyLetter } from "@/lib/case-types";
import { inviteHash, inviteToken } from "@/lib/cases/invite";
import { maybeSweepCases } from "@/lib/cases/sweep";
import { casesEnabled } from "@/lib/features";
import { caseHistoryState, excerptOf, verdictHistoryState } from "@/lib/history-state";
import { compareHistory, historyKey, type HistoryResponse, type HistoryRow } from "@/lib/history-types";
import { aad, openOrNull } from "@/lib/originals/crypto";
import { partyOriginals } from "@/lib/originals/cases";
import { subjects } from "@/lib/originals/db";
import type { OriginalPayload } from "@/lib/originals-types";
import { checkUserLimits } from "@/lib/ratelimit";
import type { NameMapping } from "@/lib/types";
import { maybeSweepVerdictJobs } from "@/lib/verdict-jobs";
import {
  historySources,
  type Cursor,
  type HistoryCaseRow,
  type HistoryJobRow,
  type HistoryVerdictRow,
} from "./db";

const NO_STORE = { "Cache-Control": "no-store" } as const;
/** Exactly what toISOString writes: the cursor is compared as text. */
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const KEY = /^[vc]:[A-Za-z0-9_-]{1,64}$/;
/** A failed one-sided job is listed this long, then drops off. */
const FAILED_JOB_MS = CASE_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

function fail(code: ApiErrorCode, error: string, retryAfterSec?: number): NextResponse {
  return NextResponse.json(apiErrorBody(code, error, retryAfterSec ? { retryAfterSec } : {}), {
    status: API_ERROR_STATUS[code],
    headers: retryAfterSec ? { ...NO_STORE, "Retry-After": String(retryAfterSec) } : NO_STORE,
  });
}

export function encodeCursor(row: Pick<HistoryRow, "kind" | "id" | "at">): string {
  return Buffer.from(JSON.stringify([row.at, historyKey(row)])).toString("base64url");
}

/** The cursor, null for none, or "invalid". */
export function decodeCursor(raw: string | null): Cursor | "invalid" {
  if (raw === null) return null;
  if (raw.length > 200) return "invalid";
  try {
    const v: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!Array.isArray(v) || v.length !== 2) return "invalid";
    const [at, key] = v as unknown[];
    if (typeof at !== "string" || typeof key !== "string" || !ISO.test(at) || !KEY.test(key)) return "invalid";
    return { at, key };
  } catch {
    return "invalid";
  }
}

function verdictRow(r: HistoryVerdictRow): HistoryRow {
  const removed = r.removedAt !== null;
  const derived = verdictHistoryState({
    job: null,
    removed,
    round: r.round,
    verdict: r.result?.verdict ?? null,
    fromRound: r.fromRound,
  });
  const subject = subjects.verdict(r.id);
  const original = removed || !r.sealed ? null : openOrNull<OriginalPayload>(r.sealed, aad.original(subject), subject);
  return {
    kind: "verdict",
    id: r.id,
    role: "owner",
    party: "a",
    at: r.at,
    createdAt: r.createdAt,
    ...derived,
    headline: removed ? null : (r.result?.headline ?? null),
    excerpt: null,
    nameMap: original?.nameMap ?? [],
    expiresAt: null,
    removed,
    inviteToken: null,
  };
}

function jobRow(r: HistoryJobRow): HistoryRow {
  return {
    kind: "verdict",
    id: r.id,
    role: "owner",
    party: "a",
    at: r.at,
    createdAt: r.at,
    ...verdictHistoryState({ job: r.status, removed: false, round: null, verdict: null, fromRound: false }),
    headline: null,
    excerpt: null,
    nameMap: [],
    expiresAt: null,
    removed: false,
    inviteToken: null,
  };
}

/** The respondent's page token, only while it still opens the case (a
 * rotated server secret derives a different one). */
function liveToken(r: HistoryCaseRow): string | null {
  const token = inviteToken(r.id, r.inviteNonce);
  return token && inviteHash(token) === r.inviteHash ? token : null;
}

async function names(r: HistoryCaseRow, party: PartyLetter): Promise<NameMapping[]> {
  try {
    return (await partyOriginals(r, party)).names ?? [];
  } catch (e) {
    console.error("[history] originals read failed:", e instanceof Error ? e.message : String(e));
    return [];
  }
}

async function caseRow(r: HistoryCaseRow, party: PartyLetter, now: Date): Promise<HistoryRow> {
  const derived = caseHistoryState(
    {
      party,
      status: r.status,
      expiresAt: r.expiresAt,
      removedA: r.removedAAt !== null,
      removedB: r.removedBAt !== null,
      appeals: r.appeals,
      latest: r.latestResult ? { appealId: r.latestAppealId, verdict: r.latestResult.verdict } : null,
    },
    now,
  );
  const ownRemoved = derived.state === "removed";
  const token = party === "b" ? liveToken(r) : null;
  const headline = ownRemoved ? null : (r.latestResult?.headline ?? null);
  return {
    kind: "case",
    id: r.id,
    role: party === "a" ? "owner" : "respondent",
    party,
    at: r.at,
    createdAt: r.createdAt,
    ...derived,
    removable: derived.removable && (party === "a" || token !== null),
    headline,
    excerpt: ownRemoved || headline ? null : excerptOf(r.sideStart),
    nameMap: ownRemoved ? [] : await names(r, party),
    expiresAt: derived.state === "waiting" ? r.expiresAt : null,
    removed: r.removedAt !== null,
    inviteToken: token,
  };
}

/** GET /api/v1/me/history */
export function historyHandler(req: Request): Promise<NextResponse> {
  return (async () => {
    const viewer = await getViewer(req);
    if (!viewer) return fail("signin_required", "Sign in first.");
    const params = new URL(req.url).searchParams;
    const rawLimit = params.get("limit");
    const limit = rawLimit === null ? 20 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) return fail("invalid", "limit must be 1 to 50");
    const cursor = decodeCursor(params.get("cursor"));
    if (cursor === "invalid") return fail("invalid", "cursor is not one this list gave out");
    const userId = viewer.user.id;
    const limited = await checkUserLimits(userId, "history_list").catch(() => null);
    if (!limited) return fail("unavailable", "Verdicts are unavailable right now — try again in a minute.");
    if (!limited.ok) {
      if (limited.code === "unavailable") return fail("unavailable", "Verdicts are unavailable right now — try again in a minute.");
      return fail("rate_limited", "Too many requests — take a breather and try again later.", limited.retryAfterSec);
    }

    const cases = casesEnabled();
    await Promise.all([cases ? maybeSweepCases() : null, maybeSweepVerdictJobs()]);
    const now = new Date();
    const take = limit + 1;
    const failedSince = new Date(now.getTime() - FAILED_JOB_MS).toISOString();
    const { verdicts, jobs, started, answered } = await historySources(userId, {
      failedSince,
      limit: take,
      cursor,
      cases,
    });
    // Each source holds its own newest limit+1, so the newest limit of the
    // union are all here.
    const merged = [
      ...verdicts.map((r) => ({ kind: "verdict" as const, id: r.id, at: r.at, build: () => verdictRow(r) })),
      ...jobs.map((r) => ({ kind: "verdict" as const, id: r.id, at: r.at, build: () => jobRow(r) })),
      ...started.map((r) => ({ kind: "case" as const, id: r.id, at: r.at, build: () => caseRow(r, "a", now) })),
      ...answered.map((r) => ({ kind: "case" as const, id: r.id, at: r.at, build: () => caseRow(r, "b", now) })),
    ].sort(compareHistory);
    const page = merged.slice(0, limit);
    const items = await Promise.all(page.map((x) => x.build()));
    const body: HistoryResponse = {
      items,
      next: merged.length > limit ? encodeCursor(page[page.length - 1]) : null,
    };
    return NextResponse.json(body, { headers: NO_STORE });
  })().catch((e: unknown) => {
    console.error("[history] list failed:", e instanceof Error ? e.message : String(e));
    return fail("unavailable", "Verdicts are unavailable right now — try again in a minute.");
  });
}
