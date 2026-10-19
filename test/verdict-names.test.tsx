import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VerdictView } from "../components/VerdictView";
import { normalizeNameMap } from "../lib/anonymize";
import type { NameMapping, VerdictResult } from "../lib/types";

const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;");

const base: VerdictResult = {
  verdict: "side_a",
  dispute_type: "factual",
  headline: "Party A is right and Party A's plan works",
  crux: "Whether the tea was ready.",
  split_points: null,
  conditional: null,
  argument_map: {
    side_a: [{ claim: "Party A says brewing matters.", kind: "fact" }],
    side_b: [{ claim: "Party B says boiling is enough.", kind: "fact" }],
    bedrock_a: "Taste.",
    bedrock_b: "Speed.",
  },
  facts_relied_on: ["Tea brews in five minutes."],
  losing_side_best_point: "Party B was in a hurry.",
  confidence: 4,
  runs: ["side_a", "side_a", "side_a"],
  demo: false,
  lang: "en",
};

describe("VerdictView: Turkish argument judged with the English interface", () => {
  // The anonymizer lists the Turkish narrator as "Ben"; the verdict itself
  // is English (verdict lang "en"), so "Ben" must not read as a name.
  const map = normalizeNameMap(
    [
      { original: "Ben", replacement: "Party A" },
      { original: "Deniz", replacement: "Party B" },
    ],
    "Deniz çayın hazır olduğunu söylüyor. Ben ise demlenmeden çay olmaz diyorum.",
    "Party B çayın hazır olduğunu söylüyor. Party A ise demlenmeden çay olmaz diyor.",
  );

  it("shows the narrator as You in the English UI", () => {
    const out = html(<VerdictView result={base} nameMap={map} lang="en" />);
    expect(out).toContain(esc("You are right and your plan works"));
    expect(out).not.toMatch(/\bBen\b/);
  });

  it("shows the narrator as Sen in the Turkish UI", () => {
    const out = html(<VerdictView result={base} nameMap={map} lang="tr" />);
    expect(out).toContain("Sen");
    expect(out).not.toMatch(/\bBen\b/);
  });
});

describe("VerdictView: conditional clauses keep the capital of restored names", () => {
  const conditional: VerdictResult = {
    ...base,
    lang: "tr",
    verdict: "conditional",
    headline: "Kime güvendiğine bağlı",
    conditional: [
      { if_value: "Kişi C haklıysa", then: "Taraf B haklı" },
      { if_value: "Eğer Taraf B'nin dediği doğruysa", then: "Taraf B haklı" },
      { if_value: "Çay soğuksa", then: "Taraf A haklı" },
    ],
    runs: ["conditional", "conditional", "conditional"],
  };
  const map: NameMapping[] = [
    { original: "I", replacement: "Party A" },
    { original: "Deniz", replacement: "Party B" },
    { original: "Kemal", replacement: "Person C" },
  ];

  it("keeps another person's name capitalized and lowercases ordinary words", () => {
    const out = html(<VerdictView result={conditional} nameMap={map} lang="tr" />);
    expect(out).toContain("Eğer Kemal haklıysa");
    expect(out).not.toContain("kemal");
    expect(out).toContain(esc("Eğer Deniz'in dediği doğruysa"));
    expect(out).toContain("Eğer çay soğuksa");
  });
});
