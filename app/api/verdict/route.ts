import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { aggregate } from "@/lib/aggregate";
import { anonymize } from "@/lib/anonymize";
import { saveVerdict } from "@/lib/db";
import { hasApiKey } from "@/lib/gemini";
import { judgeSelfConsistent } from "@/lib/judge";
import { mockVerdict } from "@/lib/mock";
import {
  VerdictRequest,
  type JudgeOutput,
  type VerdictResponse,
  type VerdictResult,
} from "@/lib/types";

export const runtime = "nodejs";

/** Honest output when the model's own safety filter declines to judge. */
function refusedResult(): VerdictResult {
  return {
    verdict: "too_close",
    dispute_type: "mixed",
    confidence: 1,
    headline: "The model declined to weigh in",
    crux: "The AI's own safety filter refused to judge this one — no verdict is better than a fake one.",
    split_points: null,
    conditional: null,
    argument_map: {
      side_a: [{ claim: "Not analyzed", kind: "logic" }],
      side_b: [{ claim: "Not analyzed", kind: "logic" }],
      bedrock_a: "—",
      bedrock_b: "—",
    },
    facts_relied_on: [],
    losing_side_best_point: "Try rephrasing, or accept that this one is beyond an app.",
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
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = VerdictRequest.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid request";
    return NextResponse.json({ error: message }, { status: 400 });
  }
  const { argument, framework } = parsed.data;

  const { text: anonymized, nameMap } = await anonymize(argument);

  let result: VerdictResult;
  if (!hasApiKey()) {
    result = mockVerdict(anonymized, framework);
  } else {
    const runs = await judgeSelfConsistent(anonymized, framework);
    const ok = runs.filter((r) => r.ok).map((r) => r.data as JudgeOutput);
    if (ok.length === 0) {
      const allBlocked = runs.every((r) => !r.ok && r.blocked);
      if (allBlocked) {
        result = refusedResult();
      } else {
        const firstError = runs.find((r) => !r.ok);
        const detail = firstError && !firstError.ok ? firstError.error : "?";
        console.error("[verdict] all judge runs failed:", detail);
        const message = detail.includes("429")
          ? "The judge hit its AI quota for now — try again in a few minutes."
          : "The judge is unavailable right now — try again in a minute.";
        return NextResponse.json({ error: message }, { status: 502 });
      }
    } else {
      result = aggregate(ok);
    }
  }

  const id = nanoid(10);
  saveVerdict({ id, input: anonymized, framework, result });

  const response: VerdictResponse = { id, result, name_map: nameMap };
  return NextResponse.json(response);
}
