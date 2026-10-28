import { describe, expect, it, vi } from "vitest";
import type { NameMapping, VerdictResult } from "../lib/types";

// Two languages as translators would list them, one spaced and one written
// without spaces, and Korean taken out to stand for one not listed yet.
vi.mock("../lib/langs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/langs")>();
  const listed = Object.fromEntries(Object.entries(actual.PARTY_LABELS).filter(([l]) => l !== "ko"));
  return {
    ...actual,
    PARTY_LABELS: { ...listed, de: ["Partei A", "Partei B"], ja: ["当事者A", "当事者B"] },
  };
});

const { consistentSelfMap, localizeLabels, personalizeResult, restoreNames, textLang } = await import("../lib/names");
const { checkLocale } = await import("../lib/locales/check");
const { EN } = await import("../lib/i18n");
const { EMAIL_EN } = await import("../lib/email");

const named = new Map([
  ["A", { name: "Mia", self: false }],
  ["B", { name: "Jonas", self: false }],
  ["C", { name: "Ute", self: false }],
]);

describe("names in a language added later", () => {
  it("puts names in place of the language's own labels", () => {
    expect(restoreNames("Partei A hat recht, Partei B schuldet Person C nichts.", named, "de")).toBe(
      "Mia hat recht, Jonas schuldet Ute nichts.",
    );
    expect(restoreNames("当事者Aは正しい。当事者Bは謝るべきだ。", named, "ja")).toBe("Miaは正しい。Jonasは謝るべきだ。");
  });

  it("never turns a stray English label into English grammar", () => {
    const self = new Map([
      ["A", { name: "I", self: true }],
      ["B", { name: "Jonas", self: false }],
    ]);
    expect(restoreNames("Party A ist im Recht, Party B's Idee nicht.", self, "de")).toBe("Party A ist im Recht, Party B's Idee nicht.");
    expect(restoreNames("Partei A hat recht und Partei B nicht.", self, "de")).toBe("Partei A hat recht und Jonas nicht.");
  });

  it("leaves words that only start like a label", () => {
    expect(restoreNames("Parteiausschluss, Partei Abc, ParteiA", named, "de")).toBe("Parteiausschluss, Partei Abc, ParteiA");
  });

  const result = {
    verdict: "side_b",
    dispute_type: "factual",
    headline: "Partei B hat recht",
    crux: "Ob Partei A die Rechnung bezahlt hat.",
    split_points: null,
    conditional: null,
    argument_map: { side_a: [], side_b: [], bedrock_a: "", bedrock_b: "" },
    facts_relied_on: ["Person C war dabei."],
    losing_side_best_point: "",
    confidence: 3,
    runs: ["side_b"],
    demo: false,
    lang: "de",
  } as VerdictResult;

  it("names the viewer one way: the label, since the narrator cannot be restored", () => {
    const map: NameMapping[] = [
      { original: "I", replacement: "Party A" },
      { original: "Jonas", replacement: "Party B" },
    ];
    expect(consistentSelfMap(result, map, "en")).toEqual({ nameMap: map.slice(1), selfDropped: true });
  });

  it("restores a whole German verdict for its writer", () => {
    const map: NameMapping[] = [
      { original: "Mia", replacement: "Party A" },
      { original: "Jonas", replacement: "Party B" },
      { original: "Ute", replacement: "Person C" },
    ];
    const shown = personalizeResult(result, map, "de");
    expect([shown.headline, shown.crux, shown.facts_relied_on[0]]).toEqual([
      "Jonas hat recht",
      "Ob Mia die Rechnung bezahlt hat.",
      "Ute war dabei.",
    ]);
  });

  it("writes and tells the language's labels", () => {
    expect(localizeLabels("Party A und Taraf B sagen Person C", "de")).toBe("Partei A und Partei B sagen Person C");
    expect(localizeLabels("Partei A told Partei B", "en")).toBe("Party A told Party B");
    expect(localizeLabels("当事者Aと当事者B", "tr")).toBe("Taraf AとTaraf B");
    expect(textLang("Partei A sagt, Partei B habe nicht bezahlt.")).toBe("de");
    expect(textLang("当事者Bは払った")).toBe("ja");
    expect(textLang("Party A says Party B paid.")).toBe("en");
  });

  it("asks for the labels to be listed and to match", () => {
    const locale = (a: string, b: string) =>
      ({ voice: `Refer to the parties as "${a}" and "${b}".`, strings: { ...EN, "party.a": a, "party.b": b }, email: EMAIL_EN }) as never;
    expect(checkLocale("ja", locale("当事者A", "当事者B"))).toEqual([]);
    expect(checkLocale("ja", locale("当事者A", "相手B"))).toContain(
      'party.a, party.b: should be one word with the Latin letters A and B, like "Partei A" and "Partei B"',
    );
    expect(checkLocale("ja", locale("甲A", "甲B"))).toContain('party.a, party.b: should match PARTY_LABELS["ja"] in lib/langs.ts');
    expect(checkLocale("ko", locale("당사자 A", "당사자 B"))).toContain(
      'party.a, party.b: add "ko": ["당사자 A", "당사자 B"] to PARTY_LABELS in lib/langs.ts',
    );
    expect(checkLocale("ko", locale("Party A", "Party B"))).toEqual([]);
  });
});
