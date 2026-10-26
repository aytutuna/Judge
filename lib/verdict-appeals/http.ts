/**
 * POST /api/v1/verdicts/{id}/appeals, and what GET /api/v1/verdicts/{id}
 * says about appeals. Gate order as a case appeal (lib/cases/http): body,
 * session, origin, per-user limit, Premium switch and site cap, the verdict
 * (404 unless it is the signed-in account's own one-sided verdict: one
 * written signed out is claimed first), evidence, then the unit. The answer
 * is 202 with the round to poll. Server only.
 */

import { NextResponse } from "next/server";
import { AppealRequest, MAX_EVIDENCE_PER_APPEAL, type AppealBlock } from "@/lib/case-types";
import {
  blocked,
  entitlementOrNull,
  fail,
  guarded,
  invalidBody,
  limitGate,
  premiumAppealBlock,
  rawField,
  readJson,
  signedIn,
  verifyEvidence,
} from "@/lib/cases/http";
import { acceptedHeaders, pollPath } from "@/lib/free-async";
import { getVerdictMeta, type VerdictMeta } from "@/lib/originals/db";
import { idempotencyKey } from "@/lib/premium/context";
import type { VerdictAppealView } from "@/lib/types";
import { POLL_AFTER_MS, type VerdictAppealResponse } from "@/lib/verdict-poll";
import { appealRootOf, appealView, listVerdictAppeals, roundsBlock, submitVerdictAppeal } from "./service";

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const NOT_FOUND = "No verdict of yours with that id.";

const oneSided = (meta: VerdictMeta) => meta.kind === "free" || meta.kind === "premium";

/** The signed-in account's own one-sided verdict (never a round's verdict). */
async function ownedVerdict(id: string, userId: string): Promise<"ok" | "removed" | "not_found"> {
  if (!ID_PATTERN.test(id)) return "not_found";
  const meta = await getVerdictMeta(id);
  if (!meta || !oneSided(meta) || meta.ownerUserId !== userId) return "not_found";
  if (await appealRootOf(id)) return "not_found";
  return meta.removedAt ? "removed" : "ok";
}

/** POST /api/v1/verdicts/{id}/appeals: the writer adds context. */
export function verdictAppealHandler(req: Request, id: string): Promise<NextResponse> {
  return guarded("verdict appeal", async () => {
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
    const owned = await ownedVerdict(id, userId);
    if (owned === "not_found") return fail("not_found", NOT_FOUND);
    if (owned === "removed") return fail("removed", "This verdict was removed. Its link no longer works.");

    const ev = verifyEvidence(parsed.data.evidence, [{ type: "user", userId }], MAX_EVIDENCE_PER_APPEAL);
    if ("response" in ev) return ev.response;
    const res = await submitVerdictAppeal({
      verdictId: id,
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
          return fail("in_progress", "The judges are already re-judging this verdict.");
        case "appeal_limit":
          return fail("appeal_limit", "This verdict already took context twice.");
        case "not_found":
          return fail("not_found", NOT_FOUND);
        case "unavailable":
          return fail("unavailable", "The judge is unavailable right now — try again in a minute.");
        default:
          return fail(res.code);
      }
    }
    const [appeals, entitlement] = await Promise.all([listVerdictAppeals(id), entitlementOrNull(userId)]);
    const body: VerdictAppealResponse = {
      appeal: appealView(res.appeal, true),
      appeals: appeals.map((a) => appealView(a, true)),
      poll: pollPath(res.appeal.id),
      pollAfterMs: POLL_AFTER_MS,
      name_map: res.nameMap,
      ...(entitlement ? { entitlement } : {}),
      ...(res.replayed ? { replayed: true } : {}),
    };
    return NextResponse.json(body, { status: 202, headers: acceptedHeaders(res.appeal.id) });
  });
}

/**
 * What GET /api/v1/verdicts/{id} adds for a one-sided verdict: its rounds
 * (with their text for the writer only) and, for the writer, whether they
 * may add context now. `writer` is null for everyone else; its `viewerId`
 * is the signed-in account, if any (a writer holding only the owner token
 * signs in first, then claims). Empty for case verdicts and for the
 * verdicts rounds produced. Fails open to empty.
 */
export async function verdictAppealState(
  meta: VerdictMeta,
  writer: { viewerId: string | null } | null,
): Promise<{ appeals?: VerdictAppealView[]; appeal?: { allowed: boolean; blockedBy: AppealBlock | null } }> {
  if (!oneSided(meta)) return {};
  try {
    const [appeals, root] = await Promise.all([listVerdictAppeals(meta.verdictId), appealRootOf(meta.verdictId)]);
    if (root) return {};
    const views = appeals.map((a) => appealView(a, writer !== null));
    if (!writer) return { appeals: views };
    let blockedBy: AppealBlock | null;
    if (!writer.viewerId) blockedBy = "signin_required";
    // Claiming only to be told no afterwards would move the verdict for nothing.
    else if (writer.viewerId !== meta.ownerUserId)
      blockedBy = meta.ownerUserId ? "not_party" : ((await premiumAppealBlock(writer.viewerId)) ?? "claim_required");
    else blockedBy = roundsBlock(appeals) ?? (await premiumAppealBlock(writer.viewerId));
    return { appeals: views, appeal: { allowed: blockedBy === null, blockedBy } };
  } catch (e) {
    console.error("[verdict-appeals] state read failed:", e instanceof Error ? e.message : String(e));
    return {};
  }
}
