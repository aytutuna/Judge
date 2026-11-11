import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyText,
  checkSegments,
  extractText,
  flattenText,
  mapPartyLabels,
  planSegments,
  reassemble,
  translateResult,
  translateSystemPrompt,
  translateUserMessage,
  unflattenText,
} from "../lib/translate";
import { VerdictResult } from "../lib/types";
import { refusedPremiumResult } from "../lib/premium/run";
import { TR_RESULT } from "./translate-fixtures";

/** A Turkish verdict on three accounts: Taraf C wins. */
const TR_MANY: VerdictResult = {
  verdict: "too_close",
  dispute_type: "values",
  confidence: 4,
  headline: "Taraf C haklı",
  why: "Taraf C sözünü tuttu. Taraf A geç kaldı.",
  crux: "Kim sözünü tuttu",
  split_points: null,
  conditional: null,
  argument_map: {
    side_a: [{ claim: "Taraf A fazla ödedi.", kind: "fact" }],
    side_b: [{ claim: "Taraf B ödemedi.", kind: "fact" }],
    bedrock_a: "Adalet.",
    bedrock_b: "Kolaylık.",
  },
  facts_relied_on: ["Fatura nisanda geldi."],
  losing_side_best_point: "",
  runs: ["split", "split", "side_a"],
  demo: false,
  lang: "tr",
  parties: ["a", "b", "c"],
  winner: "c",
  votes: ["c", "c", "a"],
  sides: [
    { party: "a", claims: [{ claim: "Taraf A fazla ödedi.", kind: "fact" }], bedrock: "Adalet." },
    { party: "b", claims: [{ claim: "Taraf B ödemedi.", kind: "fact" }], bedrock: "Kolaylık." },
    {
      party: "c",
      claims: [
        { claim: "Taraf C'nin payı yarım.", kind: "fact" },
        { claim: "Söz sözdür.", kind: "value" },
      ],
      bedrock: "Verilen söz.",
    },
  ],
  others: [
    { party: "a", line: "Taraf A geç kaldı." },
    { party: "b", line: "Taraf B hiç ödemedi." },
  ],
  disputes: [
    {
      fact: "Fatura kime geldi",
      positions: [
        { party: "a", says: "Bana geldi." },
        { party: "c", says: "Taraf C'ye geldi." },
      ],
      finding: "unsettled",
      decisive: false,
    },
  ],
};

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("text of a verdict with more than two sides", () => {
  it("extracts the sides, the lines for the others and the disputed facts", () => {
    const text = extractText(TR_MANY);
    expect(text.sides).toEqual([
      { claims: ["Taraf A fazla ödedi."], bedrock: "Adalet." },
      { claims: ["Taraf B ödemedi."], bedrock: "Kolaylık." },
      { claims: ["Taraf C'nin payı yarım.", "Söz sözdür."], bedrock: "Verilen söz." },
    ]);
    expect(text.others).toEqual(["Taraf A geç kaldı.", "Taraf B hiç ödemedi."]);
    expect(text.disputes).toEqual([{ fact: "Fatura kime geldi", positions: ["Bana geldi.", "Taraf C'ye geldi."] }]);
  });

  it("a two-sided verdict has none of these groups, so its slots are as they were", () => {
    const text = extractText(TR_RESULT);
    expect(text.sides).toBeUndefined();
    expect(text.others).toBeUndefined();
    expect(text.disputes).toBeUndefined();
    expect(flattenText(text)).toHaveLength(flattenText({ ...text, sides: undefined }).length);
  });

  it("flattens and rebuilds every string in order", () => {
    const text = extractText(TR_MANY);
    const flat = flattenText(text).map((s) => s.text);
    expect(flat.slice(-12)).toEqual([
      "Taraf A fazla ödedi.",
      "Adalet.",
      "Taraf B ödemedi.",
      "Kolaylık.",
      "Taraf C'nin payı yarım.",
      "Söz sözdür.",
      "Verilen söz.",
      "Taraf A geç kaldı.",
      "Taraf B hiç ödemedi.",
      "Fatura kime geldi",
      "Bana geldi.",
      "Taraf C'ye geldi.",
    ]);
    expect(unflattenText(text, flat)).toEqual(text);
  });

  it("applies the translation to the new fields and keeps everything that is not text", () => {
    const text = extractText(TR_MANY);
    const marked = unflattenText(text, flattenText(text).map((s) => `en: ${s.text}`));
    const out = applyText(TR_MANY, marked, "en");
    expect(out.sides?.[2].claims.map((c) => c.claim)).toEqual(["en: Party C's payı yarım.", "en: Söz sözdür."]);
    expect(out.sides?.[2].claims.map((c) => c.kind)).toEqual(["fact", "value"]);
    expect(out.sides?.[1].bedrock).toBe("en: Kolaylık.");
    expect(out.others?.map((o) => o.line)).toEqual(["en: Party A geç kaldı.", "en: Party B hiç ödemedi."]);
    expect(out.others?.map((o) => o.party)).toEqual(["a", "b"]);
    expect(out.disputes?.[0].positions).toEqual([
      { party: "a", says: "en: Bana geldi." },
      { party: "c", says: "en: Party C geldi." },
    ]);
    expect(out.disputes?.[0].finding).toBe("unsettled");
    expect(out.winner).toBe("c");
    expect(out.votes).toEqual(["c", "c", "a"]);
    expect(out.parties).toEqual(["a", "b", "c"]);
    expect(out.lang).toBe("en");
    expect(VerdictResult.safeParse(out).success).toBe(true);
  });
});

describe("party labels for C and D", () => {
  it("into Turkish: the label, its genitive and a suffix in harmony with the letter", () => {
    expect(mapPartyLabels("Party C's claim and Party D's claim", "tr", 4)).toBe("Taraf C'nin claim and Taraf D'nin claim");
    expect(mapPartyLabels("Party C won", "tr", 3)).toBe("Taraf C won");
    expect(mapPartyLabels("Taraf C'ya göre", "tr", 3)).toBe("Taraf C'ye göre");
    expect(mapPartyLabels("Taraf D'ye göre", "tr", 4)).toBe("Taraf D'ye göre");
    expect(mapPartyLabels("Taraf D'ymiş", "tr", 4)).toBe("Taraf D'ymiş");
  });

  it("into English: Turkish genitives and case suffixes come off", () => {
    expect(mapPartyLabels("Taraf C'nin payı", "en", 3)).toBe("Party C's payı");
    expect(mapPartyLabels("Taraf D'ye", "en", 4)).toBe("Party D");
    expect(mapPartyLabels("Taraf C kazandı", "en", 3)).toBe("Party C kazandı");
  });

  it("the placeholders for other people keep their English form and their suffix rules", () => {
    expect(mapPartyLabels("Kişi E'nin kardeşi", "en", 3)).toBe("Person E's kardeşi");
    expect(mapPartyLabels("Person E's brother", "tr", 3)).toBe("Person E'nin brother");
  });

  it("a two-sided text is mapped exactly as it was: C and D are not party labels there", () => {
    expect(mapPartyLabels("Party C's claim", "tr")).toBe("Party C's claim");
    expect(mapPartyLabels("Taraf C'nin payı", "en")).toBe("Taraf C'nin payı");
    expect(mapPartyLabels("Party A's and Party B's", "tr")).toBe("Taraf A'nın and Taraf B'nin");
  });
});

describe("the translation prompt for more sides", () => {
  it("two sides keep the prompts they had", () => {
    expect(translateSystemPrompt("tr", "en")).toBe(translateSystemPrompt("tr", "en", 2));
    expect(translateSystemPrompt("tr", "en")).toContain('"Party A" <-> "Taraf A", "Party B" <-> "Taraf B".');
    const seg = [{ i: 0, text: "x" }];
    expect(translateUserMessage("tr", "en", seg)).toBe(translateUserMessage("tr", "en", seg, undefined, 2));
  });

  it("maps every side's label, in Turkish and in another language", () => {
    expect(translateSystemPrompt("tr", "en", 4)).toContain('"Taraf A" <-> "Party A", "Taraf B" <-> "Party B", "Taraf C" <-> "Party C", "Taraf D" <-> "Party D".');
    expect(translateSystemPrompt("en", "de", 3)).toContain('"Party C" -> "Partei C"');
  });

  it("tells the model how Turkish suffixes go on the extra letters", () => {
    const msg = translateUserMessage("en", "tr", [{ i: 0, text: "x" }], undefined, 4);
    expect(msg).toContain('"Party C\'s" -> "Taraf C\'nin"');
    expect(msg).toContain('"Taraf C" and "Taraf D"');
    expect(msg).toContain("never merged or reordered");
  });
});

describe("translating a verdict with more than two sides", () => {
  it("sends every new text as a segment and rebuilds the result from the reply", async () => {
    const plan = planSegments(extractText(TR_MANY), "en");
    expect(plan.segments.length).toBe(flattenText(extractText(TR_MANY)).filter((s) => /\p{L}/u.test(s.text)).length);
    const call = vi.fn(async (c: { system: string; user: string }) => ({
      ok: true as const,
      data: {
        segments: plan.segments.map((s) => ({
          i: s.i,
          text: `The ruling says: ${s.text.replace(/Taraf ([A-D])'nin/g, "Party $1's").replace(/Taraf ([A-D])/g, "Party $1")} and so on for the readers`,
        })),
      },
      _c: c,
    }));
    const res = await translateResult(TR_MANY, "en", { call: call as never });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(call.mock.calls[0][0].system).toContain('"Taraf C" <-> "Party C"');
    expect(res.result.others?.[0].line).toContain("Party A geç kaldı");
    expect(res.result.winner).toBe("c");
    expect(VerdictResult.safeParse(res.result).success).toBe(true);
  });

  it("a refusal on several sides translates from the dictionary, sides included", async () => {
    const refused = { ...refusedPremiumResult("en", ["a", "b", "c"]), lang: "en" as const };
    const res = await translateResult(refused, "tr");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.sides).toHaveLength(3);
    expect(res.result.sides?.[2].claims[0].claim).not.toBe(refused.sides?.[2].claims[0].claim);
    expect(res.result.lang).toBe("tr");
  });

  it("an echoed reply is still caught when the only change is the label", () => {
    const segments = [{ i: 0, text: "Taraf C'nin payı yarım kaldı ve bu yüzden olanlar yeniden gözden geçirilmeli." }];
    const echoed = { segments: [{ i: 0, text: "Taraf C'nin payı yarım kaldı ve bu yüzden olanlar yeniden gözden geçirilmeli." }] };
    const check = checkSegments(segments, echoed, "tr", 3);
    expect(check.ok).toBe(false);
  });
});

describe("reassemble", () => {
  it("is unchanged for the slots of the new groups", () => {
    const plan = planSegments(extractText(TR_MANY), "en");
    const out = reassemble(plan, plan.segments.map((s) => s.text));
    expect(out).toEqual(plan.slots.map((s) => s.text));
  });
});
