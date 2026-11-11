import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const claudeJson = vi.hoisted(() => vi.fn());

vi.mock("@/lib/claude", () => ({
  claudeJson,
  hasApiKey: () => Boolean(process.env.ANTHROPIC_API_KEY),
  LITE_MODEL: "test-model",
}));

import {
  accountQualityIssues,
  heldCandidates,
  normalizeNameMap,
  qualityLines,
  sideLabels,
  trAccountRules,
} from "../lib/anonymize";
import {
  anonymizeSubmission,
  findLeak,
  labelSelfReplaced,
  reconcileLabels,
  relabelText,
  submissionSystem,
  unexplainedLabels,
} from "../lib/evidence/anonymize";
import {
  canonicalLabel,
  consistentSelfMap,
  localizeLabels,
  partyNames,
  partyNamesFor,
  personalizeResult,
  resolveParties,
  restoreNames,
} from "../lib/names";
import { defaultDisplay, normalizeDisplay, publicNameMap, VerdictDisplayPatch } from "../lib/originals-types";
import { aggregateMulti } from "../lib/aggregate-multi";
import type { MultiRunOutput } from "../lib/judge-multi";
import type { NameMapping, PartyId } from "../lib/types";

const P3: PartyId[] = ["a", "b", "c"];

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  claudeJson.mockReset();
  vi.unstubAllEnvs();
});

describe("labels with more than two sides", () => {
  it("a two-sided document does not read Party C as a label", () => {
    expect(canonicalLabel("Party C")).toBeNull();
    expect(canonicalLabel("Person C")).toBe("Person C");
  });

  it("sides take Party A to the last side and other people start at Person E", () => {
    expect(canonicalLabel("Party C", 3)).toBe("Party C");
    expect(canonicalLabel("taraf c'ye", 3)).toBe("Party C");
    expect(canonicalLabel("Party D", 3)).toBeNull();
    expect(canonicalLabel("Party D", 4)).toBe("Party D");
    expect(canonicalLabel("Person C", 3)).toBeNull();
    expect(canonicalLabel("Person D", 4)).toBeNull();
    expect(canonicalLabel("Kişi E", 3)).toBe("Person E");
  });

  it("old name maps still resolve for a two-sided document", () => {
    const map: NameMapping[] = [
      { original: "I", replacement: "Party A" },
      { original: "Deniz", replacement: "Party B" },
      { original: "Ayşe", replacement: "Person C" },
    ];
    const parties = resolveParties(map, "en", "A");
    expect(parties.get("C")?.name).toBe("Ayşe");
    expect(parties.get("B")?.name).toBe("Deniz");
  });

  it("resolves Party C and a bystander on their own letters", () => {
    const map: NameMapping[] = [
      { original: "I", replacement: "Party A" },
      { original: "Deniz", replacement: "Party B" },
      { original: "Cem", replacement: "Party C" },
      { original: "Ayşe", replacement: "Person E" },
    ];
    const parties = resolveParties(map, "en", "A", { sides: 3 });
    expect([...parties.keys()].sort()).toEqual(["A", "B", "C", "E"]);
    expect(parties.get("C")?.name).toBe("Cem");
    expect(parties.get("A")?.self).toBe(true);
  });

  it("a narrator word on a side that is not the viewer is a name, not 'you'", () => {
    const map: NameMapping[] = [{ original: "I", replacement: "Party C" }];
    const viewer = resolveParties(map, "en", "C", { sides: 3 });
    expect(viewer.get("C")?.self).toBe(true);
    const other = resolveParties(map, "en", "A", { sides: 3 });
    expect(other.get("C")).toEqual({ name: "I", self: false });
  });

  it("partyNames keeps its two-party answer", () => {
    expect(partyNames([{ original: "Deniz", replacement: "Party B" }], "en")).toMatchObject({ nameA: "Party A", nameB: "Deniz" });
  });

  it("partyNamesFor names every side, 'you' for the viewer and the label otherwise", () => {
    const map: NameMapping[] = [
      { original: "I", replacement: "Party C" },
      { original: "Deniz", replacement: "Party B" },
    ];
    const names = partyNamesFor(P3, map, "en", "en", "C");
    expect(names.c).toEqual({ name: "You", self: true });
    expect(names.b).toEqual({ name: "Deniz", self: false });
    expect(names.a).toEqual({ name: "Party A", self: false });
  });

  it("partyNamesFor marks the viewer's party when the map says nothing, in the language of the label", () => {
    const names = partyNamesFor(P3, [], "tr", "tr", "C", true);
    expect(names.c.self).toBe(true);
    expect(names.a.name).toBe("Taraf A");
    expect(names.b.name).toBe("Taraf B");
  });

  it("restores names for Party C and leaves Person C alone in a two-sided text", () => {
    const parties = resolveParties(
      [
        { original: "Cem", replacement: "Party C" },
        { original: "Ayşe", replacement: "Person E" },
      ],
      "en",
      "A",
      { sides: 3 },
    );
    expect(restoreNames("Party C is right and Person E agrees.", parties, "en", 3)).toBe("Cem is right and Ayşe agrees.");
    const two = resolveParties([{ original: "Ayşe", replacement: "Person C" }], "en", "A");
    expect(restoreNames("Person C agrees. Party C does not exist.", two, "en")).toBe("Ayşe agrees. Party C does not exist.");
  });

  it("restores Turkish suffixes on the extra sides", () => {
    const parties = resolveParties([{ original: "Cem", replacement: "Party C" }], "tr", "A", { sides: 3 });
    expect(restoreNames("Taraf C'nin iddiası", parties, "tr", 3)).toBe("Cem'in iddiası");
  });

  it("localizes Party C into Turkish for a many-sided text only", () => {
    expect(localizeLabels("Party C and Person E", "tr", 3)).toBe("Taraf C and Kişi E");
    expect(localizeLabels("Party C and Person C", "tr")).toBe("Party C and Kişi C");
  });

  it("personalizes the new fields of a verdict", () => {
    const run = (verdict: MultiRunOutput["verdict"]): MultiRunOutput => ({
      verdict,
      dispute_type: "values",
      headline: "Party C wins",
      why: "Party C kept the promise",
      crux: "x",
      sides: P3.map((party) => ({ party, claims: [{ claim: `Party ${party.toUpperCase()} said so`, kind: "fact" as const }], bedrock: `Party ${party.toUpperCase()} cares` })),
      facts_relied_on: [],
      others: [{ party: "a", line: "Party A was late" }, { party: "b", line: "Party B shrugged" }],
      leaning: "c",
      leaning_reason: "r",
    });
    const result = aggregateMulti([run("c"), run("c"), run("c")], P3);
    const map: NameMapping[] = [
      { original: "Dana", replacement: "Party A" },
      { original: "Bo", replacement: "Party B" },
      { original: "Cem", replacement: "Party C" },
    ];
    const out = personalizeResult(result, map, "en", "A", { noSelf: true });
    expect(out.headline).toBe("Cem wins");
    expect(out.sides?.[2].claims[0].claim).toBe("Cem said so");
    expect(out.sides?.[0].bedrock).toBe("Dana cares");
    expect(out.others?.map((o) => o.line)).toEqual(["Dana was late", "Bo shrugged"]);
    expect(out.winner).toBe("c");
  });

  it("consistentSelfMap works for a viewer on the third side", () => {
    const run: MultiRunOutput = {
      verdict: "c",
      dispute_type: "values",
      headline: "Party C wins",
      why: "w",
      crux: "x",
      sides: [],
      facts_relied_on: [],
      others: [],
      leaning: "c",
      leaning_reason: "r",
    };
    const result = aggregateMulti([run, run, run], P3);
    const map: NameMapping[] = [{ original: "I", replacement: "Party C" }];
    expect(consistentSelfMap(result, map, "en", "C").selfDropped).toBe(false);
  });
});

describe("display names for more than two sides", () => {
  it("keeps the two-sided shape when there are two sides", () => {
    const d = defaultDisplay([{ original: "Deniz", replacement: "Party B" }], "en");
    expect(d).toEqual({ a: null, b: "Deniz", others: {} });
    expect(normalizeDisplay({ a: "Dana", b: null, others: {} })).toEqual({ a: "Dana", b: null, others: {} });
  });

  it("defaults the third and fourth side to their first names and bystanders to E and up", () => {
    const map: NameMapping[] = [
      { original: "I", replacement: "Party A" },
      { original: "Cem Aksoy", replacement: "Party C" },
      { original: "Derya", replacement: "Party D" },
      { original: "Ayşe", replacement: "Person E" },
    ];
    expect(defaultDisplay(map, "en", 4)).toEqual({ a: null, b: null, c: "Cem", d: "Derya", others: { "Person E": "Ayşe" } });
    expect(defaultDisplay(map, "en", 3).d).toBeNull();
  });

  it("round-trips c and d through storage and the public name map", () => {
    const d = normalizeDisplay({ a: null, b: "Bo", c: "Cem", d: " ", others: {} });
    expect(d).toEqual({ a: null, b: "Bo", c: "Cem", others: {} });
    expect(publicNameMap(d)).toEqual([
      { original: "Bo", replacement: "Party B" },
      { original: "Cem", replacement: "Party C" },
    ]);
  });

  it("the display patch takes c and d", () => {
    expect(VerdictDisplayPatch.safeParse({ c: "Cem", d: null }).success).toBe(true);
    expect(VerdictDisplayPatch.safeParse({ e: "x" }).success).toBe(false);
  });
});

describe("anonymizer guards for more sides", () => {
  it("sideLabels is the first sides, two at least", () => {
    expect(sideLabels(2)).toEqual(["Party A", "Party B"]);
    expect(sideLabels(4)).toEqual(["Party A", "Party B", "Party C", "Party D"]);
    expect(sideLabels(1)).toEqual(["Party A", "Party B"]);
  });

  it("an account must name at least one of the other sides", () => {
    const opts = { narrator: "Party C", opponentRequired: true, sides: 3 } as const;
    expect(accountQualityIssues("I paid", "Party C paid", opts)).toContain("opponent_missing");
    expect(accountQualityIssues("I paid", "Party C paid Party A", opts)).not.toContain("opponent_missing");
    expect(accountQualityIssues("I paid", "Party C paid Party B", opts)).not.toContain("opponent_missing");
    // Party C itself does not count as the other side.
    expect(accountQualityIssues("I paid", "Party C paid Party C", opts)).toContain("opponent_missing");
  });

  it("two sides keep the old opponent check", () => {
    const opts = { narrator: "Party B", opponentRequired: true } as const;
    expect(accountQualityIssues("I paid", "Party B paid Party C", opts)).toContain("opponent_missing");
    expect(accountQualityIssues("I paid", "Party B paid Party A", opts)).not.toContain("opponent_missing");
  });

  it("a Turkish opinion word after the third side's label is caught", () => {
    expect(accountQualityIssues("x", "Party C bence ödemedi", { narrator: "Party C", opponentRequired: false, sides: 3 })).toContain("self_label_misuse");
    expect(accountQualityIssues("x", "Party C bence ödemedi", { narrator: "Party B", opponentRequired: false })).not.toContain("self_label_misuse");
  });

  it("flagged words are held unless two sides have been labelled", () => {
    const text = "Party C went to Berlin";
    expect(heldCandidates("Cem went to Berlin and Berlin was cold", text, ["Berlin"], 3)).toEqual(["Berlin"]);
    expect(heldCandidates("x", "Party C met Party A in Berlin", ["Berlin"], 3)).toEqual([]);
    expect(heldCandidates("Cem went to Berlin and Berlin was cold", "Party A met Party B in Berlin", ["Berlin"])).toEqual([]);
  });

  it("normalizes a third side's narrator to I and keeps its other sides", () => {
    const map = normalizeNameMap(
      [
        { original: "me", replacement: "Party C" },
        { original: "Dana", replacement: "Party A" },
      ],
      "I told Dana",
      "Party C told Party A",
      { narrator: "Party C", sides: 3 },
    );
    expect(map).toEqual([
      { original: "I", replacement: "Party C" },
      { original: "Dana", replacement: "Party A" },
    ]);
  });

  it("adds the narrator entry for the third side when the model forgot it", () => {
    const map = normalizeNameMap([{ original: "Dana", replacement: "Party A" }], "I told Dana", "Party C told Party A", {
      narrator: "Party C",
      sides: 3,
    });
    expect(map[0]).toEqual({ original: "I", replacement: "Party C" });
  });

  it("a stray Party D in a three-sided map is not a label", () => {
    const map = normalizeNameMap([{ original: "Dana", replacement: "Party D" }], "x", "x", { narrator: "Party A", sides: 3 });
    expect(map.every((m) => canonicalLabel(m.replacement, 3) !== "Party D")).toBe(true);
  });

  it("explains labels with the sides' own letters", () => {
    expect(unexplainedLabels(["Party C met Person E"], [], [], 3)).toEqual(["Person E"]);
    expect(unexplainedLabels(["Party C met Person E"], [{ original: "Zoe", replacement: "Person E" }], [], 3)).toEqual([]);
    expect(unexplainedLabels(["Party C"], [], [])).toEqual([]);
  });

  it("relabels and reconciles on the sides' own letters", () => {
    expect(relabelText("Person E and Party C", new Map([["Person E", "Person F"]]), 3)).toBe("Person F and Party C");
    const keys = (name: string) => [name.toLowerCase()];
    const relabel = reconcileLabels(
      [{ original: "Dana", replacement: "Person E" }],
      [{ label: "Party B", key: "dana" }],
      keys,
      3,
    );
    expect(relabel.get("Person E")).toBe("Party B");
  });

  it("gives the next unnamed person Person E and up, never a side's letter", () => {
    const out = labelSelfReplaced([{ original: "Zoe", replacement: "Zoe" }], new Set(["Party A", "Party B", "Party C"]), false, "I met Zoe today", 3);
    expect(out[0].replacement).toBe("Person E");
    const two = labelSelfReplaced([{ original: "Zoe", replacement: "Zoe" }], new Set(["Party A", "Party B"]), false, "I met Zoe today");
    expect(two[0].replacement).toBe("Person C");
  });

  it("does not count a side's label as a leaked name", () => {
    expect(findLeak([{ original: "Party C", replacement: "Party C" }], ["Party C said so"], undefined, 3)).toBeNull();
  });

  it("the retry hint names the other sides", () => {
    const lines = qualityLines(["opponent_missing"], "Party C", "Party A", 3).join("\n");
    expect(lines).toContain('"Party A", "Party B"');
    expect(lines).not.toContain('"Party C"');
    expect(qualityLines(["opponent_missing"], "Party A", "Party B")[0]).toContain('That person is ALWAYS "Party B"');
  });

  it("the Turkish rules render suffixes for the extra letters", () => {
    expect(trAccountRules("Party C", "Party A")).toContain("Party C'ye göre");
    expect(trAccountRules("Party D", "Party A")).toContain("Party D'ye göre");
  });
});

describe("submissionSystem for more sides", () => {
  const base = { twoSided: true, roster: undefined } as const;

  it("two sides: the prompt is the one it always was", () => {
    const plain = submissionSystem({ narrator: "Party B", ...base });
    const counted = submissionSystem({ narrator: "Party B", ...base, sides: { count: 2, names: [] } });
    expect(plain).toContain("Use \"Person C\" and up only for people other than the two parties");
    expect(plain).toContain('The labels are always exactly "Party A", "Party B", "Person C"');
    expect(counted).toBe(plain);
  });

  it("lists every side, sends other people to Person E and up, and gives known names", () => {
    const p = submissionSystem({
      narrator: "Party C",
      ...base,
      sides: { count: 4, names: ["Dana", null, "Cem", "Derya"] },
    });
    expect(p).toContain('The narrator is ALWAYS "Party C"');
    expect(p).toContain('The dispute has 4 sides: "Party A", "Party B", "Party C", "Party D"');
    expect(p).toContain('("Party A", "Party B", "Party D")');
    expect(p).toContain('Known: "Dana" is Party A; "Derya" is Party D.');
    expect(p).toContain('"Person E", "Person F", and so on, never "Person C" or "Person D"');
    expect(p).toContain('The labels are always exactly "Party A", "Party B", "Party C", "Party D", "Person E"');
    expect(p).not.toContain("Use \"Person C\" and up");
  });

  it("Turkish text adds the several-sides note to the rules", () => {
    const p = submissionSystem({ narrator: "Party C", ...base, sides: { count: 3, names: [] }, text: "Bence cimrilik ediyor.", lang: "tr" });
    expect(p).toContain("With several sides, a dropped subject");
    expect(p).toContain("Party C'ye göre");
  });
});

describe("anonymizeSubmission with three sides", () => {
  function reply(data: unknown) {
    return { ok: true, data };
  }

  it("labels the narrator as Party C and a named other side as its side", async () => {
    claudeJson.mockResolvedValue(
      reply({
        text: "Party C paid half. Party A said it was too much.",
        evidence: [],
        replacements: [
          { original: "I", replacement: "Party C" },
          { original: "Dana", replacement: "Party A" },
        ],
      }),
    );
    const sub = await anonymizeSubmission({
      narrator: "Party C",
      text: "I paid half. Dana said it was too much.",
      evidence: [],
      lang: "en",
      twoSided: true,
      opponentRequired: true,
      sides: { count: 3, names: ["Dana", "Bo", null] },
    });
    expect(sub.text).toBe("Party C paid half. Party A said it was too much.");
    expect(sub.nameMap[0]).toEqual({ original: "I", replacement: "Party C" });
    expect(sub.nameMap).toContainEqual({ original: "Dana", replacement: "Party A" });
    const sent = claudeJson.mock.calls[0][0] as { system: string };
    expect(sent.system).toContain('Known: "Dana" is Party A; "Bo" is Party B.');
  });

  it("gives a bystander Person E, never Person C, and a known name its side's label", async () => {
    const known = [{ label: "Party B", key: "bo" }];
    claudeJson.mockResolvedValue(
      reply({
        text: "Party C asked Person E about Person F.",
        evidence: [],
        replacements: [
          { original: "I", replacement: "Party C" },
          { original: "Zoe", replacement: "Person E" },
          { original: "Bo", replacement: "Person F" },
        ],
      }),
    );
    const sub = await anonymizeSubmission({
      narrator: "Party C",
      text: "I asked Zoe about Bo.",
      evidence: [],
      lang: "en",
      twoSided: true,
      sides: { count: 3, names: [null, "Bo", null] },
      names: { keysFor: (n) => [n.toLowerCase()], known },
    });
    expect(sub.text).toBe("Party C asked Person E about Party B.");
    expect(sub.nameMap).toContainEqual({ original: "Bo", replacement: "Party B" });
    expect(sub.nameMap).toContainEqual({ original: "Zoe", replacement: "Person E" });
  });
});

describe("label detection", () => {
  it("a letter that runs on into a word is not a side's label", () => {
    expect(heldCandidates("Cem went to Berlin and Berlin was cold", "Party Cx met Party A in Berlin", ["Berlin"], 3)).toEqual(["Berlin"]);
  });
});
