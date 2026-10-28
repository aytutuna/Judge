import { NextResponse } from "next/server";
import { rejectDeadBearer } from "@/lib/bearer-guard";
import { premiumVerdict } from "@/lib/premium/handler";
import { VerdictRequest } from "@/lib/types";

export const runtime = "nodejs";
// Vercel function limit (seconds): anonymize (60s) + parallel judges (120s)
// + escalation judges (45s, EXTRA_RUN_TIMEOUT_MS) + crux trial (60s) = 285s
// worst case, inside 300s (Vercel Hobby's ceiling with Fluid compute). The
// VPS deploy has no such limit; this keeps the Vercel path honest.
export const maxDuration = 300;

export async function POST(req: Request): Promise<NextResponse> {
  // A bearer token that no longer works is refused before anything else:
  // the app signs in again rather than being told to sign in by the
  // premium gate. No header (the website): no lookup, as before.
  const deadBearer = await rejectDeadBearer(req);
  if (deadBearer) return deadBearer;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    // `code` is a stable machine code the client localizes from; the English
    // `error` text stays for backward compatibility / non-UI consumers.
    return NextResponse.json({ error: "Invalid JSON body", code: "invalid" }, { status: 400 });
  }

  const parsed = VerdictRequest.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const message = issue?.message ?? "Invalid request";
    // Map the ISSUE CODE, not the message string — and only for the
    // `argument` field, so range failures elsewhere (e.g. clarifications) don't get
    // the argument-length messages.
    const onArgument = issue?.path[0] === "argument";
    const code =
      onArgument && issue.code === "too_small"
        ? "too_short"
        : onArgument && issue.code === "too_big"
          ? "too_long"
          : "invalid";
    return NextResponse.json({ error: message, code }, { status: 400 });
  }
  // Every verdict is premium. A `tier` sent by older app builds ("free"
  // included) is ignored: they get a premium verdict, or the usual
  // sign-in and out-of-credits errors.
  return premiumVerdict(req, parsed.data, body);
}
