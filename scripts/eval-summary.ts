/**
 * Pure scoring for the live eval (scripts/eval.ts): no API calls, so it is
 * unit-tested and can re-score saved result files.
 */

export type EvalCase = {
  id: string;
  lang?: string;
  argument: string;
  expected: { dispute_type: string[]; verdict_one_of: string[] };
};

export type CaseResult =
  | {
      id: string;
      verdict: string;
      dispute_type: string;
      confidence: number;
      /** Each surviving judge run's verdict. */
      runs: string[];
      /** Runs whose exception verdict failed its criteria and was replaced. */
      downgraded: number;
    }
  | { id: string; error: string };

export const OUTCOMES = ["side_a", "side_b", "split", "conditional", "dissolved", "too_close"] as const;

const WINNERS = new Set(["side_a", "side_b"]);

export type Rate = { hits: number; total: number };

export type EvalSummary = {
  cases: number;
  judged: number;
  failures: number;
  outcomes: Record<(typeof OUTCOMES)[number], number>;
  clearWinner: Rate;
  tooClose: Rate;
  /** Final verdict is one of the labeled acceptable verdicts. */
  accuracy: Rate;
  /** Accuracy on cases labeled with a winner only. */
  winnerCases: Rate;
  /** Accuracy on cases labeled split/conditional/dissolved. */
  exceptionCases: Rate;
  disputeType: Rate;
  byLang: Record<string, Rate>;
  /** Accuracy of every individual judge run, before aggregation. */
  runs: Rate;
  downgradedRuns: number;
  misses: string[];
};

function isWinnerLabel(c: EvalCase): boolean {
  return c.expected.verdict_one_of.every((v) => WINNERS.has(v));
}

export function summarize(cases: EvalCase[], results: CaseResult[]): EvalSummary {
  const byId = new Map(results.map((r) => [r.id, r]));
  const rate = (): Rate => ({ hits: 0, total: 0 });
  const s: EvalSummary = {
    cases: cases.length,
    judged: 0,
    failures: 0,
    outcomes: Object.fromEntries(OUTCOMES.map((o) => [o, 0])) as EvalSummary["outcomes"],
    clearWinner: rate(),
    tooClose: rate(),
    accuracy: rate(),
    winnerCases: rate(),
    exceptionCases: rate(),
    disputeType: rate(),
    byLang: {},
    runs: rate(),
    downgradedRuns: 0,
    misses: [],
  };
  const tally = (r: Rate, hit: boolean) => {
    r.total++;
    if (hit) r.hits++;
  };

  for (const c of cases) {
    const r = byId.get(c.id);
    if (!r) continue;
    if ("error" in r) {
      s.failures++;
      continue;
    }
    s.judged++;
    const ok = c.expected.verdict_one_of.includes(r.verdict);
    if (r.verdict in s.outcomes) s.outcomes[r.verdict as keyof EvalSummary["outcomes"]]++;
    tally(s.clearWinner, WINNERS.has(r.verdict));
    tally(s.tooClose, r.verdict === "too_close");
    tally(s.accuracy, ok);
    tally(isWinnerLabel(c) ? s.winnerCases : s.exceptionCases, ok);
    tally(s.disputeType, c.expected.dispute_type.includes(r.dispute_type));
    tally((s.byLang[c.lang ?? "en"] ??= rate()), ok);
    for (const v of r.runs) tally(s.runs, c.expected.verdict_one_of.includes(v));
    s.downgradedRuns += r.downgraded;
    if (!ok) {
      s.misses.push(
        `${c.id}: got ${r.verdict} (runs ${r.runs.join(", ")}), expected ${c.expected.verdict_one_of.join(" | ")}`,
      );
    }
  }
  return s;
}

export function pct(r: Rate): string {
  if (r.total === 0) return "n/a";
  return `${Math.round((100 * r.hits) / r.total)}% (${r.hits}/${r.total})`;
}

function rows(s: EvalSummary): [string, string][] {
  return [
    ["Cases judged", `${s.judged}/${s.cases} (${s.failures} failed)`],
    ["Clear winner (side_a or side_b)", pct(s.clearWinner)],
    ["too_close rate", pct(s.tooClose)],
    ...OUTCOMES.map((o): [string, string] => [`  ${o}`, String(s.outcomes[o])]),
    ["Verdict accuracy, all cases", pct(s.accuracy)],
    ["  winner-labeled cases", pct(s.winnerCases)],
    ["  split/conditional/dissolved-labeled cases", pct(s.exceptionCases)],
    ...Object.entries(s.byLang).sort(([x], [y]) => x.localeCompare(y)).map(([lang, r]): [string, string] => [`  ${lang} cases`, pct(r)]),
    ["Single-run accuracy", pct(s.runs)],
    ["Dispute type accuracy", pct(s.disputeType)],
    ["Runs downgraded by the criteria check", String(s.downgradedRuns)],
  ];
}

export function formatSummary(label: string, s: EvalSummary): string {
  const lines = [`=== ${label} ===`, ...rows(s).map(([k, v]) => `${k.padEnd(46)} ${v}`)];
  if (s.misses.length) lines.push("", "Misses:", ...s.misses.map((m) => `  ${m}`));
  return lines.join("\n");
}

/** Markdown before/after table for docs/eval-report.md. */
export function formatComparison(before: EvalSummary, after: EvalSummary): string {
  const a = new Map(rows(before));
  const b = new Map(rows(after));
  const labels = [...new Set([...a.keys(), ...b.keys()])];
  const out = ["| Metric | Before | After |", "|---|---|---|"];
  for (const label of labels) {
    out.push(`| ${label.trim()} | ${a.get(label) ?? "n/a"} | ${b.get(label) ?? "n/a"} |`);
  }
  return out.join("\n");
}
