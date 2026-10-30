import { NextResponse } from "next/server";
import { apiErrorBody, type ApiErrorCode } from "@/lib/api-errors";
import { isSameOrigin, resolveViewer } from "@/lib/auth";
import { deadBearerResponse } from "@/lib/bearer-guard";
import { EventsCapError, insertEvents } from "@/lib/analytics/db";
import { countryOf, EventBatch } from "@/lib/analytics/validate";
import { clientIp } from "@/lib/client-ip";
import { analyticsEnabled } from "@/lib/features";
import { checkIpLimits, checkUserLimits } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const MAX_BODY_BYTES = 32 * 1024;
/** Event times further off than this are replaced by the time received. The
 * daily cap counts by event time, so a client may not date events far back. */
const MAX_AGE_MS = 60 * 60_000;
const MAX_AHEAD_MS = 10 * 60_000;

function fail(code: ApiErrorCode, error: string, status: number): NextResponse {
  return NextResponse.json(apiErrorBody(code, error), { status, headers: NO_STORE });
}

/**
 * POST /api/v1/events { context, events }: a batch of up to 50 usage events
 * from the app or the website. `context` is { platform, app_version,
 * anon_id?, device_id?, os_version?, device_model?, locale? }; each event is
 * { name, at?, props? } (lib/analytics/validate.ts). Signed in (bearer or
 * cookie), events belong to the account; signed out, `anon_id` is required.
 * Unknown names, fields or prop keys refuse the whole batch with 400; a body
 * that is not application/json, 415. No IP address or user agent is kept.
 * 204 when stored, and at once while analytics is switched off
 * (ANALYTICS_ENABLED=0). 503 once DAILY_EVENT_CAP is reached.
 */
export async function POST(req: Request): Promise<NextResponse> {
  if (!analyticsEnabled()) return new NextResponse(null, { status: 204, headers: NO_STORE });
  const { viewer, deadBearer } = await resolveViewer(req);
  if (deadBearer) return deadBearerResponse();
  if (viewer?.via === "cookie" && !isSameOrigin(req)) return fail("bad_origin", "Cross-site request refused.", 403);

  const type = req.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (type !== "application/json") return fail("unsupported_media", "Send the events as application/json.", 415);
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return fail("too_large", "Body too large.", 413);
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return fail("invalid", "Send the events as JSON.", 400);
  }
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return fail("too_large", "Body too large.", 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail("invalid", "Send the events as JSON.", 400);
  }
  const parsed = EventBatch.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail("invalid", `Invalid events: ${issue.path.join(".") || "body"}: ${issue.message}`, 400);
  }
  const { context, events } = parsed.data;
  const userId = viewer?.user.id ?? null;
  if (!userId && !context.anon_id) return fail("invalid", "Send context.anon_id when signed out.", 400);

  const limit = userId ? await checkUserLimits(userId, "events") : await checkIpLimits(clientIp(req.headers), "events");
  if (!limit.ok) {
    if (limit.code === "unavailable") return fail("unavailable", "Try again in a minute.", 503);
    return NextResponse.json(
      apiErrorBody("rate_limited", "Too many requests — try again later.", { retryAfterSec: limit.retryAfterSec }),
      { status: 429, headers: { ...NO_STORE, "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  const now = Date.now();
  const country = countryOf(req.headers);
  try {
    await insertEvents(
      events.map((e) => ({
        at: e.at != null && e.at > now - MAX_AGE_MS && e.at < now + MAX_AHEAD_MS ? e.at : now,
        userId,
        anonId: context.anon_id ?? null,
        deviceId: context.device_id ?? null,
        platform: context.platform,
        appVersion: context.app_version,
        osVersion: context.os_version ?? null,
        deviceModel: context.device_model ?? null,
        country,
        locale: context.locale ?? null,
        name: e.name,
        props: e.props && Object.keys(e.props).length ? JSON.stringify(e.props) : null,
      })),
    );
  } catch (e) {
    if (!(e instanceof EventsCapError)) {
      console.error("[events] storing events failed:", e instanceof Error ? e.message : String(e));
    }
    return fail("unavailable", "Try again later.", 503);
  }
  return new NextResponse(null, { status: 204, headers: NO_STORE });
}
