import { NextResponse } from "next/server";
import { apiErrorBody } from "@/lib/api-errors";
import { authConfigured, getAuth } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * Better Auth's own HTTP surface: social sign-in and callbacks, native ID-token
 * sign-in, magic links, get-session and sign-out. 404 while auth is off.
 */
async function handle(req: Request): Promise<Response> {
  if (!authConfigured()) {
    return NextResponse.json(apiErrorBody("not_found", "Not found."), { status: 404 });
  }
  try {
    const auth = await getAuth();
    return await auth.handler(req);
  } catch (e) {
    console.error("[auth] handler failed:", e instanceof Error ? e.message : String(e));
    return NextResponse.json(apiErrorBody("unavailable", "Sign-in is unavailable right now."), {
      status: 503,
    });
  }
}

export function GET(req: Request): Promise<Response> {
  return handle(req);
}

export function POST(req: Request): Promise<Response> {
  return handle(req);
}
