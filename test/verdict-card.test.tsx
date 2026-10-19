import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { VerdictResult } from "../lib/types";
import { VerdictView } from "../components/VerdictView";
import { ArgumentMap } from "../components/ArgumentMap";
import { SampleVerdict, SAMPLE_TUG_A } from "../components/home/SampleVerdict";
import { VoteDots, voteOf } from "../components/verdict/VoteDots";
import { tugFinal } from "../lib/verdict-display";

/** Server-rendered markup of the verdict card: the accessibility contract
 * (live region, meter, tug label, votes in words) and the new props. */

const base: VerdictResult = {
  verdict: "side_b",
  dispute_type: "definitional",
  headline: "Nobody orders a sandwich hoping for a hot dog",
  crux: "Is a sandwich defined by its shape or by how people use the word?",
  split_points: null,
  conditional: null,
  argument_map: {
    side_a: [{ claim: "It is a filling inside sliced bread.", kind: "definition" }],
    side_b: [
      { claim: "No menu lists it under sandwiches.", kind: "fact" },
      { claim: "Words mean what people use them to mean.", kind: "logic" },
    ],
    bedrock_a: "Structure defines the category.",
    bedrock_b: "Usage defines the category.",
  },
  facts_relied_on: ["Menus list hot dogs separately."],
  losing_side_best_point: "A split roll with a filling fits most dictionary definitions.",
  confidence: 4,
  runs: ["side_b", "side_b", "side_a"],
  demo: false,
  lang: "en",
};

const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const count = (s: string, needle: string) => s.split(needle).length - 1;

describe("VerdictView", () => {
  it("keeps the translation live region mounted (empty) on a shared verdict", () => {
    const out = html(<VerdictView result={base} shareId="abc123" lang="en" />);
    expect(out).toMatch(/<p class="sr-only" aria-live="polite"><\/p>/);
  });

  it("renders no live region without a share id", () => {
    const out = html(<VerdictView result={base} lang="en" />);
    expect(out).not.toContain('aria-live="polite"><');
  });

  it("states the verdict, confidence and votes in text", () => {
    const out = html(<VerdictView result={base} lang="en" />);
    expect(out).toContain('role="img" aria-label="Verdict: Party B is right"');
    expect(out).toMatch(/role="meter"[^>]*aria-valuenow="4"/);
    expect(out).toContain("High confidence · 4/5");
    expect(out).toContain("3 independent AI judges voted: Party B · Party B · Party A");
    // one decorative dot per run
    expect(count(out, '<i aria-hidden="true" class="')).toBeGreaterThanOrEqual(3);
  });

  it("labels the card with the verdict heading", () => {
    const out = html(<VerdictView result={base} lang="en" />);
    const id = /<article[^>]*aria-labelledby="([^"]+)"/.exec(out)?.[1];
    expect(id).toBeTruthy();
    expect(out).toContain(`<h2 id="${id}"`);
  });

  it("shows the crux once: on the card, not again in the map", () => {
    const out = html(<VerdictView result={base} lang="en" />);
    expect(count(out, base.crux)).toBe(1);
    expect(out).toContain("The crux");
    expect(out).not.toContain("⚡");
  });

  it("shows the escalation note and every extra judge", () => {
    const out = html(
      <VerdictView
        result={{ ...base, escalated: true, runs: ["side_b", "side_a", "split", "side_b", "side_b"] }}
        lang="en"
      />,
    );
    expect(out).toContain("It was close, so we called in extra judges.");
    expect(out).toContain("5 independent AI judges voted: Party B · Party A · split · Party B · Party B");
  });

  it("adds Settle another one only with onJudgeAnother", () => {
    expect(html(<VerdictView result={base} lang="en" />)).not.toContain("Settle another one");
    const out = html(<VerdictView result={base} lang="en" onJudgeAnother={() => {}} />);
    expect(out).toMatch(/<button type="button"[^>]*>Settle another one<\/button>/);
  });

  it("offers copy link without emoji on a shared verdict", () => {
    const out = html(<VerdictView result={base} shareId="abc123" lang="en" />);
    expect(out).toContain(">Copy link<");
    expect(out).not.toContain("🔗");
  });

  it("hides crux, best point, map and facts when the model refused", () => {
    const out = html(<VerdictView result={{ ...base, model_refused: true, runs: [] }} lang="en" />);
    expect(out).not.toContain(base.crux);
    expect(out).not.toContain(base.losing_side_best_point);
    expect(out).not.toContain("down to bedrock");
    expect(out).toContain("The AI sat this one out.");
  });

  it("keeps the forced-ruling lean and its tally", () => {
    const out = html(
      <VerdictView
        result={{
          ...base,
          verdict: "too_close",
          runs: ["side_a", "side_b", "split"],
          lean: { party: "a", unanimous: false, reason: "Usage is shifting." },
        }}
        lang="en"
      />,
    );
    expect(out).toContain("Forced ruling: Party A is more right");
    expect(out).toContain("The judges leaned this way 2–1.");
  });

  it("renders Turkish chrome and the conditional clause rules", () => {
    const out = html(
      <VerdictView
        result={{
          ...base,
          verdict: "conditional",
          conditional: [{ if_value: "Eğer İstanbul'daysan", then: "Taraf A haklı." }],
          lang: "tr",
        }}
        lang="tr"
      />,
    );
    expect(out).toContain("Değerlerine bağlı");
    // marker stripped once, İ lowercased the Turkish way (never "i̇")
    expect(out).toContain("Eğer istanbul&#x27;daysan");
    expect(out).not.toContain("Eğer Eğer");
  });
});

describe("ArgumentMap", () => {
  const props = { map: base.argument_map, crux: base.crux, nameA: "Sam", nameB: "You" };

  it("shows the crux by default and hides it with showCrux={false}", () => {
    expect(html(<ArgumentMap {...props} />)).toContain(base.crux);
    expect(html(<ArgumentMap {...props} showCrux={false} />)).not.toContain(base.crux);
  });

  it("draws one shape glyph per claim next to the written kind", () => {
    const out = html(<ArgumentMap {...props} />);
    expect(count(out, "<svg")).toBeGreaterThanOrEqual(3);
    expect(out).toContain("definition");
    expect(out).toContain("fact");
    expect(out).toContain("logic");
    expect(out).not.toContain("--kind-");
    expect(out).toContain(">Bedrock<");
  });
});

describe("SampleVerdict", () => {
  it("server-renders the final state with the sample anchor", () => {
    const out = html(<SampleVerdict lang="en" />);
    expect(out).toContain('id="sample"');
    expect(out).not.toContain("data-state");
    expect(out).toContain(`--a:${SAMPLE_TUG_A}%`);
    expect(out).toContain("You&#x27;re right");
    expect(out).toContain('<span class="sr-only">3 independent AI judges voted: You · You · You</span>');
    expect(out).toMatch(/<h3[^>]*>/);
  });

  it("keeps the sample tilt equal to a B win", () => {
    expect(SAMPLE_TUG_A).toBe(tugFinal({ ...base, verdict: "side_b" }));
  });

  it("binds the heading's last word in both languages", () => {
    expect(html(<SampleVerdict lang="en" />)).toContain("looks like");
    expect(html(<SampleVerdict lang="tr" />)).toContain("neye benzer");
  });
});

describe("VoteDots", () => {
  it("maps every judge verdict to a vote", () => {
    expect(voteOf("side_a")).toBe("a");
    expect(voteOf("side_b")).toBe("b");
    expect(voteOf("split")).toBe("other");
    expect(voteOf("conditional")).toBe("other");
    expect(voteOf("dissolved")).toBe("other");
  });

  it("is decorative without srText, and speaks srText instead of the label with it", () => {
    expect(html(<VoteDots votes={["a", "b"]} />)).toMatch(/^<p[^>]*aria-hidden="true"/);
    const out = html(<VoteDots votes={["a"]} label="1 judge:" srText="1 judge: Sam" />);
    expect(out).not.toMatch(/^<p[^>]*aria-hidden/);
    expect(out).toContain('aria-hidden="true">1 judge:</span>');
    expect(out).toContain('<span class="sr-only">1 judge: Sam</span>');
  });

  it("renders nothing for no votes and no label", () => {
    expect(html(<VoteDots votes={[]} />)).toBe("");
  });
});
