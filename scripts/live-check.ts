/* One-off live pipeline check: anonymize -> judge x3 -> aggregate.
   Run: npx tsx scripts/live-check.ts (requires ANTHROPIC_API_KEY in env) */
import { anonymize } from "../lib/anonymize";
import { judgeSelfConsistent } from "../lib/judge";
import { aggregate } from "../lib/aggregate";
import type { JudgeRunOutput } from "../lib/types";

const argument = `My brother Mark and I are fighting. Mark says we should let our 16-year-old
sister Ana go to a music festival alone with her friends because she needs freedom to grow up.
I say it's not safe, she's too young, and safety comes first. Mark says I'm being controlling
and that risk is part of life. Who is right?`;

async function main() {
  const anon = await anonymize(argument);
  console.log("=== ANONYMIZED ===\n" + anon.text);
  console.log("nameMap:", JSON.stringify(anon.nameMap));

  const runs = await judgeSelfConsistent(anon.text);
  for (const r of runs) {
    console.log(
      r.ok
        ? `run verdict: ${r.data.verdict} (${r.data.dispute_type})`
        : `run FAILED: ${r.error}`,
    );
  }
  const ok = runs
    .filter((r): r is { ok: true; data: JudgeRunOutput } => r.ok)
    .map((r) => r.data);
  if (!ok.length) throw new Error("all runs failed");
  const final = aggregate(ok);
  console.log("=== FINAL ===");
  console.log(JSON.stringify(final, null, 2));
}
main();
