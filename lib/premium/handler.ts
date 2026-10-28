/**
 * HTTP handlers for premium: POST /api/v1/verdict (the verdict route hands
 * every request here; there is no other tier) and POST /api/v1/clarify.
 *
 * Premium gate order: Idempotency-Key format, session, same-origin (cookie
 * sessions only; bearer requests cannot be forged cross-site), configured,
 * per-user limit, site-wide daily cap, evidence tokens (when sent), then the
 * credit reservation. Every
 * failure after the reservation refunds it; a stored verdict consumes it
 * exactly once. Turnstile is not used here: the signed-in account and the
 * per-user limit are the gate, and native apps cannot render it.
 *
 * Async verdicts (`Prefer: respond-async`): every gate, the reservation and
 * the anonymization stay in the request; then the verdict is judged in the
 * background (./async) and the request answers 202 with the job id.
 */

import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import type { Entitlement } from "@/lib/account-types";
import { API_ERROR_STATUS, apiErrorBody, type ApiErrorBody, type ApiErrorCode } from "@/lib/api-errors";
import { isSameOrigin, premiumEnabled, resolveViewer } from "@/lib/auth";
import { getVerdict } from "@/lib/db";
import {
  consumePremiumVerdict,
  getEntitlement,
  refundPremiumVerdict,
  reservePremiumVerdict,
  type ReserveResult,
} from "@/lib/entitlements";
import { MAX_EVIDENCE_PER_SIDE } from "@/lib/case-types";
import type { VerifiedEvidence } from "@/lib/evidence";
import { evidenceEnabled } from "@/lib/features";
import { firstNameOf } from "@/lib/originals-types";
import { saveVerdictWithOriginals } from "@/lib/originals/save";
import { checkPremiumSiteCap, checkUserLimits, type UserBucket } from "@/lib/ratelimit";
import { ClarifyRequest, type VerdictApiResponse, type VerdictRequest } from "@/lib/types";
import { acceptedHeaders, POLL_AFTER_MS, pollPath, wantsAsync, type VerdictAcceptedResponse } from "@/lib/verdict-poll";
import { clarifyQuestions } from "./clarify";
import { idempotencyKey } from "./context";
import { premiumLogLine, runPremiumPipeline, type PremiumRun } from "./run";

const UNAVAILABLE_MESSAGE = "The judge is unavailable right now — try again in a minute.";

const BLOCK_MESSAGES = {
  premium_required: "Premium verdicts need credits or a monthly plan.",
  no_credits: "You have no premium credits left.",
  fair_use: "You have used this month's premium verdicts.",
} as const;

function fail(
  code: ApiErrorCode,
  error: string,
  opts: { status?: number; retryAfterSec?: number; resetsAt?: string } = {},
): NextResponse {
  const extra: Omit<ApiErrorBody, "code" | "error"> = {};
  if (opts.retryAfterSec !== undefined) extra.retryAfterSec = opts.retryAfterSec;
  if (opts.resetsAt !== undefined) extra.resetsAt = opts.resetsAt;
  return NextResponse.json(apiErrorBody(code, error, extra), {
    status: opts.status ?? API_ERROR_STATUS[code],
    headers: opts.retryAfterSec !== undefined ? { "Retry-After": String(opts.retryAfterSec) } : undefined,
  });
}

function unavailable(status = 503): NextResponse {
  return fail("unavailable", UNAVAILABLE_MESSAGE, { status });
}

type Gate = { userId: string; name: string } | { response: NextResponse };

/** Session, origin and configuration checks shared by both handlers. A
 * failed session lookup is a 503, not signin_required: the apps drop their
 * token on that code. */
async function signedInGate(req: Request): Promise<Gate> {
  const { viewer, failed } = await resolveViewer(req);
  if (failed) return { response: unavailable() };
  if (!viewer) return { response: fail("signin_required", "Sign in to get a verdict.") };
  if (viewer.via === "cookie" && !isSameOrigin(req)) {
    return { response: fail("bad_origin", "This request came from another site.") };
  }
  if (!premiumEnabled()) {
    return { response: fail("not_configured", "Premium is not available on this server right now.") };
  }
  return { userId: viewer.user.id, name: viewer.user.name };
}

/** The per-user limit for `bucket`, plus the site-wide daily cap for
 * verdicts. Null when the request may go on. Fails closed. */
async function limitGate(userId: string, bucket: UserBucket): Promise<NextResponse | null> {
  try {
    const user = await checkUserLimits(userId, bucket);
    if (!user.ok) {
      if (user.code === "unavailable") return unavailable();
      return user.code === "daily_cap"
        ? fail("daily_cap", "Premium has used today's capacity — try again tomorrow.", { retryAfterSec: user.retryAfterSec })
        : fail("rate_limited", "Too many requests from your account — take a breather and try again later.", {
            retryAfterSec: user.retryAfterSec,
          });
    }
    if (bucket !== "premium_verdict") return null;
    const site = await checkPremiumSiteCap();
    if (!site.ok) {
      if (site.code === "unavailable") return unavailable();
      return fail("daily_cap", "Premium has used today's capacity — try again tomorrow.", {
        retryAfterSec: site.retryAfterSec,
      });
    }
    return null;
  } catch (e) {
    console.error("[premium] limit check failed:", e instanceof Error ? e.message : String(e));
    return unavailable();
  }
}

function blocked(code: keyof typeof BLOCK_MESSAGES, resetsAt?: string | null): NextResponse {
  return fail(code, BLOCK_MESSAGES[code], resetsAt ? { resetsAt } : {});
}

async function entitlementOrNull(userId: string): Promise<Entitlement | null> {
  try {
    return await getEntitlement(userId);
  } catch (e) {
    console.error("[premium] entitlement read failed:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

/** The request-validation error, mapped like the free route does. */
function invalidBody(issue: { message?: string; path: PropertyKey[]; code: string } | undefined): NextResponse {
  const onArgument = issue?.path[0] === "argument";
  const code: ApiErrorCode =
    onArgument && issue?.code === "too_small" ? "too_short" : onArgument && issue?.code === "too_big" ? "too_long" : "invalid";
  return fail(code, issue?.message ?? "Invalid request");
}

/** Ownership, originals status and display names of a stored verdict, for
 * a replayed response. Empty when unreadable. */
async function storedOwnership(verdictId: string): Promise<Pick<VerdictApiResponse, "originals_stored" | "display">> {
  try {
    const { getOriginal, getVerdictMeta, subjects } = await import("@/lib/originals/db");
    const { openVerdictDisplay } = await import("@/lib/originals/display");
    const meta = await getVerdictMeta(verdictId);
    if (!meta) return {};
    const original = await getOriginal(subjects.verdict(verdictId));
    return {
      originals_stored: Boolean(original?.sealed),
      display: { ...openVerdictDisplay(meta), namesVisible: meta.namesVisible },
    };
  } catch (e) {
    console.error("[premium] ownership read failed:", e instanceof Error ? e.message : String(e));
    return {};
  }
}

async function replay(userId: string, verdictId: string): Promise<NextResponse> {
  const stored = await getVerdict(verdictId).catch(() => null);
  if (!stored) return unavailable();
  const entitlement = await entitlementOrNull(userId);
  const body: VerdictApiResponse = {
    id: stored.id,
    result: stored.result,
    name_map: [],
    replayed: true,
    ...(await storedOwnership(verdictId)),
    ...(entitlement ? { entitlement } : {}),
  };
  return NextResponse.json(body);
}

/** The argument exactly as sent (before trimming), for the encrypted original. */
function rawArgumentOf(body: unknown, fallback: string): string {
  if (typeof body !== "object" || body === null) return fallback;
  const raw = (body as { argument?: unknown }).argument;
  return typeof raw === "string" ? raw : fallback;
}

/** Clarifications exactly as sent, skipped answers kept as "". */
function rawClarificationsOf(body: unknown, fallback: VerdictRequest["clarifications"]): { question: string; answer: string }[] {
  const raw = typeof body === "object" && body !== null ? (body as { clarifications?: unknown }).clarifications : undefined;
  if (Array.isArray(raw)) {
    return raw
      .filter((c): c is { question: unknown; answer: unknown } => typeof c === "object" && c !== null)
      .map((c) => ({
        question: typeof c.question === "string" ? c.question : "",
        answer: typeof c.answer === "string" ? c.answer : "",
      }));
  }
  return (fallback ?? []).map((c) => ({ question: c.question, answer: c.answer }));
}

function reserveRefusal(res: Exclude<ReserveResult, { ok: true }>): NextResponse | null {
  switch (res.code) {
    case "premium_required":
    case "no_credits":
    case "fair_use":
      return blocked(res.code, "resetsAt" in res ? res.resetsAt : undefined);
    case "in_progress":
      return fail("in_progress", "This verdict is already being judged.");
    default:
      return null;
  }
}

/** POST /api/v1/verdict. `data` is the parsed body;
 * `rawBody` the body as sent (the original is stored exactly as written). */
export async function premiumVerdict(req: Request, data: VerdictRequest, rawBody?: unknown): Promise<NextResponse> {
  const startedAt = Date.now();
  const key = idempotencyKey(req.headers);
  if (key === null) {
    return fail("invalid", "Idempotency-Key must be 1 to 64 letters, digits, '_' or '-'.");
  }

  const gate = await signedInGate(req);
  if ("response" in gate) return gate.response;
  const { userId } = gate;

  const limited = await limitGate(userId, "premium_verdict");
  if (limited) return limited;

  // Evidence tokens are checked before any unit is reserved. Loaded only
  // when sent, so a request without evidence runs exactly as before.
  let evidence: VerifiedEvidence[] | undefined;
  if (data.evidence && data.evidence.length > 0) {
    if (!evidenceEnabled()) {
      return fail("evidence_invalid", "Screenshot evidence is not available on this server right now.");
    }
    try {
      const { verifyEvidenceTokens } = await import("@/lib/evidence");
      const verified = verifyEvidenceTokens(data.evidence, { type: "user", userId }, MAX_EVIDENCE_PER_SIDE);
      if (!verified.ok) {
        return verified.code === "too_many_files"
          ? fail("too_many_files", `Attach at most ${MAX_EVIDENCE_PER_SIDE} images.`)
          : fail("evidence_invalid", "An evidence image expired or could not be verified. Add it again.");
      }
      evidence = verified.items;
    } catch (e) {
      console.error("[premium] evidence check failed:", e instanceof Error ? e.message : String(e));
      return unavailable();
    }
  }

  let reserved: ReserveResult;
  try {
    reserved = await reservePremiumVerdict(userId, key ? { idempotencyKey: key } : {});
  } catch (e) {
    console.error("[premium] reserve failed:", e instanceof Error ? e.message : String(e));
    return unavailable();
  }
  const asyncMode = wantsAsync(req.headers, rawBody);
  if (!reserved.ok) {
    if (reserved.code === "replay") return replay(userId, reserved.verdictId);
    if (reserved.code === "in_progress" && asyncMode && key) {
      const joined = await joinJudging(userId, key);
      if (joined) return joined;
    }
    return reserveRefusal(reserved) ?? unavailable();
  }

  const reservationId = reserved.reservation.id;
  let settled = false;
  const refund = async () => {
    if (settled) return;
    settled = true;
    try {
      await refundPremiumVerdict(reservationId);
    } catch (e) {
      console.error("[premium] refund failed:", e instanceof Error ? e.message : String(e));
    }
  };

  if (asyncMode) {
    return startPremiumJob({ data, rawBody, userId, name: gate.name, reservationId, evidence, startedAt, refund });
  }

  let run: PremiumRun | undefined;
  try {
    run = await runPremiumPipeline(
      {
        argument: data.argument,
        clarifications: data.clarifications,
        framework: data.framework,
        lang: data.lang,
        ...(evidence ? { evidence } : {}),
      },
      { startedAt },
    );
    const outcome = run.outcome;
    if (outcome.status === "anonymize_failed") {
      await refund();
      console.error("[premium] anonymize failed:", outcome.error);
      console.info(premiumLogLine(null, "anonymize_failed", run));
      return unavailable();
    }
    if (outcome.status === "failed") {
      await refund();
      console.error("[premium] all judge runs failed:", outcome.error);
      console.info(premiumLogLine(null, outcome.code, run));
      return outcome.code === "quota"
        ? fail("quota", "The judge hit its AI quota for now — try again in a few minutes.", { status: 502 })
        : unavailable(502);
    }

    const id = nanoid(10);
    let saved;
    try {
      saved = await saveVerdictWithOriginals({
        id,
        input: outcome.input,
        framework: data.framework,
        result: outcome.result,
        kind: "premium",
        ownerUserId: userId,
        original: {
          v: 1,
          text: rawArgumentOf(rawBody, data.argument),
          clarifications: rawClarificationsOf(rawBody, data.clarifications),
          ...(evidence?.length ? { evidence: evidence.map((e) => ({ kind: e.kind, transcript: e.transcript })) } : {}),
          nameMap: outcome.nameMap,
        },
      });
    } catch (e) {
      await refund();
      console.error("[premium] saving failed:", e instanceof Error ? e.message : String(e));
      console.info(premiumLogLine(null, "save_failed", run));
      return unavailable();
    }

    if (outcome.refused || outcome.degraded) {
      // The model declined, or every strong seat failed and the verdict
      // rests on Haiku alone: the user gets the result, not a charge.
      await refund();
    } else {
      settled = true;
      try {
        await consumePremiumVerdict(reservationId, id);
      } catch (e) {
        // The verdict exists; a reservation left open is refunded by the
        // stale sweep, so the user is never charged twice.
        console.error("[premium] consume failed:", e instanceof Error ? e.message : String(e));
      }
    }

    const entitlement = await entitlementOrNull(userId);
    console.info(premiumLogLine(id, outcome.refused ? "refused" : outcome.degraded ? "degraded" : "ok", run));
    const body: VerdictApiResponse = {
      id,
      result: outcome.result,
      name_map: outcome.nameMap,
      originals_stored: saved.originalsStored,
      ...(saved.metaWritten ? { display: saved.display } : {}),
      suggested_display_a: firstNameOf(gate.name),
      ...(entitlement ? { entitlement } : {}),
    };
    return NextResponse.json(body);
  } catch (e) {
    await refund();
    console.error("[premium] verdict failed:", e instanceof Error ? e.message : String(e));
    if (run) console.info(premiumLogLine(null, "error", run));
    return unavailable();
  }
}

/** In async mode, a retry whose Idempotency-Key is still being judged
 * joins that verdict (202, empty name_map) instead of answering in_progress.
 * Null when no async job holds the key (e.g. a waiting synchronous request). */
async function joinJudging(userId: string, key: string): Promise<NextResponse | null> {
  try {
    const { judgingJobForKey } = await import("@/lib/verdict-jobs");
    const job = await judgingJobForKey(userId, key);
    if (!job) return null;
    const entitlement = await entitlementOrNull(userId);
    const body: VerdictAcceptedResponse = {
      id: job.id,
      status: "judging",
      pollAfterMs: POLL_AFTER_MS,
      poll: pollPath(job.id),
      name_map: [],
      replayed: true,
      ...(entitlement ? { entitlement } : {}),
    };
    return NextResponse.json(body, { status: 202, headers: acceptedHeaders(job.id) });
  } catch (e) {
    console.error("[premium] job lookup failed:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

/**
 * The async premium verdict, after the reservation: anonymize inside the
 * request (fail closed, refunded, 503 as on the synchronous path), start the
 * job, answer 202 and judge in the background (./async). The deadline gates
 * still count from the request's start.
 */
async function startPremiumJob(p: {
  data: VerdictRequest;
  rawBody: unknown;
  userId: string;
  name: string;
  reservationId: string;
  evidence: VerifiedEvidence[] | undefined;
  startedAt: number;
  refund: () => Promise<void>;
}): Promise<NextResponse> {
  const { data, userId, evidence } = p;
  const { withUsageMeter } = await import("@/lib/claude");
  const { preparePremium } = await import("./run");
  let anonymized;
  try {
    anonymized = await withUsageMeter(() =>
      preparePremium({
        argument: data.argument,
        clarifications: data.clarifications,
        lang: data.lang,
        ...(evidence ? { evidence } : {}),
      }),
    );
  } catch (e) {
    await p.refund();
    console.error("[premium] anonymize failed:", e instanceof Error ? e.message : String(e));
    return unavailable();
  }
  const prepared = anonymized.value;
  if (!prepared.ok) {
    await p.refund();
    console.error("[premium] anonymize failed:", prepared.error);
    return unavailable();
  }

  const id = nanoid(10);
  try {
    const { createVerdictJob } = await import("@/lib/verdict-jobs");
    await createVerdictJob({ id, kind: "premium", reservationId: p.reservationId, ownerUserId: userId });
  } catch (e) {
    await p.refund();
    console.error("[premium] job create failed:", e instanceof Error ? e.message : String(e));
    return unavailable();
  }

  const [{ runInBackground }, { runPremiumJob }] = await Promise.all([import("@/lib/background"), import("./async")]);
  runInBackground("premium", () =>
    runPremiumJob({
      id,
      userId,
      reservationId: p.reservationId,
      prepared: prepared.prepared,
      framework: data.framework,
      lang: data.lang,
      original: {
        v: 1,
        text: rawArgumentOf(p.rawBody, data.argument),
        clarifications: rawClarificationsOf(p.rawBody, data.clarifications),
        ...(evidence?.length ? { evidence: evidence.map((e) => ({ kind: e.kind, transcript: e.transcript })) } : {}),
        nameMap: prepared.prepared.nameMap,
      },
      startedAt: p.startedAt,
      anonymizeUsage: anonymized.usage,
    }),
  );

  const entitlement = await entitlementOrNull(userId);
  const body: VerdictAcceptedResponse = {
    id,
    status: "judging",
    pollAfterMs: POLL_AFTER_MS,
    poll: pollPath(id),
    name_map: prepared.prepared.nameMap,
    suggested_display_a: firstNameOf(p.name),
    ...(entitlement ? { entitlement } : {}),
  };
  return NextResponse.json(body, { status: 202, headers: acceptedHeaders(id) });
}

/** POST /api/v1/clarify: up to two questions before a premium verdict.
 * Needs a session that can use premium; never reserves or spends a credit. */
export async function clarifyHandler(req: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("invalid", "Invalid JSON body");
  }
  const parsed = ClarifyRequest.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error.issues[0]);

  const gate = await signedInGate(req);
  if ("response" in gate) return gate.response;
  const { userId } = gate;

  const limited = await limitGate(userId, "clarify");
  if (limited) return limited;

  let entitlement: Entitlement;
  try {
    entitlement = await getEntitlement(userId);
  } catch (e) {
    console.error("[clarify] entitlement read failed:", e instanceof Error ? e.message : String(e));
    return unavailable();
  }
  if (!entitlement.canUsePremium) {
    return blocked(entitlement.blockedReason ?? "premium_required", entitlement.resetsAt);
  }

  return NextResponse.json(await clarifyQuestions(parsed.data.argument, parsed.data.lang));
}
