/**
 * Live eval of the judge against the hand-labeled test set.
 * Costs real API calls (one judge run per case) and respects free-tier
 * rate limits by running sequentially — expect ~6-10 minutes on free tier.
 *
 * Run: npm run eval            (all 30 cases)
 *      npm run eval -- 5       (first N cases)
 */
import cases from "../test/arguments.json";
import { judgeOnce } from "../lib/judge";

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY not set — eval needs a live key.");
    process.exit(1);
  }
  const limit = Number(process.argv[2]) || cases.length;
  const selected = cases.slice(0, limit);

  let typeHits = 0;
  let verdictHits = 0;
  let failures = 0;
  const misses: string[] = [];

  for (const c of selected) {
    const run = await judgeOnce(c.argument, { preset: "balanced" });
    if (!run.ok) {
      failures++;
      console.log(`✗ ${c.id}: RUN FAILED (${run.error})`);
      continue;
    }
    const typeOk = (c.expected.dispute_type as string[]).includes(run.data.dispute_type);
    const verdictOk = (c.expected.verdict_one_of as string[]).includes(run.data.verdict);
    if (typeOk) typeHits++;
    if (verdictOk) verdictHits++;
    if (!typeOk || !verdictOk) {
      misses.push(
        `${c.id}: got ${run.data.verdict}/${run.data.dispute_type}, expected ${c.expected.verdict_one_of.join("|")}/${c.expected.dispute_type.join("|")}`,
      );
    }
    console.log(
      `${typeOk && verdictOk ? "✓" : "•"} ${c.id}: ${run.data.verdict} (${run.data.dispute_type})`,
    );
  }

  const judged = selected.length - failures;
  console.log(`\n=== EVAL: ${judged}/${selected.length} judged (${failures} run failures) ===`);
  console.log(`dispute_type accuracy: ${typeHits}/${judged}`);
  console.log(`verdict accuracy:      ${verdictHits}/${judged}`);
  if (misses.length) {
    console.log("\nMisses:");
    for (const m of misses) console.log("  " + m);
  }
}
main();
