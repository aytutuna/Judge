import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { VerdictResult } from "../lib/types";
import { VerdictView } from "../components/VerdictView";
import { ArgumentMap } from "../components/ArgumentMap";
import { SampleVerdict, SAMPLE_TUG_A } from "../components/home/SampleVerdict";
import { VoteDots, voteOf } from "../components/verdict/VoteDots";
import { t } from "../lib/i18n";
import { stripLeadingEmoji } from "../lib/text";
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
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;");

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
    // The stamp is decorative; the heading says the ruling to screen readers.
    expect(out).toMatch(/aria-hidden="true"><span[^>]*>Party B is right<\/span>/);
    expect(out).toMatch(/<h2[^>]*><span class="sr-only">Party B is right\. <\/span>Nobody orders/);
    // Confidence is the judges' agreement, not the stored 1-5 score; the dots come first.
    expect(out).toMatch(/<p[^>]*aria-hidden="true">(<i [^>]*><\/i>){3}<\/p><span>Confidence 2 of 3<\/span>/);
    expect(out).not.toContain("of 5");
    expect(out).not.toContain("agree<");
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

  it("stamps a short ruling, sets the bedrock side by side and names the losing side's best point", () => {
    const out = html(<VerdictView result={base} lang="en" />);
    expect(out).toContain(">Bedrock</h3>");
    expect(out).toMatch(/data-party="a">Party A<\/span><p>Structure defines the category\.<\/p>/);
    expect(out).toMatch(/data-party="b">Party B<\/span><p>Usage defines the category\.<\/p>/);
    expect(out).toContain("Party A&#x27;s best point");
    const split = html(<VerdictView result={{ ...base, verdict: "too_close", runs: ["side_a", "side_b", "split"] }} lang="tr" />);
    expect(split).toMatch(new RegExp(`aria-hidden="true"><span[^>]*>${t("tr", "stamp.tooClose")}</span>`));
    expect(split).toContain(`>${t("tr", "verdict.noMajority")}<`);
    expect(split).toContain(esc(stripLeadingEmoji(t("tr", "bestPointTitle"))));
  });

  it("shows the crux once: on the card, not again in the map", () => {
    const out = html(<VerdictView result={base} lang="en" />);
    expect(count(out, base.crux)).toBe(1);
    expect(out).toContain("The crux");
    expect(out).not.toContain("⚡");
  });

  it("shows why under the headline, above the crux", () => {
    const why = "Words go by how people use them. Ask for a sandwich and you won't get a hot dog.";
    const out = html(<VerdictView result={{ ...base, why }} lang="en" />);
    expect(out).toMatch(/<h3 class="[^"]*sectionLabel[^"]*">Why<\/h3>/);
    expect(count(out, esc(why))).toBe(1);
    expect(out.indexOf(base.headline)).toBeLessThan(out.indexOf(esc(why)));
    expect(out.indexOf(esc(why))).toBeLessThan(out.indexOf("The crux"));
    expect(html(<VerdictView result={{ ...base, why, lang: "tr" }} lang="tr" />)).toContain(">Neden</h3>");
  });

  it("keeps why right under the headline when notes or branches follow", () => {
    const why = "Neither reading covers the whole menu.";
    const trial = html(
      <VerdictView
        result={{ ...base, why, crux_trial: { attack: "Menus vary by country.", outcome: "survived", reasoning: "" } }}
        lang="en"
      />,
    );
    expect(trial.indexOf(esc(why))).toBeLessThan(trial.indexOf("Menus vary by country."));
    const split = html(
      <VerdictView
        result={{
          ...base,
          why,
          verdict: "split",
          split_points: [{ party: "a", point: "The bread is a sandwich roll." }],
        }}
        lang="en"
      />,
    );
    expect(split.indexOf(base.headline)).toBeLessThan(split.indexOf(esc(why)));
    expect(split.indexOf(esc(why))).toBeLessThan(split.indexOf("The bread is a sandwich roll."));
  });

  it("leaves out why on older verdicts that have none", () => {
    const out = html(<VerdictView result={base} lang="en" />);
    expect(out).not.toContain(">Why</h3>");
    expect(html(<VerdictView result={{ ...base, why: "" }} lang="en" />)).not.toContain(">Why</h3>");
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
    expect(out).toContain(">Confidence 3 of 5<");
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
    const out = html(<VerdictView result={{ ...base, why: "It was paid.", model_refused: true, runs: [] }} lang="en" />);
    expect(out).not.toContain("It was paid.");
    expect(out).not.toContain(">Why</h3>");
    expect(out).not.toContain(base.crux);
    expect(out).not.toContain(base.losing_side_best_point);
    expect(out).not.toContain("down to bedrock");
    expect(out).toContain("The AI sat this one out.");
    expect(out).not.toContain("Confidence");
    expect(out).not.toContain(t("en", "verdict.noMajority"));
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
    expect(out).toMatch(/role="meter"[^>]*aria-valuenow="3"[^>]*aria-label="Confidence 3 of 3"/);
    expect(out).toContain(">Confidence 3 of 3</p>");
  });

  it("shows why between the headline and the crux in both languages", () => {
    for (const lang of ["en", "tr"] as const) {
      const out = html(<SampleVerdict lang={lang} />);
      const why = out.indexOf(esc(t(lang, "sample.why")));
      expect(why).toBeGreaterThan(out.indexOf(esc(t(lang, "sample.headline"))));
      expect(why).toBeLessThan(out.indexOf(esc(t(lang, "sample.crux"))));
      expect(out).toContain(`>${t(lang, "why")}</h3>`);
    }
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
