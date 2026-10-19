import { NextResponse } from "next/server";
import { apiErrorBody } from "@/lib/api-errors";
import {
  DEV_LOGIN_DEFAULT_EMAIL,
  createDevSession,
  devLoginAllowed,
  isDevLoginEmail,
  isSameOrigin,
  sessionCookieHeader,
} from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Indistinguishable from a route that does not exist. */
function notFound(): NextResponse {
  return NextResponse.json(apiErrorBody("not_found", "Not found."), { status: 404 });
}

/**
 * POST /api/v1/auth/dev-login { email?: "<name>@verdict.local" }: local test
 * sign-in without Apple, Google or email. Answers only under `next dev` with
 * DEV_LOGIN=1 on a localhost Host header (see devLoginAllowed); 404 otherwise.
 * Returns the session token (usable as a bearer token) and sets the cookie.
 */
export async function POST(req: Request): Promise<NextResponse> {
  if (!devLoginAllowed(req)) return notFound();
  if (req.headers.get("origin") && !isSameOrigin(req)) return notFound();

  let body: unknown = {};
  try {
    const text = await req.text();
    body = text.trim() ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json(apiErrorBody("invalid", "Body must be JSON."), { status: 400 });
  }
  const raw = typeof body === "object" && body !== null ? (body as { email?: unknown }).email : undefined;
  const email = typeof raw === "string" && raw.trim() ? raw.trim().toLowerCase() : DEV_LOGIN_DEFAULT_EMAIL;
  if (!isDevLoginEmail(email)) {
    return NextResponse.json(apiErrorBody("invalid", "Test emails must end in @verdict.local."), { status: 400 });
  }

  const { token, user } = await createDevSession(email);
  const res = NextResponse.json({ token, user }, { headers: { "Cache-Control": "no-store" } });
  res.headers.append("Set-Cookie", await sessionCookieHeader(token));
  return res;
}

export function GET(): NextResponse {
  return notFound();
}
