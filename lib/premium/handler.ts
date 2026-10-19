/**
 * HTTP handlers for premium: POST /api/v1/verdict with tier "premium" (the
 * verdict route hands those requests here) and POST /api/v1/clarify.
 *
 * Premium gate order: Idempotency-Key format, session, same-origin (cookie
 * sessions only; bearer requests cannot be forged cross-site), configured,
 * per-user limit, site-wide daily cap, then the credit reservation. Every
 * failure after the reservation refunds it; a stored verdict consumes it
 * exactly once. Turnstile is not used here: the signed-in account and the
 * per-user limit are the gate, and native apps cannot render it.
 */

import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import type { Entitlement } from "@/lib/account-types";
import { API_ERROR_STATUS, apiErrorBody, type ApiErrorBody, type ApiErrorCode } from "@/lib/api-errors";
import { getViewer, isSameOrigin, premiumEnabled } from "@/lib/auth";
import { getVerdict, saveVerdict } from "@/lib/db";
import {
  consumePremiumVerdict,
  getEntitlement,
  refundPremiumVerdict,
  reservePremiumVerdict,
  type ReserveResult,
} from "@/lib/entitlements";
import { checkPremiumSiteCap, checkUserLimits, type UserBucket } from "@/lib/ratelimit";
import { ClarifyRequest, type VerdictApiResponse, type VerdictRequest } from "@/lib/types";
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

type Gate = { userId: string } | { response: NextResponse };

/** Session, origin and configuration checks shared by both handlers. */
async function signedInGate(req: Request): Promise<Gate> {
  const viewer = await getViewer(req);
  if (!viewer) return { response: fail("signin_required", "Sign in to use Premium.") };
  if (viewer.via === "cookie" && !isSameOrigin(req)) {
    return { response: fail("bad_origin", "This request came from another site.") };
  }
  if (!premiumEnabled()) {
    return { response: fail("not_configured", "Premium is not available on this server right now.") };
  }
  return { userId: viewer.user.id };
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

async function replay(userId: string, verdictId: string): Promise<NextResponse> {
  const stored = await getVerdict(verdictId).catch(() => null);
  if (!stored) return unavailable();
  const entitlement = await entitlementOrNull(userId);
  const body: VerdictApiResponse = {
    id: stored.id,
    result: stored.result,
    name_map: [],
    replayed: true,
    ...(entitlement ? { entitlement } : {}),
  };
  return NextResponse.json(body);
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

/** POST /api/v1/verdict with tier "premium". `data` is the parsed body. */
export async function premiumVerdict(req: Request, data: VerdictRequest): Promise<NextResponse> {
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

  let reserved: ReserveResult;
  try {
    reserved = await reservePremiumVerdict(userId, key ? { idempotencyKey: key } : {});
  } catch (e) {
    console.error("[premium] reserve failed:", e instanceof Error ? e.message : String(e));
    return unavailable();
  }
  if (!reserved.ok) {
    if (reserved.code === "replay") return replay(userId, reserved.verdictId);
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

  let run: PremiumRun | undefined;
  try {
    run = await runPremiumPipeline(
      {
        argument: data.argument,
        clarifications: data.clarifications,
        framework: data.framework,
        lang: data.lang,
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
    try {
      await saveVerdict({ id, input: outcome.input, framework: data.framework, result: outcome.result });
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
