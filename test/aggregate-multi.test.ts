import { describe, expect, it } from "vitest";
import { aggregateMulti } from "../lib/aggregate-multi";
import type { MultiRunOutput } from "../lib/judge-multi";
import { appealOutcome } from "../lib/cases/outcome";
import { agreement, leanShare, tugFinal } from "../lib/verdict-display";
import { VerdictResult, type PartyId } from "../lib/types";

const P3: PartyId[] = ["a", "b", "c"];
const P4: PartyId[] = ["a", "b", "c", "d"];

function run(
  verdict: MultiRunOutput["verdict"],
  leaning: PartyId = verdict === "too_close" ? "a" : verdict,
  dispute_type: MultiRunOutput["dispute_type"] = "factual",
): MultiRunOutput {
  return {
    verdict,
    dispute_type,
    headline: `h-${verdict}`,
    why: `w-${verdict}`,
    crux: "c",
    sides: P4.map((party) => ({ party, claims: [{ claim: `claim ${party}`, kind: "fact" as const }], bedrock: `bedrock ${party}` })),
    facts_relied_on: [],
    others: P4.filter((p) => p !== verdict).map((party) => ({ party, line: `${party} fell short` })),
    leaning,
    leaning_reason: "lr",
  };
}

describe("aggregateMulti", () => {
  it("unanimous 3/3 on a side outside A and B", () => {
    const r = aggregateMulti([run("c"), run("c"), run("c")], P3);
    expect(r.winner).toBe("c");
    expect(r.confidence).toBe(5);
    expect(r.votes).toEqual(["c", "c", "c"]);
    expect(r.parties).toEqual(P3);
  });

  it("keeps the older fields valid: verdict is too_close for a C winner, runs are split", () => {
    const r = aggregateMulti([run("c"), run("c"), run("c")], P3);
    expect(r.verdict).toBe("too_close");
    expect(r.runs).toEqual(["split", "split", "split"]);
    expect(r.split_points).toBeNull();
    expect(r.conditional).toBeNull();
    expect(r.lean).toBeUndefined();
  });

  it("an A or B winner shows as side_a or side_b with true runs for them", () => {
    const a = aggregateMulti([run("a"), run("a"), run("b")], P3);
    expect(a.verdict).toBe("side_a");
    expect(a.runs).toEqual(["side_a", "side_a", "side_b"]);
    expect(aggregateMulti([run("b"), run("b"), run("b")], P3).verdict).toBe("side_b");
  });

  it("a majority with a dissenter naming another side is one confidence lower, floor 2", () => {
    const r = aggregateMulti([run("c"), run("c"), run("a")], P3);
    expect(r.winner).toBe("c");
    expect(r.confidence).toBe(2);
  });

  it("a dissenter who found it too close is not a different winner", () => {
    const r = aggregateMulti([run("c"), run("c"), run("too_close")], P3);
    expect(r.winner).toBe("c");
    expect(r.confidence).toBe(3);
  });

  it("5 runs: 4 for one side is 4, minus one for the dissenter", () => {
    const r = aggregateMulti([run("d"), run("d"), run("d"), run("d"), run("b")], P4);
    expect(r.winner).toBe("d");
    expect(r.confidence).toBe(3);
  });

  it("unanimous with different dispute types is 4", () => {
    const r = aggregateMulti([run("b", "b", "factual"), run("b", "b", "mixed"), run("b", "b", "factual")], P3);
    expect(r.confidence).toBe(4);
  });

  it("a plurality without a majority is too close when the leans scatter", () => {
    const r = aggregateMulti([run("a", "a"), run("b", "b"), run("c", "c")], P3);
    expect(r.winner).toBeNull();
    expect(r.verdict).toBe("too_close");
    expect(r.confidence).toBe(1);
    expect(r.headline).toBe("Too close to call");
    expect(r.why).toBeUndefined();
    expect(r.others).toEqual([]);
    expect(r.votes).toEqual(["a", "b", "c"]);
  });

  it("no majority, but every forced lean names one side that a run ruled for: that side wins at 2", () => {
    const r = aggregateMulti([run("c", "c"), run("a", "c"), run("too_close", "c")], P3);
    expect(r.winner).toBe("c");
    expect(r.confidence).toBe(2);
    expect(r.headline).toBe("h-c");
  });

  it("the leaned side needs a run that ruled for it", () => {
    const r = aggregateMulti([run("a", "c"), run("b", "c"), run("too_close", "c")], P3);
    expect(r.winner).toBeNull();
    expect(r.confidence).toBe(1);
  });

  it("two runs split 1-1 are no majority", () => {
    const r = aggregateMulti([run("a", "a"), run("c", "c")], P3);
    expect(r.winner).toBeNull();
  });

  it("a majority of too_close runs is a too-close verdict that keeps the run's own words", () => {
    const r = aggregateMulti([run("too_close"), run("too_close"), run("a")], P3);
    expect(r.winner).toBeNull();
    expect(r.verdict).toBe("too_close");
    expect(r.headline).toBe("h-too_close");
    expect(r.votes).toEqual(["other", "other", "a"]);
    expect(r.runs).toEqual(["split", "split", "side_a"]);
  });

  it("one line per non-winner, in side order, none for the winner", () => {
    const r = aggregateMulti([run("b"), run("b"), run("b")], P3);
    expect(r.others?.map((o) => o.party)).toEqual(["a", "c"]);
  });

  it("a single run counts as a majority but caps confidence at 2", () => {
    const r = aggregateMulti([run("d")], P4);
    expect(r.winner).toBe("d");
    expect(r.confidence).toBe(2);
  });

  it("sides follow the party list and fill the older argument_map", () => {
    const r = aggregateMulti([run("a"), run("a"), run("a")], P3);
    expect(r.sides?.map((s) => s.party)).toEqual(["a", "b", "c"]);
    expect(r.argument_map.side_a[0].claim).toBe("claim a");
    expect(r.argument_map.bedrock_b).toBe("bedrock b");
  });

  it("a side the run left out gets an empty entry and a placeholder claim in the older map", () => {
    const partial = { ...run("a"), sides: [run("a").sides[0]] };
    const r = aggregateMulti([partial, partial, partial], P3);
    expect(r.sides?.[2]).toEqual({ party: "c", claims: [], bedrock: "" });
    expect(r.argument_map.side_b).toHaveLength(1);
  });

  it("refuses an empty list", () => {
    expect(() => aggregateMulti([], P3)).toThrow();
  });

  it("separate accounts carry their fact fields and two_sided", () => {
    const acc = { ...run("c"), agreed_facts: ["f"], disputes: [], would_change: ["w"] };
    const r = aggregateMulti([acc, acc, acc], P3);
    expect(r.two_sided).toBe(true);
    expect(r.agreed_facts).toEqual(["f"]);
    expect(r.would_change).toEqual(["w"]);
    expect(r.disputes).toEqual([]);
  });

  it("the result parses with VerdictResult, and an older reader's shape (new keys stripped) still parses", () => {
    const r = aggregateMulti([run("c"), run("c"), run("c")], P3);
    expect(VerdictResult.safeParse(r).success).toBe(true);
    const oldShape = VerdictResult.omit({
      parties: true,
      winner: true,
      votes: true,
      sides: true,
      others: true,
      disputes: true,
    });
    const old = oldShape.safeParse(r);
    expect(old.success).toBe(true);
    expect(old.success && "winner" in old.data).toBe(false);
  });
});

describe("display helpers on a verdict with more than two sides", () => {
  const c = aggregateMulti([run("c"), run("c"), run("a")], P3);

  it("agreement counts the votes for the winner", () => {
    expect(agreement(c)).toEqual({ n: 2, total: 3 });
    expect(agreement(aggregateMulti([run("a", "a"), run("b", "b"), run("c", "c")], P3))).toBeNull();
  });

  it("has no tug and no lean bar", () => {
    expect(tugFinal(c)).toBe(50);
    expect(leanShare(c)).toBeNull();
  });

  it("agreement and tug on a two-sided verdict are what they were", () => {
    const two = VerdictResult.parse({
      verdict: "side_a",
      dispute_type: "factual",
      headline: "h",
      crux: "c",
      split_points: null,
      conditional: null,
      argument_map: { side_a: [{ claim: "a", kind: "fact" }], side_b: [{ claim: "b", kind: "fact" }], bedrock_a: "", bedrock_b: "" },
      facts_relied_on: [],
      losing_side_best_point: "",
      confidence: 4,
      runs: ["side_a", "side_a", "split"],
      demo: false,
    });
    expect(agreement(two)).toEqual({ n: 2, total: 3 });
    expect(tugFinal(two)).toBe(80);
    expect(leanShare(two)).toBe(1);
  });
});

describe("appealOutcome with more than two sides", () => {
  const win = (p: PartyId) => aggregateMulti([run(p), run(p), run(p)], P4);
  const close = aggregateMulti([run("a", "a"), run("b", "b"), run("c", "c")], P4);

  it("a different winner is overturned, even between sides the older verdict cannot tell apart", () => {
    expect(appealOutcome(win("c"), win("d"))).toBe("overturned");
    expect(appealOutcome(win("a"), win("c"))).toBe("overturned");
  });

  it("the same winner or too close twice is upheld", () => {
    expect(appealOutcome(win("c"), win("c"))).toBe("upheld");
    expect(appealOutcome(close, close)).toBe("upheld");
  });

  it("a winner that becomes too close, or the reverse, is changed", () => {
    expect(appealOutcome(win("c"), close)).toBe("changed");
    expect(appealOutcome(close, win("d"))).toBe("changed");
  });
});
