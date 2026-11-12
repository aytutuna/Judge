import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { VerdictResult } from "../lib/types";
import { VerdictView } from "../components/VerdictView";
import { CaseShell } from "../components/case/CaseScreen";
import { BalanceFallback } from "../components/scene/BalanceFallback";
import { OG_SIDES, OgCard } from "../components/OgCard";
import { SampleVerdict, SAMPLE_TUG_A } from "../components/home/SampleVerdict";
import { VoteDots, voteOf } from "../components/verdict/VoteDots";
import { t } from "../lib/i18n";
import { PALETTE, sideColors } from "../lib/palette";
import { stripLeadingEmoji } from "../lib/text";
import { leanShare, tugFinal } from "../lib/verdict-display";

/** Server-rendered markup of the verdict card: the accessibility contract
 * (live region, lean bar, ruling line, votes in words) and the new props. */

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
    // The ruling line is decorative; the heading says the ruling to screen readers.
    expect(out).toMatch(/aria-hidden="true">Party B is right<\/span>/);
    expect(out).toMatch(/<h2[^>]*><span class="sr-only">Party B is right\. <\/span>Nobody orders/);
    // Confidence is the judges' agreement, not the stored 1-5 score; the dots come first.
    expect(out).toMatch(/<p[^>]*aria-hidden="true">(<i [^>]*><\/i>){3}<\/p>Confidence 2 of 3</);
    expect(out).not.toContain("of 5");
    expect(out).not.toContain("agree<");
    expect(out).toContain("3 independent AI judges voted: Party B · Party B · Party A");
  });

  it("draws the lean bar from the vote ratio, with its label", () => {
    const out = html(<VerdictView result={base} lang="en" />);
    expect(out).toMatch(/role="img" aria-label="The panel leaned to Party B"><div [^>]*style="width:33\.3+%"/);
    const level = html(<VerdictView result={{ ...base, verdict: "too_close", runs: ["side_a", "side_b", "split"] }} lang="en" />);
    expect(level).toContain('aria-label="The panel didn&#x27;t lean either way"');
    const refused = html(<VerdictView result={{ ...base, model_refused: true, runs: [] }} lang="en" />);
    expect(refused).not.toContain("The panel leaned");
    expect(refused).not.toContain("lean either way");
  });

  it("labels the card with the verdict heading", () => {
    const out = html(<VerdictView result={base} lang="en" />);
    const id = /<article[^>]*aria-labelledby="([^"]+)"/.exec(out)?.[1];
    expect(id).toBeTruthy();
    expect(out).toContain(`<h2 id="${id}"`);
  });

  it("sets the bedrock side by side and names the losing side's best point", () => {
    const out = html(<VerdictView result={base} lang="en" />);
    expect(out).toContain(">What each side stands on</h3>");
    expect(out).toMatch(/data-party="a"><span[^>]*>Party A<\/span><p>Structure defines the category\.<\/p>/);
    expect(out).toMatch(/data-party="b"><span[^>]*>Party B<\/span><p>Usage defines the category\.<\/p>/);
    expect(out).toContain("Party A&#x27;s best point");
    expect(out).toContain(">A · definition</span>");
    expect(out).toContain(">B · fact</span>");
    const split = html(<VerdictView result={{ ...base, verdict: "too_close", runs: ["side_a", "side_b", "split"] }} lang="tr" />);
    expect(split).toMatch(new RegExp(`aria-hidden="true">${t("tr", "verdict.tooClose")}</span>`));
    expect(split).toContain(`>${t("tr", "verdict.noMajority")}<`);
    expect(split).toContain(esc(stripLeadingEmoji(t("tr", "bestPointTitle"))));
  });

  it("opens the details from rows that control the panel", () => {
    const out = html(<VerdictView result={base} lang="en" />);
    const rows = [...out.matchAll(/<button type="button" class="[^"]*row[^"]*" aria-expanded="false" aria-controls="([^"]+)"/g)];
    expect(rows).toHaveLength(3);
    expect(out).toContain(`<div id="${rows[0][1]}" hidden=""`);
    expect(html(<VerdictView result={{ ...base, model_refused: true, runs: [] }} lang="en" />)).not.toContain("aria-expanded");
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

  it("says why an objection left doubt, and owns up to a mixed dispute", () => {
    const trial = { attack: "Menus vary by country.", outcome: "uncertain" as const, reasoning: "Only some menus list it." };
    const out = html(<VerdictView result={{ ...base, dispute_type: "mixed", crux_trial: trial }} lang="en" />);
    expect(out).toContain("Why:");
    expect(out).toContain("Only some menus list it.");
    expect(out).toContain(esc(t("en", "trial.mixedNote")));
    expect(out).toContain("Objection:");
    expect(out).toContain("Menus vary by country.");
    const bare = html(<VerdictView result={{ ...base, dispute_type: "mixed", crux_trial: { ...trial, reasoning: "" } }} lang="en" />);
    expect(count(bare, "Menus vary by country.")).toBe(1);
    expect(bare).not.toContain("Strongest objection:");
    const factual = html(<VerdictView result={{ ...base, dispute_type: "factual", crux_trial: trial }} lang="en" />);
    expect(factual).not.toContain(esc(t("en", "trial.mixedNote")));
    const held = html(<VerdictView result={{ ...base, dispute_type: "mixed", crux_trial: { ...trial, outcome: "survived" } }} lang="en" />);
    expect(held).not.toContain(esc(t("en", "trial.mixedNote")));
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

  it("offers Add context & appeal in place of Copy link only with onAddContext", () => {
    const plain = html(<VerdictView result={base} shareId="abc123" lang="en" />);
    expect(plain).toContain(">Share<");
    expect(plain).toContain(">Copy link<");
    expect(plain).not.toContain("appeal");
    const writer = html(<VerdictView result={base} shareId="abc123" lang="en" onAddContext={() => {}} />);
    expect(writer).toContain(">Add context &amp; appeal</button>");
    expect(writer).not.toContain(">Copy link<");
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

describe("SampleVerdict", () => {
  it("server-renders the final state with the sample anchor", () => {
    const out = html(<SampleVerdict lang="en" />);
    expect(out).toContain('id="sample"');
    expect(out).not.toContain("data-state");
    expect(out).toContain("You&#x27;re right");
    expect(out).toContain(">Example<");
    expect(out).toMatch(/<p[^>]*aria-hidden="true">(<i [^>]*><\/i>){3}<\/p>Confidence 3 of 3</);
    expect(out).toContain('aria-label="The panel leaned to You"');
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

describe("leanShare", () => {
  const run = (verdict: VerdictResult["verdict"], runs: VerdictResult["runs"], more: Partial<VerdictResult> = {}) =>
    leanShare({ ...base, verdict, runs, ...more });

  it("is Party A's share of the votes for either side", () => {
    expect(run("side_a", ["side_a", "side_a", "side_b", "side_a", "dissolved"])).toBe(0.75);
    expect(run("side_b", ["side_b", "side_b", "side_b"])).toBe(0);
    expect(run("side_a", ["side_a", "side_a", "side_a"])).toBe(1);
  });

  it("sits in the middle for too close, split or no counted side votes", () => {
    expect(run("too_close", ["side_a", "side_b", "side_a"])).toBe(0.5);
    expect(run("split", ["side_a", "side_a", "split"])).toBe(0.5);
    expect(run("dissolved", ["dissolved", "conditional", "dissolved"])).toBe(0.5);
  });

  it("is null for a refusal or no runs", () => {
    expect(run("side_a", [])).toBeNull();
    expect(run("side_a", ["side_a"], { model_refused: true })).toBeNull();
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

  it("is decorative", () => {
    expect(html(<VoteDots votes={["a", "b"]} />)).toMatch(/^<p[^>]*aria-hidden="true"/);
  });

  it("renders nothing for no votes and no label", () => {
    expect(html(<VoteDots votes={[]} />)).toBe("");
  });
});

describe("side colours", () => {
  const sides = (out: string) => [...out.matchAll(/<div [^>]*data-you="([ab])"/g)].map((m) => m[1]);

  it("the writer's own verdict draws Party A as theirs", () => {
    expect(sides(html(<VerdictView result={base} lang="en" />))).toEqual(["a"]);
  });

  it("the other side of a case gets Party B in green", () => {
    expect(sides(html(<VerdictView result={base} lang="en" selfParty="B" viewerIsSelfParty />))).toEqual(["b"]);
    const shell = html(
      <CaseShell lang="en" kicker="Case" title="Who pays" you="b" bare>
        <p>side</p>
      </CaseShell>,
    );
    expect(shell).toMatch(/<main [^>]*data-you="b"/);
  });

  it("a stranger on a share link sees Party A in green", () => {
    const out = html(
      <VerdictView result={base} lang="en" shareId="abc123" nameMap={[{ original: "Sam", replacement: "Party A" }]} publicNames />,
    );
    expect(sides(out)).toEqual(["a"]);
  });

  it("the home sample is the reader's own case: its \"You\" side is green", () => {
    expect(t("en", "sample.nameB")).toBe("You");
    expect(sides(html(<SampleVerdict lang="en" />))).toEqual(["b"]);
  });

  it("the ruling line takes the winner's side colour, ink when nobody wins", () => {
    expect(html(<VerdictView result={base} lang="en" />)).toMatch(/data-win="b" aria-hidden="true">Party B is right</);
    const close = html(<VerdictView result={{ ...base, verdict: "too_close" }} lang="en" />);
    expect(close).not.toMatch(/data-win="[ab]"/);
    const css = readFileSync(join(__dirname, "..", "components", "verdict", "verdict.module.css"), "utf8");
    expect(css).toContain('.ruleLabel[data-win="a"] { color: var(--party-a-ink); }');
    expect(css).toContain('.ruleLabel[data-win="b"] { color: var(--party-b-ink); }');
  });

  it("party marks on the card use the side tokens, never a fixed colour", () => {
    const css = readFileSync(join(__dirname, "..", "components", "verdict", "verdict.module.css"), "utf8");
    for (const sel of [".dotA", ".dotB", ".leanFill", ".avatar", ".branchA", ".branchB", ".claimTag", ".claimTagB"]) {
      const rule = css.slice(css.indexOf(`${sel} {`), css.indexOf("}", css.indexOf(`${sel} {`)));
      expect(rule, sel).toMatch(/var\(--party-[ab]/);
      expect(rule, sel).not.toMatch(/--terra|--sage|rgba/);
    }
  });
});

describe("BalanceFallback sides", () => {
  const fills = (out: string) => [...out.matchAll(/<circle [^>]*r="36" fill="([^"]+)"/g)].map((m) => m[1]);
  const you = (out: string) => out.match(/<svg [^>]*data-you="([ab])"/)?.[1];

  it("draws Party A green unless the viewer is Party B", () => {
    expect(fills(html(<BalanceFallback tugA={30} />))).toEqual(["var(--party-a)", "var(--party-b)"]);
    expect(you(html(<BalanceFallback tugA={30} />))).toBe("a");
    expect(you(html(<BalanceFallback tugA={30} you="a" />))).toBe("a");
    expect(you(html(<BalanceFallback tugA={30} you="b" />))).toBe("b");
    expect(fills(html(<BalanceFallback empty />))).toEqual([]);
  });
});

describe("share image sides", () => {
  it("a link preview has no viewer: Party A's share is green, Party B's red", () => {
    expect(OG_SIDES).toEqual(sideColors(null));
    const out = html(<OgCard title="Sam is right" footer="Judge" tugA={70} />);
    expect(out).toContain(`width:70%;height:100%;background:${PALETTE.sageStrong}`);
    expect(out).toContain(`background:${PALETTE.terra}`);
  });
});
