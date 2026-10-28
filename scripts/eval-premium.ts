/**
 * Live comparison of the free and premium pipelines on the hand-labeled test
 * set, for the premium accuracy and cost review. Costs real API calls: per
 * case one full free verdict (anonymize, 3 judges, escalation, crux trial)
 * and one full premium verdict (anonymize, web fact-check, premium panel,
 * escalation, crux trial). Nothing is stored and no credits are involved.
 * Runs cases one at a time.
 *
 * Run: npx tsx --env-file=.env scripts/eval-premium.ts [N] [--only id,id] [--out file.json]
 *
 * Writes every result (verdicts, fact-checks, token and search counts, an
 * estimated cost) to the JSON file and prints a summary.
 */
import { writeFileSync } from "node:fs";
import cases from "../test/arguments.json";
import { aggregate } from "../lib/aggregate";
import { anonymize } from "../lib/anonymize";
import { withUsageMeter, type UsageTotals } from "../lib/claude";
import { judgeExtra, judgeSelfConsistent, type JudgeRun } from "../lib/judge";
import { runPremiumPipeline } from "../lib/premium/run";
import { applyCruxTrial, runCruxTrial, shouldTryCrux } from "../lib/trial";
import type { JudgeRunOutput, VerdictResult } from "../lib/types";

/** USD per million tokens (input, output) and per web search. Estimates for
 * the summary only; check current pricing before quoting them. */
const PRICES: Record<string, [number, number]> = {
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-sonnet-5-5": [2, 10],
};
const SEARCH_USD = 0.01;

function costUsd(usage: UsageTotals): number {
  let usd = usage.searches * SEARCH_USD;
  for (const [model, m] of Object.entries(usage.byModel)) {
    const [inP, outP] = PRICES[model] ?? PRICES["claude-sonnet-5-5"];
    usd += (m.input * inP + m.output * outP) / 1e6;
  }
  return Math.round(usd * 100_000) / 100_000;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

/** The free route's pipeline without HTTP, limits or storage. */
async function freeVerdict(argument: string): Promise<VerdictResult | { error: string }> {
  const { text } = await anonymize(argument);
  const runs = await judgeSelfConsistent(text, "en");
  const ok = runs.filter((r) => r.ok).map((r) => r.data as JudgeRunOutput);
  if (ok.length === 0) {
    const first = runs.find((r) => !r.ok);
    return { error: first && !first.ok ? first.error : "all runs failed" };
  }
  let result = aggregate(ok);
  const extra = 2;
  if (result.confidence <= 2) {
    const more = await judgeExtra(extra, text, "en").catch((): JudgeRun[] => []);
    const moreOk = more.filter((r) => r.ok).map((r) => r.data as JudgeRunOutput);
    if (moreOk.length > 0) result = { ...aggregate([...ok, ...moreOk]), escalated: true };
  }
  if (shouldTryCrux(result)) {
    const trial = await runCruxTrial(text, result, "en");
    if (trial) result = applyCruxTrial(result, trial);
  }
  return result;
}

function summary(r: VerdictResult) {
  return {
    verdict: r.verdict,
    dispute_type: r.dispute_type,
    confidence: r.confidence,
    runs: r.runs,
    escalated: r.escalated ?? false,
    crux_trial: r.crux_trial?.outcome ?? null,
    headline: r.headline,
    why: r.why ?? null,
    crux: r.crux,
    facts_relied_on: r.facts_relied_on,
    lean: r.lean ?? null,
  };
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY not set — the eval needs a live key.");
    process.exit(1);
  }
  const only = arg("--only")?.split(",");
  const limit = Number(process.argv[2]) || cases.length;
  const selected = only ? cases.filter((c) => only.includes(c.id)) : cases.slice(0, limit);
  const out = arg("--out") ?? `eval-premium-${Date.now()}.json`;

  const rows = [];
  for (const c of selected) {
    const expected = c.expected as { dispute_type: string[]; verdict_one_of: string[] };
    const t0 = Date.now();
    const free = await withUsageMeter(() => freeVerdict(c.argument).catch((e: unknown) => ({ error: String(e) })));
    const freeMs = Date.now() - t0;
    const t1 = Date.now();
    const premium = await runPremiumPipeline({ argument: c.argument, lang: "en" });
    const premiumMs = Date.now() - t1;

    const freeResult = "error" in free.value ? null : free.value;
    const premiumResult = premium.outcome.status === "ok" ? premium.outcome.result : null;
    const row = {
      id: c.id,
      expected,
      free: {
        ok: freeResult !== null,
        error: "error" in free.value ? free.value.error : null,
        ...(freeResult ? summary(freeResult) : {}),
        verdictOk: freeResult ? expected.verdict_one_of.includes(freeResult.verdict) : false,
        usage: free.usage,
        costUsd: costUsd(free.usage),
        ms: freeMs,
      },
      premium: {
        ok: premiumResult !== null,
        status: premium.outcome.status,
        ...(premiumResult
          ? { ...summary(premiumResult), fact_check: premiumResult.fact_check, panel: premiumResult.panel }
          : {}),
        verdictOk: premiumResult ? expected.verdict_one_of.includes(premiumResult.verdict) : false,
        usage: premium.usage,
        costUsd: costUsd(premium.usage),
        ms: premiumMs,
      },
    };
    rows.push(row);
    const changed = freeResult && premiumResult && freeResult.verdict !== premiumResult.verdict ? " CHANGED" : "";
    console.log(
      `${c.id}: free ${freeResult?.verdict ?? "FAIL"}${row.free.verdictOk ? " ✓" : ""} ($${row.free.costUsd}) | premium ${premiumResult?.verdict ?? premium.outcome.status}${row.premium.verdictOk ? " ✓" : ""} ($${row.premium.costUsd}, fact_check ${premiumResult?.fact_check?.status ?? "-"})${changed}`,
    );
    writeFileSync(out, JSON.stringify({ rows }, null, 2));
  }

  const n = rows.length;
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const totals = {
    cases: n,
    freeCorrect: rows.filter((r) => r.free.verdictOk).length,
    premiumCorrect: rows.filter((r) => r.premium.verdictOk).length,
    changed: rows.filter((r) => r.free.ok && r.premium.ok && r.free.verdict !== r.premium.verdict).map((r) => r.id),
    freeCostAvg: n ? sum(rows.map((r) => r.free.costUsd)) / n : 0,
    premiumCostAvg: n ? sum(rows.map((r) => r.premium.costUsd)) / n : 0,
    premiumCostMax: Math.max(0, ...rows.map((r) => r.premium.costUsd)),
    totalCost: sum(rows.map((r) => r.free.costUsd + r.premium.costUsd)),
  };
  writeFileSync(out, JSON.stringify({ totals, rows }, null, 2));
  console.log(`\n=== ${n} cases ===`);
  console.log(`verdict accuracy: free ${totals.freeCorrect}/${n}, premium ${totals.premiumCorrect}/${n}`);
  console.log(`changed verdicts: ${totals.changed.join(", ") || "none"}`);
  console.log(
    `est. cost per verdict: free $${totals.freeCostAvg.toFixed(4)}, premium $${totals.premiumCostAvg.toFixed(4)} (max $${totals.premiumCostMax.toFixed(4)}); run total $${totals.totalCost.toFixed(3)}`,
  );
  console.log(`results: ${out}`);
}
main();
