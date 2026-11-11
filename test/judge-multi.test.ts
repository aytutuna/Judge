import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/claude", async (orig) => ({ ...(await orig<typeof import("../lib/claude")>()), claudeJson: vi.fn() }));
vi.mock("../lib/premium/factcheck", async (orig) => ({
  ...(await orig<typeof import("../lib/premium/factcheck")>()),
  runFactCheck: vi.fn(),
}));

import { claudeJson, type ClaudeJsonCall } from "../lib/claude";
import { JUDGE_SCHEMA, judgeExtra, judgeOnce, PREMIUM_JUDGE_NOTE, TWO_SIDED_JUDGE_NOTE } from "../lib/judge";
import { multiAccountsNote, multiAppealNote, multiSchema, multiSystemPrompt, parseMultiRun } from "../lib/judge-multi";
import { composeSides, legacyRun, legacyVerdict, partiesFor, readingOrder, winnerOf } from "../lib/multi";
import { factCheckSystem, FACTCHECK_SYSTEM, runFactCheck } from "../lib/premium/factcheck";
import { judgePremiumPanel } from "../lib/premium/panel";
import { judgeAnonymized, refusedPremiumResult } from "../lib/premium/run";
import { adjudicatorSystem, ADJUDICATOR_SYSTEM, ATTACKER_SYSTEM, attackerSystem, shouldTryCrux } from "../lib/trial";
import { VerdictResult, type PartyId } from "../lib/types";
import { aggregateMulti } from "../lib/aggregate-multi";

const mockClaude = vi.mocked(claudeJson);
const mockFact = vi.mocked(runFactCheck);
const P3: PartyId[] = ["a", "b", "c"];
const P4: PartyId[] = ["a", "b", "c", "d"];

function runJson(verdict: string, parties: PartyId[] = P3, leaning: PartyId = "c") {
  return {
    verdict,
    dispute_type: "factual",
    headline: "h",
    why: "w",
    crux: "c",
    sides: parties.map((party) => ({ party, claims: [{ claim: `c ${party}`, kind: "fact" }], bedrock: `b ${party}` })),
    facts_relied_on: [],
    others: parties.filter((p) => p !== verdict).map((party) => ({ party, line: `l ${party}` })),
    leaning,
    leaning_reason: "lr",
  };
}

const TWO_RUN = {
  verdict: "side_a",
  dispute_type: "factual",
  headline: "h",
  why: "w",
  crux: "c",
  split_points: null,
  conditional: null,
  argument_map: { side_a: [{ claim: "a", kind: "fact" }], side_b: [{ claim: "b", kind: "fact" }], bedrock_a: "", bedrock_b: "" },
  facts_relied_on: [],
  losing_side_best_point: "p",
  leaning: "side_a",
  leaning_reason: "lr",
};

const call = (i = 0) => mockClaude.mock.calls[i][0] as ClaudeJsonCall;

beforeEach(() => {
  mockClaude.mockReset();
  mockFact.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("multi helpers", () => {
  it("partiesFor gives the first sides, between two and four", () => {
    expect(partiesFor(3)).toEqual(P3);
    expect(partiesFor(9)).toEqual(P4);
  });

  it("winnerOf reads winner on a many-sided result and verdict on a two-sided one", () => {
    expect(winnerOf({ verdict: "too_close", parties: P3, winner: "c" })).toBe("c");
    expect(winnerOf({ verdict: "too_close", parties: P3, winner: null })).toBeNull();
    expect(winnerOf({ verdict: "side_b" })).toBe("b");
    expect(winnerOf({ verdict: "split" })).toBeNull();
  });

  it("the older projection keeps only a real A or B winner", () => {
    expect(legacyVerdict("a")).toBe("side_a");
    expect(legacyVerdict("d")).toBe("too_close");
    expect(legacyVerdict(null)).toBe("too_close");
    expect(legacyRun("b")).toBe("side_b");
    expect(legacyRun("c")).toBe("split");
    expect(legacyRun("other")).toBe("split");
  });

  it("reading order rotates by seat", () => {
    expect(readingOrder(P3, 0)).toEqual(["a", "b", "c"]);
    expect(readingOrder(P3, 1)).toEqual(["b", "c", "a"]);
    expect(readingOrder(P3, 5)).toEqual(["c", "a", "b"]);
    expect(readingOrder(P4, 2)).toEqual(["c", "d", "a", "b"]);
  });

  it("composeSides labels each side's text", () => {
    expect(composeSides([{ party: "a", text: "x" }, { party: "c", text: "y" }])).toBe("PARTY A'S SIDE:\nx\n\nPARTY C'S SIDE:\ny");
  });
});

describe("multiSchema", () => {
  it("keeps the forced ruling LAST in properties and required", () => {
    for (const accounts of [false, true]) {
      const s = multiSchema(P3, accounts);
      expect(Object.keys(s.properties).slice(-2)).toEqual(["leaning", "leaning_reason"]);
      expect(s.required.slice(-2)).toEqual(["leaning", "leaning_reason"]);
      expect(s.required).toEqual(Object.keys(s.properties));
    }
  });

  it("lets a judge choose among the listed sides or too_close", () => {
    const s = multiSchema(P3, false);
    expect(s.properties.verdict.enum).toEqual(["a", "b", "c", "too_close"]);
    expect(s.properties.leaning.enum).toEqual(["a", "b", "c"]);
    expect(multiSchema(P4, false).properties.leaning.enum).toEqual(["a", "b", "c", "d"]);
  });

  it("adds the account fields only for separate accounts, before the forced ruling", () => {
    expect(Object.keys(multiSchema(P3, false).properties)).not.toContain("disputes");
    const keys = Object.keys(multiSchema(P3, true).properties);
    expect(keys.slice(-5)).toEqual(["agreed_facts", "disputes", "would_change", "leaning", "leaning_reason"]);
  });

  it("leaves the two-sided schema untouched", () => {
    expect(JUDGE_SCHEMA.properties.verdict.enum).toEqual(["side_a", "side_b", "split", "conditional", "dissolved"]);
  });
});

describe("multiSystemPrompt", () => {
  it("names every side and the allowed answers", () => {
    const p = multiSystemPrompt(P4, 0, "en");
    expect(p).toContain("among 4 parties: Party A, Party B, Party C and Party D");
    expect(p).toContain('"a", "b", "c", "d"');
    expect(p).toContain('"too_close"');
  });

  it("asks every others line to begin with its side's label", () => {
    expect(multiSystemPrompt(P3, 0, "en")).toContain("must begin with that side's label (\"Party C\"");
  });

  it("has no B-first note and no two-party wording", () => {
    const p = multiSystemPrompt(P3, 1, "en");
    expect(p).not.toContain("Party B's case fully before");
    expect(p).not.toContain("between two parties");
  });

  it("seat 0 reads in order with no process note; later seats name their order", () => {
    expect(multiSystemPrompt(P3, 0, "en")).not.toContain("PROCESS NOTE");
    expect(multiSystemPrompt(P3, 1, "en")).toContain("in this order: Party B, Party C, Party A");
    expect(multiSystemPrompt(P3, 3, "en")).not.toContain("PROCESS NOTE");
  });

  it("asks for one line per non-winner and none for too_close", () => {
    expect(multiSystemPrompt(P3, 0, "en")).toContain("An empty array when the verdict is \"too_close\"");
  });

  it("writes in the asked language and keeps the enums English", () => {
    const p = multiSystemPrompt(P3, 0, "tr");
    expect(p).toContain("LANGUAGE: Write every free-text output field");
    expect(p).toContain("Taraf");
    expect(p).toContain("Keep all JSON enum values exactly as specified");
  });

  it("accounts and appeal notes are worded for the sides", () => {
    expect(multiAccountsNote(P3)).toContain("3 separate accounts");
    expect(multiAccountsNote(P3)).toContain("\"Party C's account\"");
    expect(multiAppealNote("c")).toContain("Party C added NEW CONTEXT");
  });
});

describe("parseMultiRun", () => {
  it("accepts a run on the listed sides", () => {
    const r = parseMultiRun(runJson("c"), P3);
    expect(r.ok).toBe(true);
  });

  it("rejects a winner or a lean outside the dispute", () => {
    expect(parseMultiRun(runJson("d", P4), P3).ok).toBe(false);
    expect(parseMultiRun(runJson("a", P3, "d" as PartyId), P3).ok).toBe(false);
    expect(parseMultiRun({ verdict: "side_a" }, P3).ok).toBe(false);
  });

  it("drops entries for sides that are not in the dispute", () => {
    const r = parseMultiRun(runJson("a", P4), P3);
    expect(r.ok && r.data.sides.map((s) => s.party)).toEqual(["a", "b", "c"]);
    expect(r.ok && r.data.others.map((o) => o.party)).toEqual(["b", "c"]);
  });
});

describe("judgeOnce with several sides", () => {
  it("sends the many-sided schema and prompt and parses the run", async () => {
    mockClaude.mockResolvedValue({ ok: true, data: runJson("c") } as never);
    const res = await judgeOnce("DOC", { parties: P3, seat: 1, lang: "en" });
    expect(res.ok && (res.data as { verdict: string }).verdict).toBe("c");
    expect(call().schema).toEqual(multiSchema(P3, false));
    expect(call().system).toContain("in this order: Party B, Party C, Party A");
    expect(call().user).toBe("THE ARGUMENT:\n\nDOC");
  });

  it("uses the accounts note and heading for separate accounts", async () => {
    mockClaude.mockResolvedValue({ ok: true, data: { ...runJson("c"), agreed_facts: [], disputes: [], would_change: [] } } as never);
    await judgeOnce("DOC", { parties: P3, twoSided: true });
    expect(call().system).toContain(multiAccountsNote(P3));
    expect(call().system).not.toContain(TWO_SIDED_JUDGE_NOTE);
    expect(call().user).toBe("THE CASE:\n\nDOC");
    expect(call().schema).toEqual(multiSchema(P3, true));
  });

  it("carries the premium note", async () => {
    mockClaude.mockResolvedValue({ ok: true, data: runJson("a") } as never);
    await judgeOnce("DOC", { parties: P3, premium: true });
    expect(call().system).toContain(PREMIUM_JUDGE_NOTE);
  });

  it("reports a reply with a winner outside the sides as a schema mismatch", async () => {
    mockClaude.mockResolvedValue({ ok: true, data: runJson("d", P4) } as never);
    const res = await judgeOnce("DOC", { parties: P3 });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toMatch(/schema mismatch/);
  });

  it("two parties still take the two-sided path", async () => {
    mockClaude.mockResolvedValue({ ok: true, data: {} } as never);
    await judgeOnce("DOC", { parties: ["a", "b"] });
    expect(call().schema).toBe(JUDGE_SCHEMA);
  });
});

describe("judgeExtra and the panel with several sides", () => {
  it("extra runs rotate the reading order instead of B-first", async () => {
    mockClaude.mockResolvedValue({ ok: true, data: runJson("c") } as never);
    await judgeExtra(2, "DOC", "en", { parties: P3 });
    expect(call(0).system).toContain("in this order: Party B, Party C, Party A");
    expect(call(1).system).toContain("in this order: Party C, Party A, Party B");
  });

  it("each seat gets its own reading order", async () => {
    mockClaude.mockResolvedValue({ ok: true, data: runJson("c") } as never);
    const seats = [
      { model: "claude-sonnet-5-5", analyzeBFirst: false, effort: "medium" as const },
      { model: "claude-sonnet-5-5", analyzeBFirst: true, effort: "medium" as const },
      { model: "claude-haiku-5-5", analyzeBFirst: false, effort: "medium" as const },
    ];
    await judgePremiumPanel("DOC", "en", null, seats, { parties: P3 });
    const systems = [0, 1, 2].map((i) => call(i).system);
    expect(systems[0]).not.toContain("PROCESS NOTE");
    expect(systems[1]).toContain("in this order: Party B, Party C, Party A");
    expect(systems[2]).toContain("in this order: Party C, Party A, Party B");
  });
});

describe("prompts for the fact check and the crux trial", () => {
  it("two sides keep the prompts as they are", () => {
    expect(factCheckSystem()).toBe(FACTCHECK_SYSTEM);
    expect(attackerSystem()).toBe(ATTACKER_SYSTEM);
    expect(adjudicatorSystem(2)).toBe(ADJUDICATOR_SYSTEM);
  });

  it("more sides are worded for all of them", () => {
    expect(factCheckSystem(3)).toContain("dispute among 3 parties");
    expect(factCheckSystem(3)).toContain("Party A, Party B and Party C");
    expect(factCheckSystem(3)).not.toContain("two-party");
    expect(attackerSystem(4)).toContain("among Party A, Party B, Party C and Party D");
    expect(adjudicatorSystem(3)).toContain("among Party A, Party B and Party C");
    expect(attackerSystem(3)).not.toContain("between Party A and Party B");
  });

  it("the trial is tried on a many-sided winner, not on a too-close result", () => {
    const win = aggregateMulti([1, 2, 3].map(() => ({ ...parsed("c") })), P3);
    expect(shouldTryCrux(win)).toBe(true);
    const close = aggregateMulti([parsed("a", "a"), parsed("b", "b"), parsed("c", "c")], P3);
    expect(shouldTryCrux(close)).toBe(false);
  });
});

function parsed(verdict: string, leaning: PartyId = "c") {
  const r = parseMultiRun(runJson(verdict, P3, leaning), P3);
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

describe("refusedPremiumResult", () => {
  it("is the same for two sides and carries the sides for more", () => {
    const two = refusedPremiumResult("en");
    expect(two.parties).toBeUndefined();
    const many = refusedPremiumResult("en", P3);
    expect(many.parties).toEqual(P3);
    expect(many.winner).toBeNull();
    expect(many.sides).toHaveLength(3);
    expect(VerdictResult.safeParse(many).success).toBe(true);
  });
});

describe("judgeAnonymized with several sides", () => {
  it("judges, aggregates among the sides and words the fact check for them", async () => {
    mockFact.mockResolvedValue({ status: "none", claims: [] });
    mockClaude.mockImplementation(async () => ({ ok: true, data: runJson("c") }) as never);
    const out = await judgeAnonymized({ text: "DOC", context: null, lang: "en", parties: P3 });
    expect(out.status).toBe("ok");
    if (out.status !== "ok") return;
    expect(out.result.winner).toBe("c");
    expect(out.result.parties).toEqual(P3);
    expect(out.result.verdict).toBe("too_close");
    expect(out.result.tier).toBe("premium");
    expect(mockFact).toHaveBeenCalledWith("DOC", "en", 3);
    // every judge seat was asked the many-sided question; the trial follows, worded for three sides
    const calls = mockClaude.mock.calls.map(([c]) => c as ClaudeJsonCall);
    const judges = calls.filter((c) => c.system.startsWith("You are Verdict"));
    expect(judges).toHaveLength(3);
    for (const c of judges) expect(JSON.stringify(c.schema)).toContain("too_close");
    const attack = calls.find((c) => c.system.includes("cross-examiner"));
    expect(attack?.system).toContain("among Party A, Party B and Party C");
    expect(attack?.user).toContain("WINNING SIDE: Party C");
    expect(attack?.user).toContain("PARTY B'S BEDROCK PREMISE: b b");
  });

  it("escalates a low-confidence result with more runs, counted among the sides", async () => {
    mockFact.mockResolvedValue({ status: "none", claims: [] });
    const first = ["a", "b", "c"];
    let judged = 0;
    mockClaude.mockImplementation(async (c) => {
      if (!c.system.startsWith("You are Verdict")) return { ok: true, data: { attack: "", has_substantive_attack: false } } as never;
      const verdict = first[judged] ?? "c";
      judged += 1;
      return { ok: true, data: runJson(verdict) } as never;
    });
    const out = await judgeAnonymized({ text: "DOC", context: null, lang: "en", parties: P3 });
    expect(out.status === "ok" && out.result.escalated).toBe(true);
    expect(out.status === "ok" && out.result.votes).toEqual(["a", "b", "c", "c", "c"]);
    expect(out.status === "ok" && out.result.winner).toBe("c");
    expect(out.status === "ok" && out.result.panel?.models).toHaveLength(5);
  });

  it("a two-sided document is judged and fact-checked exactly as before", async () => {
    mockFact.mockResolvedValue({ status: "none", claims: [] });
    mockClaude.mockImplementation(async () => ({ ok: true, data: TWO_RUN }) as never);
    const out = await judgeAnonymized({ text: "DOC", context: null, lang: "en" });
    expect(mockFact).toHaveBeenCalledWith("DOC", "en");
    expect(out.status === "ok" && out.result.verdict).toBe("side_a");
    expect(out.status === "ok" && out.result.parties).toBeUndefined();
  });
});
