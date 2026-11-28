import { NextResponse } from "next/server";
import { z } from "zod";
import { apiErrorBody, API_ERROR_STATUS, type ApiErrorCode } from "@/lib/api-errors";
import { isSameOrigin } from "@/lib/auth";
import { clientIp } from "@/lib/client-ip";
import { decideParent, isParentToken, linkInfo } from "@/lib/parent-consent";
import { checkIpLimits } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } as const;

function fail(code: ApiErrorCode, message: string, retryAfterSec?: number): NextResponse {
  return NextResponse.json(apiErrorBody(code, message, retryAfterSec ? { retryAfterSec } : {}), {
    status: API_ERROR_STATUS[code],
    headers: retryAfterSec ? { ...NO_STORE, "Retry-After": String(retryAfterSec) } : NO_STORE,
  });
}

async function limited(req: Request, bucket: "parent_link" | "parent_decide"): Promise<NextResponse | null> {
  try {
    const limit = await checkIpLimits(clientIp(req.headers), bucket);
    if (limit.ok) return null;
    if (limit.code === "unavailable") return fail("unavailable", "Try again in a minute.");
    return fail("rate_limited", "Too many requests. Try again later.", "retryAfterSec" in limit ? limit.retryAfterSec : undefined);
  } catch {
    return fail("unavailable", "Try again in a minute.");
  }
}

/** GET /api/v1/parent/<token>: what a parent's link is for, no sign-in:
 * {kind: "request" | "withdraw", name, usable}. 404 parent_link when it
 * matches nothing; `usable` is false for an expired request link. */
export async function GET(req: Request, ctx: RouteContext<"/api/v1/parent/[token]">): Promise<NextResponse> {
  const { token } = await ctx.params;
  if (!isParentToken(token)) return fail("parent_link", "This link does not work.");
  const refused = await limited(req, "parent_link");
  if (refused) return refused;
  try {
    const info = await linkInfo(token);
    return info ? NextResponse.json(info, { headers: NO_STORE }) : fail("parent_link", "This link does not work.");
  } catch (e) {
    console.error("[parent] link lookup failed:", e instanceof Error ? e.message : String(e));
    return fail("unavailable", "Try again in a minute.");
  }
}

const Decision = z.strictObject({
  action: z.enum(["approve", "decline", "withdraw"]),
  /** The tick "I am this person's parent or legal guardian"; approving needs it. */
  guardian: z.boolean().optional(),
});

/** POST /api/v1/parent/<token> {action, guardian?}: approve (guardian true),
 * decline or withdraw. Answers {result: "approved" | "declined" | "withdrawn"};
 * 404 parent_link for a link that is unknown, expired or used, 400 invalid
 * for an approval without the tick, 503 unavailable when the confirmation
 * mail could not be sent (nothing changed, try again). Same-origin only. */
export async function POST(req: Request, ctx: RouteContext<"/api/v1/parent/[token]">): Promise<NextResponse> {
  const { token } = await ctx.params;
  if (!isParentToken(token)) return fail("parent_link", "This link does not work.");
  if (!isSameOrigin(req)) return fail("bad_origin", "Cross-site request refused.");
  const refused = await limited(req, "parent_decide");
  if (refused) return refused;
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    // handled below
  }
  const parsed = Decision.safeParse(body);
  if (!parsed.success) return fail("invalid", 'Send {"action": "approve" | "decline" | "withdraw"}.');
  const { action, guardian = false } = parsed.data;
  if (action === "approve" && !guardian) return fail("invalid", "Tick that you are the parent or legal guardian.");
  try {
    const result = await decideParent(token, action, guardian);
    if (result === "failed") return fail("unavailable", "Try again in a minute.");
    if (result === "invalid") return fail("parent_link", "This link does not work.");
    return NextResponse.json({ result }, { headers: NO_STORE });
  } catch (e) {
    console.error("[parent] decision failed:", e instanceof Error ? e.message : String(e));
    return fail("unavailable", "Try again in a minute.");
  }
}
