import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { anonymize } from "@/lib/anonymize";
import { getViewer, isSameOrigin } from "@/lib/auth";
import { clientIp } from "@/lib/client-ip";
import { hasApiKey } from "@/lib/claude";
import { judgeFreeAnonymized } from "@/lib/free-run";
import { firstNameOf } from "@/lib/originals-types";
import { saveVerdictWithOriginals } from "@/lib/originals/save";
import { checkVerdictLimits } from "@/lib/ratelimit";
import { verifyTurnstile } from "@/lib/turnstile";
import { VerdictRequest, type VerdictResponse, type VerdictResult } from "@/lib/types";
import { wantsAsync } from "@/lib/verdict-poll";

export const runtime = "nodejs";
// Vercel function limit (seconds): anonymize (60s) + parallel judges (120s)
// + escalation judges (45s, EXTRA_RUN_TIMEOUT_MS) + crux trial (60s) = 285s
// worst case, inside 300s (Vercel Hobby's ceiling with Fluid compute). The
// VPS deploy has no such limit; this keeps the Vercel path honest.
export const maxDuration = 300;

const UNAVAILABLE_MESSAGE = "The judge is unavailable right now — try again in a minute.";

function unavailable(): NextResponse {
  return NextResponse.json({ error: UNAVAILABLE_MESSAGE, code: "unavailable" }, { status: 503 });
}

/** The Turnstile token rides next to the verdict fields; read it apart so the
 * shared request schema stays as it is. */
function turnstileToken(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const token = (body as { turnstileToken?: unknown }).turnstileToken;
  return typeof token === "string" ? token : undefined;
}

/** The argument exactly as sent (before trimming), for the encrypted original. */
function rawArgument(body: unknown, fallback: string): string {
  if (typeof body !== "object" || body === null) return fallback;
  const raw = (body as { argument?: unknown }).argument;
  return typeof raw === "string" ? raw : fallback;
}

export async function POST(req: Request): Promise<NextResponse> {
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
    // `argument` field, so range failures elsewhere (e.g. sliders) don't get
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
  // Premium has its own gates (account, credits) and pipeline. Loaded only
  // for premium requests, so the free path below runs exactly as before.
  if (parsed.data.tier === "premium") {
    const { premiumVerdict } = await import("@/lib/premium/handler");
    return premiumVerdict(req, parsed.data, body);
  }
  const { argument, framework, lang } = parsed.data;
  const ip = clientIp(req.headers);

  // Bot check first: cheapest gate, and it keeps bots from burning the
  // limits of real visitors. A no-op when TURNSTILE_SECRET_KEY is unset.
  const captcha = await verifyTurnstile(turnstileToken(body), ip);
  if (captcha === "invalid") {
    return NextResponse.json(
      { error: "Bot check failed — reload the page and try again.", code: "captcha_failed" },
      { status: 403 },
    );
  }
  if (captcha === "error") return unavailable();

  // Limits before any model call, so refused requests cost nothing.
  const limit = await checkVerdictLimits(ip);
  if (!limit.ok) {
    if (limit.code === "unavailable") return unavailable();
    const daily = limit.code === "daily_cap";
    return NextResponse.json(
      {
        error: daily
          ? "Judge has used today's capacity — try again tomorrow."
          : "Too many verdicts from you — take a breather and try again later.",
        code: limit.code,
        retryAfterSec: limit.retryAfterSec,
      },
      { status: daily ? 503 : 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  // No key -> no verdict. This app never fakes a ruling.
  if (!hasApiKey()) {
    return NextResponse.json(
      {
        error: "The judge is not configured: set ANTHROPIC_API_KEY in .env and restart the server.",
        code: "not_configured",
      },
      { status: 503 },
    );
  }

  // Fail closed: if names can't be removed, nothing is judged or stored —
  // the raw text would carry them to the model and into the database.
  let anonymized: string;
  let nameMap: VerdictResponse["name_map"];
  try {
    ({ text: anonymized, nameMap } = await anonymize(argument));
  } catch (e) {
    console.error("[verdict] anonymize failed:", e instanceof Error ? e.message : String(e));
    return unavailable();
  }

  // Async (opt-in: `Prefer: respond-async` or `"async": true`): everything
  // above stays synchronous, then the verdict is judged in the background
  // and the client polls GET /api/v1/verdicts/{id}. Without the preference
  // the request waits as before (older pages and app builds).
  if (wantsAsync(req.headers, body)) {
    const { startFreeVerdictJob } = await import("@/lib/free-async");
    return startFreeVerdictJob(req, {
      anonymized,
      nameMap,
      framework,
      lang,
      rawText: rawArgument(body, argument),
    });
  }

  const judged = await judgeFreeAnonymized(anonymized, framework, lang);
  if (!judged.ok) {
    console.error("[verdict] all judge runs failed:", judged.detail);
    const quota = judged.code === "quota";
    const message = quota
      ? "The judge hit its AI quota for now — try again in a few minutes."
      : UNAVAILABLE_MESSAGE;
    return NextResponse.json({ error: message, code: judged.code }, { status: 502 });
  }
  const result: VerdictResult = judged.result;
  const id = nanoid(10);
  // The writer: a signed-in account (bearer, or a same-origin cookie; a
  // cross-site cookie request counts as signed out), else a one-time owner
  // token. The original, names included, is stored encrypted; the judges
  // only ever saw the anonymized text.
  const viewer = await getViewer(req).catch(() => null);
  const ownerUserId = viewer && (viewer.via === "bearer" || isSameOrigin(req)) ? viewer.user.id : null;
  let saved;
  try {
    saved = await saveVerdictWithOriginals({
      id,
      input: anonymized,
      framework,
      result,
      kind: "free",
      ownerUserId,
      original: { v: 1, text: rawArgument(body, argument), nameMap },
    });
  } catch (e) {
    console.error("[verdict] saving failed:", e instanceof Error ? e.message : String(e));
    return unavailable();
  }

  const response: VerdictResponse = {
    id,
    result,
    name_map: nameMap,
    ...(saved.ownerToken ? { owner_token: saved.ownerToken } : {}),
    originals_stored: saved.originalsStored,
    ...(saved.metaWritten ? { display: saved.display } : {}),
    suggested_display_a: ownerUserId ? firstNameOf(viewer?.user.name) : null,
  };
  return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
}
