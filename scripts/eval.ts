/**
 * Live eval of the full judging pipeline (self-consistency runs + aggregate)
 * against the hand-labeled test set. Costs real API calls: JUDGE_RUNS judge
 * calls per case (default 3). Calls run sequentially and are paced for the
 * free tier (EVAL_PACE_MS per call, default 13000 ≈ 4.6 calls/min), so a full
 * run takes about 30 minutes.
 *
 * Results are saved after every case, and a re-run with the same --out file
 * skips cases already judged, so a run cut short by a daily quota resumes.
 *
 * Run: npm run eval                              (all cases, eval-results/latest.json)
 *      npm run eval -- --out eval-results/before.json --limit 5
 *      npm run eval -- --compare eval-results/before.json eval-results/after.json
 *                                                 (no API calls: markdown table)
 */
import fs from "node:fs";
import path from "node:path";
import rawCases from "../test/arguments.json";
import { aggregate } from "../lib/aggregate";
import { judgeSelfConsistent } from "../lib/judge";
import type { Lang } from "../lib/i18n";
import type { JudgeRunOutput } from "../lib/types";
import {
  formatComparison,
  formatSummary,
  summarize,
  type CaseResult,
  type EvalCase,
} from "./eval-summary";

const cases = rawCases as EvalCase[];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function load(file: string): CaseResult[] {
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, "utf8")) as CaseResult[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const compare = process.argv.indexOf("--compare");
  if (compare >= 0) {
    const [before, after] = process.argv.slice(compare + 1, compare + 3);
    if (!before || !after || !fs.existsSync(before) || !fs.existsSync(after)) {
      console.error("usage: npm run eval -- --compare <before.json> <after.json>");
      process.exit(1);
    }
    console.log(formatComparison(summarize(cases, load(before)), summarize(cases, load(after))));
    return;
  }

  if (!process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY not set — eval needs a live key.");
    process.exit(1);
  }
  const out = arg("--out") ?? "eval-results/latest.json";
  const limit = Number(arg("--limit")) || cases.length;
  const paceMs = Number(process.env.EVAL_PACE_MS) || 13_000;

  // Keep finished cases; retry failed ones.
  const results = load(out).filter((r) => !("error" in r));
  const done = new Set(results.map((r) => r.id));
  fs.mkdirSync(path.dirname(out), { recursive: true });

  for (const c of cases.slice(0, limit)) {
    if (done.has(c.id)) continue;
    const started = Date.now();
    const runs = await judgeSelfConsistent(c.argument, { preset: "balanced" }, (c.lang ?? "en") as Lang);
    const ok = runs.filter((r) => r.ok).map((r) => r.data as JudgeRunOutput);
    let result: CaseResult;
    if (ok.length === 0) {
      const failed = runs.find((r) => !r.ok);
      result = { id: c.id, error: failed && !failed.ok ? failed.error : "no runs" };
      console.log(`✗ ${c.id}: RUN FAILED (${result.error})`);
    } else {
      const final = aggregate(ok);
      result = {
        id: c.id,
        verdict: final.verdict,
        dispute_type: final.dispute_type,
        confidence: final.confidence,
        runs: final.runs,
        downgraded: runs.filter((r) => r.ok && r.downgraded).length,
      };
      const hit = c.expected.verdict_one_of.includes(final.verdict);
      console.log(`${hit ? "✓" : "•"} ${c.id}: ${final.verdict} [${final.runs.join(", ")}]`);
    }
    const idx = results.findIndex((r) => r.id === c.id);
    if (idx >= 0) results[idx] = result;
    else results.push(result);
    fs.writeFileSync(out, JSON.stringify(results, null, 2) + "\n");

    // Pace for the free tier: at least paceMs per judge call made.
    const wait = runs.length * paceMs - (Date.now() - started);
    if (wait > 0) await sleep(wait);
  }

  console.log("\n" + formatSummary(`EVAL ${out}`, summarize(cases.slice(0, limit), results)));
}
main();
