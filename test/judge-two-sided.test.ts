import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/claude", () => ({ claudeJson: vi.fn() }));

import { claudeJson, type ClaudeJsonCall } from "../lib/claude";
import {
  APPEAL_JUDGE_NOTE,
  EVIDENCE_JUDGE_NOTE,
  JUDGE_SCHEMA,
  judgeExtra,
  judgeOnce,
  PREMIUM_JUDGE_NOTE,
  TWO_SIDED_JUDGE_NOTE,
  TWO_SIDED_JUDGE_SCHEMA,
} from "../lib/judge";
import { TwoSidedJudgeRunOutput, type JudgeRunOutput } from "../lib/types";

const mockClaude = vi.mocked(claudeJson);

const RUN: JudgeRunOutput = {
  verdict: "side_a",
  dispute_type: "factual",
  headline: "h",
  crux: "c",
  split_points: null,
  conditional: null,
  argument_map: {
    side_a: [{ claim: "a", kind: "fact" }],
    side_b: [{ claim: "b", kind: "fact" }],
    bedrock_a: "ba",
    bedrock_b: "bb",
  },
  facts_relied_on: [],
  losing_side_best_point: "p",
  leaning: "side_a",
  leaning_reason: "lr",
};

const TWO = {
  ...RUN,
  agreed_facts: ["There was a bill"],
  disputed_facts: [{ fact: "Paid?", party_a: "yes", party_b: "no", finding: "unsettled", decisive: true }],
  would_change: ["A bank record"],
};

const call = (i = 0) => mockClaude.mock.calls[i][0] as ClaudeJsonCall;

beforeEach(() => {
  mockClaude.mockReset();
});

describe("TWO_SIDED_JUDGE_SCHEMA", () => {
  it("keeps the forced ruling LAST in properties and required, for both schemas", () => {
    for (const schema of [JUDGE_SCHEMA, TWO_SIDED_JUDGE_SCHEMA]) {
      expect(Object.keys(schema.properties).slice(-2)).toEqual(["leaning", "leaning_reason"]);
      expect(schema.required.slice(-2)).toEqual(["leaning", "leaning_reason"]);
    }
  });

  it("is JUDGE_SCHEMA up to losing_side_best_point, then the two-account fields", () => {
    const base = Object.keys(JUDGE_SCHEMA.properties).slice(0, -2);
    expect(Object.keys(TWO_SIDED_JUDGE_SCHEMA.properties)).toEqual([
      ...base,
      "agreed_facts",
      "disputed_facts",
      "would_change",
      "leaning",
      "leaning_reason",
    ]);
    expect(TWO_SIDED_JUDGE_SCHEMA.required).toEqual([...base, "agreed_facts", "disputed_facts", "would_change", "leaning", "leaning_reason"]);
    expect(TWO_SIDED_JUDGE_SCHEMA.properties.disputed_facts.items.properties.finding.enum).toEqual(["a", "b", "unsettled"]);
  });

  it("TwoSidedJudgeRunOutput parses a run and rejects a bad finding", () => {
    expect(TwoSidedJudgeRunOutput.parse(TWO).disputed_facts[0].decisive).toBe(true);
    const bad = { ...TWO, disputed_facts: [{ ...TWO.disputed_facts[0], finding: "maybe" }] };
    expect(TwoSidedJudgeRunOutput.safeParse(bad).success).toBe(false);
    expect(TwoSidedJudgeRunOutput.safeParse(RUN).success).toBe(false);
  });
});

describe("judgeOnce options", () => {
  it("a premium run without case options sends exactly the old prompt, heading and schema", async () => {
    mockClaude.mockResolvedValue({ ok: true, data: RUN });
    await judgeOnce("Party A says x.", { preset: "balanced" }, { premium: true, context: "FACT-CHECK x" });
    await judgeOnce("Party A says x.", { preset: "balanced" }, {});
    const premium = call(0);
    const plain = call(1);
    expect(premium.system).toBe(`${plain.system}\n\n${PREMIUM_JUDGE_NOTE}`);
    expect(premium.user).toBe("THE ARGUMENT:\n\nParty A says x.\n\nFACT-CHECK x");
    expect(premium.schema).toBe(JUDGE_SCHEMA);
    expect(plain.user).toBe("THE ARGUMENT:\n\nParty A says x.");
    for (const note of [TWO_SIDED_JUDGE_NOTE, EVIDENCE_JUDGE_NOTE, APPEAL_JUDGE_NOTE]) {
      expect(premium.system).not.toContain(note);
    }
  });

  it("two-sided: the note, THE CASE heading, the two-sided schema, and the arrays survive parsing", async () => {
    mockClaude.mockResolvedValue({ ok: true, data: TWO });
    const run = await judgeOnce("PARTY A'S ACCOUNT ...", { preset: "balanced" }, {
      premium: true,
      twoSided: true,
      evidence: true,
      appeal: APPEAL_JUDGE_NOTE,
      context: "EVIDENCE ...",
    });
    const c = call();
    expect(c.system.endsWith(`${PREMIUM_JUDGE_NOTE}\n\n${EVIDENCE_JUDGE_NOTE}\n\n${TWO_SIDED_JUDGE_NOTE}\n\n${APPEAL_JUDGE_NOTE}`)).toBe(true);
    expect(c.user).toBe("THE CASE:\n\nPARTY A'S ACCOUNT ...\n\nEVIDENCE ...");
    expect(c.schema).toBe(TWO_SIDED_JUDGE_SCHEMA);
    expect(run.ok && (run.data as typeof TWO).agreed_facts).toEqual(["There was a bill"]);
  });

  it("a two-sided run missing the arrays is a schema mismatch", async () => {
    mockClaude.mockResolvedValue({ ok: true, data: RUN });
    const run = await judgeOnce("x", { preset: "balanced" }, { twoSided: true });
    expect(run.ok).toBe(false);
  });

  it("judgeExtra passes the case options to every run", async () => {
    mockClaude.mockResolvedValue({ ok: true, data: TWO });
    await judgeExtra(2, "doc", { preset: "balanced" }, "en", { premium: true, twoSided: true, evidence: true });
    expect(mockClaude).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 2; i++) {
      expect(call(i).schema).toBe(TWO_SIDED_JUDGE_SCHEMA);
      expect(call(i).system).toContain(TWO_SIDED_JUDGE_NOTE);
      expect(call(i).system).toContain(EVIDENCE_JUDGE_NOTE);
    }
  });
});
