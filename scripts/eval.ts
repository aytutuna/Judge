/**
 * Live eval of the judge against the hand-labeled test set.
 * Costs real API calls (one judge run per case). Runs sequentially so the
 * per-case output stays in order and the request rate stays gentle.
 *
 * Run: npm run eval            (all cases)
 *      npm run eval -- 5       (first N cases)
 *      npm run eval -- --sides (only the cases with three or four sides)
 *
 * A case with `parties` is judged among those sides: the expected winner is
 * a side letter ("a" to "d") or "too_close".
 */
import cases from "../test/arguments.json";
import { judgeOnce } from "../lib/judge";
import type { MultiRunOutput } from "../lib/judge-multi";
import { partiesFor } from "../lib/multi";
import type { JudgeRunOutput } from "../lib/types";

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY not set — eval needs a live key.");
    process.exit(1);
  }
  const sidesOnly = process.argv.includes("--sides");
  const limit = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a))) || cases.length;
  const selected = cases.filter((c) => !sidesOnly || "parties" in c).slice(0, limit);

  let typeHits = 0;
  let verdictHits = 0;
  let failures = 0;
  let winnerRuns = 0;
  const misses: string[] = [];

  for (const c of selected) {
    const parties = c.parties ? partiesFor(c.parties) : undefined;
    const run = await judgeOnce(c.argument, parties ? { parties } : {});
    if (!run.ok) {
      failures++;
      console.log(`✗ ${c.id}: RUN FAILED (${run.error})`);
      continue;
    }
    const data = run.data as JudgeRunOutput | MultiRunOutput;
    const typeOk = (c.expected.dispute_type as string[]).includes(data.dispute_type);
    const verdictOk = (c.expected.verdict_one_of as string[]).includes(data.verdict);
    if (typeOk) typeHits++;
    if (verdictOk) verdictHits++;
    if (parties ? data.verdict !== "too_close" : data.verdict === "side_a" || data.verdict === "side_b") winnerRuns++;
    if (!typeOk || !verdictOk) {
      misses.push(
        `${c.id}: got ${data.verdict}/${data.dispute_type}, expected ${c.expected.verdict_one_of.join("|")}/${c.expected.dispute_type.join("|")}`,
      );
    }
    console.log(`${typeOk && verdictOk ? "✓" : "•"} ${c.id}: ${data.verdict} (${data.dispute_type})`);
  }

  const judged = selected.length - failures;
  console.log(`\n=== EVAL: ${judged}/${selected.length} judged (${failures} run failures) ===`);
  console.log(`dispute_type accuracy: ${typeHits}/${judged}`);
  console.log(`verdict accuracy:      ${verdictHits}/${judged}`);
  console.log(`winner rate:           ${winnerRuns}/${judged}`);
  if (misses.length) {
    console.log("\nMisses:");
    for (const m of misses) console.log("  " + m);
  }
}
main();
