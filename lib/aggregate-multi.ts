import type { MultiRunOutput } from "./judge-multi";
import { legacyRun, legacyVerdict } from "./multi";
import type { Claim, MultiVote, PartyId, SideAnalysis, VerdictResult } from "./types";

/**
 * aggregate() for a dispute with three or four sides. The same rules, with
 * the sides counted properly:
 *   all runs name the same side -> confidence 5 (4 if they disagree on
 *                       dispute_type)
 *   strict majority    -> that side; by agreement share: >= 80% -> 4,
 *                       >= 60% -> 3, else 2; one less (floor 2) when any
 *                       run named a different side
 *   no majority        -> the side that >= 80% of the forced leans name
 *                       (all of them up to 3 runs) when a run ruled for it,
 *                       confidence 2; otherwise "too_close", confidence 1.
 * A plurality without a majority is therefore too close, except where the
 * forced leans decide it. A run that said "too_close" counts as its own
 * vote ("other"); a majority of those is a too-close verdict.
 *
 * The result keeps the older fields valid (`verdict` is side_a/side_b only
 * for a real A/B winner, `runs` holds side_a, side_b or split) and carries
 * the true result in parties, winner, votes, sides and others. There is no
 * `lean`: its party can only be A or B.
 */
export function aggregateMulti(runs: MultiRunOutput[], parties: readonly PartyId[]): VerdictResult {
  if (runs.length === 0) {
    throw new Error("aggregate needs at least one successful run");
  }

  const votes: MultiVote[] = runs.map((r) => (r.verdict === "too_close" ? "other" : r.verdict));
  const counts = new Map<MultiVote, number>();
  for (const v of votes) counts.set(v, (counts.get(v) ?? 0) + 1);
  const [topVote, topCount] = [...counts.entries()].sort((x, y) => y[1] - x[1])[0];
  const majority = topCount > runs.length / 2 || runs.length === 1;
  const ran = (v: MultiVote) => runs.find((_, i) => votes[i] === v) ?? runs[0];

  if (!majority) {
    const lean = leanWinner(runs, parties);
    if (lean && votes.includes(lean)) return build(ran(lean), lean, votes, 2, parties);
    return build(ran(topVote), null, votes, 1, parties, { scatter: true });
  }

  const representative = ran(topVote);
  let confidence: number;
  if (topCount === runs.length) {
    confidence = runs.every((r) => r.dispute_type === representative.dispute_type) ? 5 : 4;
  } else {
    const share = topCount / runs.length;
    confidence = share >= 0.8 ? 4 : share >= 0.6 ? 3 : 2;
    const dissent = topVote !== "other" && votes.some((v) => v !== "other" && v !== topVote);
    if (dissent) confidence = Math.max(2, confidence - 1);
  }
  // Fewer surviving runs = weaker agreement evidence, cap confidence.
  const cap = runs.length >= 3 ? 5 : runs.length === 2 ? 4 : 2;
  return build(representative, topVote === "other" ? null : topVote, votes, Math.min(confidence, cap), parties);
}

/** The side named by at least 80% of the runs' forced leans, or null. */
function leanWinner(runs: MultiRunOutput[], parties: readonly PartyId[]): PartyId | null {
  const tally = parties.map((p) => ({ p, n: runs.filter((r) => r.leaning === p).length }));
  const best = tally.sort((x, y) => y.n - x.n)[0];
  return best && best.n / runs.length >= 0.8 ? best.p : null;
}

const NO_CLAIM: Claim = { claim: "—", kind: "logic" };

function build(
  run: MultiRunOutput,
  winner: PartyId | null,
  votes: MultiVote[],
  confidence: number,
  parties: readonly PartyId[],
  opts: { scatter?: boolean } = {},
): VerdictResult {
  const sides: SideAnalysis[] = parties.map(
    (party) => run.sides.find((s) => s.party === party) ?? { party, claims: [], bedrock: "" },
  );
  const [a, b] = sides;
  const others = winner
    ? parties
        .filter((p) => p !== winner)
        .flatMap((p) => run.others.filter((o) => o.party === p).slice(0, 1))
    : [];
  return {
    verdict: legacyVerdict(winner),
    dispute_type: run.dispute_type,
    headline: opts.scatter ? "Too close to call" : run.headline,
    // A scattered run's `why` argues for its own verdict, so it goes with its headline.
    ...(opts.scatter ? {} : { why: run.why }),
    crux: run.crux,
    split_points: null,
    conditional: null,
    argument_map: {
      side_a: a.claims.length ? a.claims : [NO_CLAIM],
      side_b: b.claims.length ? b.claims : [NO_CLAIM],
      bedrock_a: a.bedrock,
      bedrock_b: b.bedrock,
    },
    facts_relied_on: run.facts_relied_on,
    losing_side_best_point: "",
    confidence,
    runs: votes.map(legacyRun),
    demo: false,
    parties: [...parties],
    winner,
    votes,
    sides,
    others,
    ...(run.agreed_facts
      ? {
          two_sided: true as const,
          agreed_facts: run.agreed_facts,
          would_change: run.would_change ?? [],
          disputes: run.disputes ?? [],
        }
      : {}),
  };
}
