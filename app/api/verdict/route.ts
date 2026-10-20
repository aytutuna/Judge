import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { aggregate } from "@/lib/aggregate";
import { anonymize } from "@/lib/anonymize";
import { getViewer, isSameOrigin } from "@/lib/auth";
import { clientIp } from "@/lib/client-ip";
import { hasApiKey } from "@/lib/claude";
import { t, type Lang } from "@/lib/i18n";
import { judgeExtra, judgeSelfConsistent, type JudgeRun } from "@/lib/judge";
import { firstNameOf } from "@/lib/originals-types";
import { saveVerdictWithOriginals } from "@/lib/originals/save";
import { checkVerdictLimits } from "@/lib/ratelimit";
import { applyCruxTrial, runCruxTrial, shouldTryCrux } from "@/lib/trial";
import { verifyTurnstile } from "@/lib/turnstile";
import {
  VerdictRequest,
  type JudgeRunOutput,
  type VerdictResponse,
  type VerdictResult,
} from "@/lib/types";

export const runtime = "nodejs";
// Vercel function limit (seconds): anonymize (60s) + parallel judges (120s)
// + escalation judges (45s, EXTRA_RUN_TIMEOUT_MS) + crux trial (60s) = 285s
// worst case, inside 300s (Vercel Hobby's ceiling with Fluid compute). The
// VPS deploy has no such limit; this keeps the Vercel path honest.
export const maxDuration = 300;

const UNAVAILABLE_MESSAGE = "The judge is unavailable right now — try again in a minute.";

/** Integer env setting clamped to [min, max]; unset, empty or non-numeric
 * reads as the default. */
function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
}

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

/** Honest output when the model's own safety filter declines to judge.
 * Stored localized — consistent with stored CONTENT keeping its judged
 * language. */
function refusedResult(lang: Lang): VerdictResult {
  return {
    verdict: "too_close",
    dispute_type: "mixed",
    confidence: 1,
    headline: t(lang, "refused.headline"),
    crux: t(lang, "refused.crux"),
    split_points: null,
    conditional: null,
    argument_map: {
      side_a: [{ claim: t(lang, "refused.claim"), kind: "logic" }],
      side_b: [{ claim: t(lang, "refused.claim"), kind: "logic" }],
      bedrock_a: "—",
      bedrock_b: "—",
    },
    facts_relied_on: [],
    losing_side_best_point: t(lang, "refused.bestPoint"),
    runs: [],
    demo: false,
    model_refused: true,
  };
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

  let result: VerdictResult;
  const runs = await judgeSelfConsistent(anonymized, framework, lang);
  const ok = runs.filter((r) => r.ok).map((r) => r.data as JudgeRunOutput);
  if (ok.length === 0) {
    const allBlocked = runs.every((r) => !r.ok && r.blocked);
    if (allBlocked) {
      result = refusedResult(lang);
    } else {
      const firstError = runs.find((r) => !r.ok);
      const detail = firstError && !firstError.ok ? firstError.error : "?";
      console.error("[verdict] all judge runs failed:", detail);
      // claudeJson keeps the HTTP status in its error text ("Claude HTTP 429: …").
      const quota = /HTTP 429/.test(detail);
      const message = quota
        ? "The judge hit its AI quota for now — try again in a few minutes."
        : UNAVAILABLE_MESSAGE;
      return NextResponse.json(
        { error: message, code: quota ? "quota" : "unavailable" },
        { status: 502 },
      );
    }
  } else {
    result = aggregate(ok);
    // Escalation: a low-confidence first round calls in a few more judges
    // (in parallel) and every vote is counted again. Fail-open: if no extra
    // run succeeds, the first result stands as it was.
    const extra = intEnv("JUDGE_EXTRA_RUNS", 2, 0, 4);
    if (extra > 0 && result.confidence <= intEnv("JUDGE_ESCALATE_AT", 2, 0, 5)) {
      const more = await judgeExtra(extra, anonymized, framework, lang).catch(
        (): JudgeRun[] => [],
      );
      const moreOk = more.filter((r) => r.ok).map((r) => r.data as JudgeRunOutput);
      console.info(
        `[verdict] escalated at confidence ${result.confidence}: ${moreOk.length}/${extra} extra runs ok, ${ok.length + moreOk.length} runs counted`,
      );
      if (moreOk.length > 0) result = { ...aggregate([...ok, ...moreOk]), escalated: true };
    }
    // Crux trial: cross-examine fact/logic winner rulings before saving, so
    // shared /v/[id] pages get the trial for free. runCruxTrial never throws
    // and never exceeds its ~60s deadline; null means the verdict ships
    // untried (failure-open). CRUX_TRIAL=0 is the tight-quota kill switch.
    if (process.env.CRUX_TRIAL !== "0" && shouldTryCrux(result)) {
      const trial = await runCruxTrial(anonymized, result, lang);
      if (trial) result = applyCruxTrial(result, trial);
    }
  }

  // Record the content language so a later translation knows its source.
  result = { ...result, lang };
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
