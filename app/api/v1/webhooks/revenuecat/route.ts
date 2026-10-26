import { NextResponse } from "next/server";
import { apiErrorBody, type ApiErrorCode } from "@/lib/api-errors";
import { authConfigured, findExistingUserId } from "@/lib/auth";
import { clientIp } from "@/lib/client-ip";
import { applyStoreEvent, type StoreEvent } from "@/lib/entitlements";
import { checkIpLimits } from "@/lib/ratelimit";
import {
  mapRevenueCatEvent,
  revenueCatAuthorized,
  revenueCatWebhookSecret,
  sandboxPurchasesAllowed,
  type IgnoreReason,
} from "@/lib/revenuecat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;
/** Real events are a few KB (subscriber attributes included). */
const MAX_BODY_BYTES = 256 * 1024;

function fail(code: ApiErrorCode, error: string, status: number, headers: Record<string, string> = {}): NextResponse {
  return NextResponse.json(apiErrorBody(code, error), { status, headers: { ...NO_STORE, ...headers } });
}

class TooLarge extends Error {}

/** The body as text, abandoned past `limit` bytes whatever Content-Length says. */
async function readCappedText(req: Request, limit: number): Promise<string> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      throw new TooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const logSafe = (v: string) => v.replace(/[^A-Za-z0-9_.:-]/g, "?").slice(0, 80);

function ignoredResponse(type: string, id: string, reason: IgnoreReason): NextResponse {
  console.info(`[revenuecat] ignored type=${type} id=${id} reason=${reason}`);
  return NextResponse.json({ ok: true, ignored: true, reason }, { headers: NO_STORE });
}

/**
 * POST /api/v1/webhooks/revenuecat: RevenueCat purchase events. Checked
 * against REVENUECAT_WEBHOOK_SECRET (the dashboard's Authorization header
 * value, `Bearer <secret>`), mapped by lib/revenuecat.ts and applied with
 * applyStoreEvent(), which grants each purchase at most once (retries and
 * replays change nothing).
 *
 * 200 for every event it has decided about, applied or ignored, so RevenueCat
 * stops retrying; 401 bad secret (checked before the per-IP limit, so forged
 * requests cannot use up RevenueCat's allowance); 429 over the limit; 503 not
 * configured or the database/limit store failing (RevenueCat retries for
 * about 80 minutes); 400/413 malformed.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const secret = revenueCatWebhookSecret();
  if (!secret || !authConfigured()) {
    return fail("not_configured", "Purchase webhooks are not set up on this server.", 503);
  }

  if (!revenueCatAuthorized(req.headers.get("authorization"), secret)) {
    return fail("signin_required", "Unauthorized.", 401);
  }

  const limit = await checkIpLimits(clientIp(req.headers), "revenuecat_webhook");
  if (!limit.ok) {
    if (limit.code === "unavailable") return fail("unavailable", "Try again in a minute.", 503);
    return NextResponse.json(
      apiErrorBody("rate_limited", "Too many requests — try again later.", { retryAfterSec: limit.retryAfterSec }),
      { status: 429, headers: { ...NO_STORE, "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return fail("too_large", "Body too large.", 413);
  let body: unknown;
  try {
    body = JSON.parse(await readCappedText(req, MAX_BODY_BYTES));
  } catch (e) {
    if (e instanceof TooLarge) return fail("too_large", "Body too large.", 413);
    return fail("invalid", "Send a RevenueCat webhook event as JSON.", 400);
  }

  const outcome = mapRevenueCatEvent(body, { allowSandbox: sandboxPurchasesAllowed() });
  if (outcome.kind === "invalid") return fail("invalid", "Not a RevenueCat webhook event.", 400);

  // For logs only: event fields are sender-controlled text.
  const raw = (body as { event: { type: string; id: string } }).event;
  const type = logSafe(raw.type);
  const id = logSafe(raw.id);
  if (outcome.kind === "test") {
    console.info(`[revenuecat] test event id=${id}`);
    return NextResponse.json({ ok: true, test: true }, { headers: NO_STORE });
  }
  if (outcome.kind === "ignored") return ignoredResponse(type, id, outcome.reason);

  let event: StoreEvent;
  try {
    if (outcome.kind === "grant") {
      const userId = await findExistingUserId(outcome.userIds);
      if (!userId) return ignoredResponse(type, id, "unknown_user");
      event = outcome.event(userId);
    } else {
      event = outcome.event;
    }
    const { applied } = await applyStoreEvent(event);
    console.info(`[revenuecat] type=${type} id=${id} action=${event.type} source=${event.source} applied=${applied}`);
    return NextResponse.json({ ok: true, applied, action: event.type }, { headers: NO_STORE });
  } catch (e) {
    console.error(
      `[revenuecat] applying type=${type} id=${id} failed:`,
      e instanceof Error ? e.message.slice(0, 200) : String(e),
    );
    return fail("unavailable", "Could not apply the event right now.", 503);
  }
}
