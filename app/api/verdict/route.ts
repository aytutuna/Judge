import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { aggregate } from "@/lib/aggregate";
import { anonymize } from "@/lib/anonymize";
import { saveVerdict } from "@/lib/db";
import { hasApiKey } from "@/lib/gemini";
import { t, type Lang } from "@/lib/i18n";
import { judgeSelfConsistent } from "@/lib/judge";
import { applyCruxTrial, runCruxTrial, shouldTryCrux } from "@/lib/trial";
import {
  VerdictRequest,
  type JudgeRunOutput,
  type VerdictResponse,
  type VerdictResult,
} from "@/lib/types";

export const runtime = "nodejs";

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
  const { argument, framework, lang } = parsed.data;

  // No key -> no verdict. This app never fakes a ruling.
  if (!hasApiKey()) {
    return NextResponse.json(
      {
        error: "The judge is not configured: set GEMINI_API_KEY in .env and restart the server.",
        code: "not_configured",
      },
      { status: 503 },
    );
  }

  const { text: anonymized, nameMap } = await anonymize(argument);

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
      const quota = detail.includes("429");
      const message = quota
        ? "The judge hit its AI quota for now — try again in a few minutes."
        : "The judge is unavailable right now — try again in a minute.";
      return NextResponse.json(
        { error: message, code: quota ? "quota" : "unavailable" },
        { status: 502 },
      );
    }
  } else {
    result = aggregate(ok);
    // Crux trial: cross-examine fact/logic winner rulings before saving, so
    // shared /v/[id] pages get the trial for free. runCruxTrial never throws
    // and never exceeds its ~60s deadline; null means the verdict ships
    // untried (failure-open). CRUX_TRIAL=0 is the tight-quota kill switch.
    if (process.env.CRUX_TRIAL !== "0" && shouldTryCrux(result)) {
      const trial = await runCruxTrial(anonymized, result, lang);
      if (trial) result = applyCruxTrial(result, trial);
    }
  }

  const id = nanoid(10);
  try {
    await saveVerdict({ id, input: anonymized, framework, result });
  } catch (err) {
    console.error("[verdict] saving failed:", err);
    return NextResponse.json(
      { error: "Could not save the verdict — try again in a minute.", code: "unavailable" },
      { status: 503 },
    );
  }

  const response: VerdictResponse = { id, result, name_map: nameMap };
  return NextResponse.json(response);
}
