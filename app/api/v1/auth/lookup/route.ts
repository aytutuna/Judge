import { NextResponse } from "next/server";
import { z } from "zod";
import { apiErrorBody } from "@/lib/api-errors";
import { authProviders, welcomeClaim } from "@/lib/auth";
import { clientIp } from "@/lib/client-ip";
import { signInMethod } from "@/lib/password";
import { checkIpLimits, checkUserLimits, visitorKey } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

const LookupRequest = z.strictObject({ email: z.string().trim().pipe(z.email().max(254)) });

const fail = (code: "invalid" | "not_found" | "rate_limited" | "unavailable", status: number, message: string, headers = {}) =>
  NextResponse.json(apiErrorBody(code, message), { status, headers: { ...NO_STORE, ...headers } });

/** POST /api/v1/auth/lookup {email}: which sign-in the address takes next.
 * Answers {method: "password" | "code" | "new"}: "password" for an account
 * with a password, "code" for one without (Apple, Google or code only), "new"
 * for an address with no account. The apps send the emailed code themselves
 * for the last two. Counted per address and IP, per address from anywhere
 * and per IP alone: 429
 * rate_limited with Retry-After. 400 invalid when the body is not an email;
 * 404 when the server has no password sign-in (see signIn.password in
 * GET /api/v1/config). */
export async function POST(req: Request): Promise<NextResponse> {
  if (!authProviders(req).password) return fail("not_found", 404, "Not found.");
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    // handled below
  }
  const parsed = LookupRequest.safeParse(body);
  const email = parsed.success ? parsed.data.email: "";
  const claim = parsed.success ? welcomeClaim(email) : null;
  if (!claim) return fail("invalid", 400, 'Send {"email": "..."}.');

  const ip = clientIp(req.headers);
  const limit = await checkUserLimits(`${claim}:${visitorKey(ip)}`, "signin_lookup");
  const anyIp = limit.ok ? await checkUserLimits(claim, "signin_lookup_any") : limit;
  const ipLimit = anyIp.ok ? await checkIpLimits(ip, "signin_lookup") : anyIp;
  if (!ipLimit.ok) {
    if (ipLimit.code === "unavailable") return fail("unavailable", 503, "Sign-in is unavailable right now.");
    return fail("rate_limited", 429, "Too many attempts. Try again later.", {
      "Retry-After": String(ipLimit.retryAfterSec),
    });
  }
  return NextResponse.json({ method: await signInMethod(email) }, { headers: NO_STORE });
}
