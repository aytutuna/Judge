import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PricingTable, featureKeys } from "../components/account/PricingView";
import { Faq, FAQ_ITEMS, faqItems } from "../components/home/Faq";
import { caseAboutKeys, premiumAboutKeys } from "../components/InfoPage";
import { VerdictView } from "../components/VerdictView";
import { STRINGS, t } from "../lib/i18n";
import { PRICING } from "../lib/pricing";
import type { VerdictResult } from "../lib/types";
import { APPEAL_RESULT, OWNER_NAMES, RESPONDENT_NAMES, TWO_SIDED_RESULT } from "./ui-case-fixtures";

const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;");

const PLAIN: VerdictResult = {
  verdict: "side_a",
  dispute_type: "factual",
  headline: "Party A is right",
  crux: "Whether the tea was ready.",
  split_points: null,
  conditional: null,
  argument_map: {
    side_a: [{ claim: "Brewing matters.", kind: "fact" }],
    side_b: [{ claim: "Boiling is enough.", kind: "fact" }],
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

const NEW_MARKERS = [
  t("en", "twoSided.badge"),
  t("en", "twoSided.agreed"),
  t("en", "twoSided.disputed"),
  t("en", "twoSided.wouldChange"),
  "Evidence:",
  t("en", "appeal.outcome.changed"),
];

describe("VerdictView: results without the new fields render as before", () => {
  it("free and premium verdicts show none of the two-sided, evidence or appeal markup", () => {
    for (const r of [PLAIN, { ...PLAIN, tier: "premium" as const }]) {
      const out = html(<VerdictView result={r} lang="en" />);
      for (const m of NEW_MARKERS) expect(out).not.toContain(esc(m));
    }
  });
});

describe("VerdictView: a two-sided verdict", () => {
  it("anonymized (share page): labels, agreed and disputed facts, what would change it, evidence", () => {
    const out = html(<VerdictView result={TWO_SIDED_RESULT} lang="en" />);
    expect(out).toContain(t("en", "twoSided.badge"));
    expect(out).toContain(t("en", "twoSided.agreed"));
    expect(out).toContain("Person C reminded them on April 1.");
    expect(out).toContain(t("en", "twoSided.disputed"));
    expect(out).toContain("Leans toward Party B");
    // Share pages never mark anyone as "you".
    expect(out).not.toContain("(you)");
    expect(out).toContain(t("en", "twoSided.finding.unsettled"));
    // Exactly one decisive marker.
    expect(out.split(t("en", "twoSided.decisive")).length - 1).toBe(1);
    expect(out).toContain(t("en", "twoSided.wouldChange"));
    expect(out).toContain("A bank record showing Party A paid in April");
    expect(out).toContain("Evidence: 1 from Party A, 2 from Party B");
    expect(out).not.toContain("Deniz");
  });

  it("the owner's view restores their names", () => {
    const out = html(<VerdictView result={TWO_SIDED_RESULT} nameMap={OWNER_NAMES} lang="en" />);
    expect(out).toContain("Deniz is right");
    expect(out).toContain("Leans toward Deniz");
    expect(out).toContain("Sarah reminded them on April 1.");
  });

  it("the respondent's view makes Party B You", () => {
    const out = html(<VerdictView result={TWO_SIDED_RESULT} nameMap={RESPONDENT_NAMES} lang="en" selfParty="B" />);
    expect(out).toContain(esc("You're right"));
    expect(out).toContain("Leans your way");
    expect(out).toContain("A bank record showing Aytu paid in April");
  });

  it("the respondent's view in Turkish", () => {
    const tr = { ...TWO_SIDED_RESULT, lang: "tr" as const };
    const out = html(<VerdictView result={tr} nameMap={RESPONDENT_NAMES} lang="tr" selfParty="B" />);
    expect(out).toContain("Sen haklısın");
    expect(out).toContain("Senden yana");
  });

  it("caps the lists and shows a single decisive dispute even if the row says otherwise", () => {
    const many: VerdictResult = {
      ...TWO_SIDED_RESULT,
      agreed_facts: Array.from({ length: 9 }, (_, i) => `Agreed ${i}`),
      disputed_facts: Array.from({ length: 6 }, (_, i) => ({
        fact: `Dispute ${i}`,
        party_a: "a",
        party_b: "b",
        finding: "a" as const,
        decisive: true,
      })),
      would_change: ["w1", "w2", "w3", "w4"],
    };
    const out = html(<VerdictView result={many} lang="en" />);
    expect(out).toContain("Agreed 4");
    expect(out).not.toContain("Agreed 5");
    expect(out).toContain("Dispute 3");
    expect(out).not.toContain("Dispute 4");
    expect(out.split(t("en", "twoSided.decisive")).length - 1).toBe(1);
    expect(out).not.toContain("w4");
  });

  it("a one-sided premium verdict with evidence shows a plain image count", () => {
    const out = html(<VerdictView result={{ ...PLAIN, tier: "premium", evidence_used: { a: 2, b: 0 } }} lang="en" />);
    expect(out).toContain("Images the judges read: 2");
  });
});

describe("VerdictView: an appeal verdict", () => {
  it("shows the outcome and who added context, and leaves confidence to the card", () => {
    const out = html(<VerdictView result={APPEAL_RESULT} lang="en" />);
    expect(out).toContain(t("en", "appeal.outcome.changed"));
    expect(out).toContain("After new context from Party A");
    expect(out).not.toContain("/5");
    expect(out).toContain(esc("Party A's screenshot of the March swap made the turn order unclear."));
  });

  it("falls back to a generic line without a summary", () => {
    const r = { ...APPEAL_RESULT, appeal: { ...APPEAL_RESULT.appeal!, outcome: "upheld" as const, summary: " " } };
    const out = html(<VerdictView result={r} lang="tr" />);
    expect(out).toContain(t("tr", "appeal.outcome.upheld"));
    expect(out).toContain(t("tr", "appeal.generic.upheld"));
  });

  it("names what happened to the verdict, not the appeal", () => {
    expect(t("en", "appeal.outcome.upheld")).toBe("Verdict stands");
    expect(t("tr", "appeal.outcome.upheld")).toBe("Karar aynı kaldı");
  });
});

describe("VerdictView: finding chips read naturally", () => {
  it("in Turkish with labels and with names", () => {
    const tr = { ...TWO_SIDED_RESULT, lang: "tr" as const };
    expect(html(<VerdictView result={tr} lang="tr" />)).toContain("Taraf B lehine");
    expect(html(<VerdictView result={tr} lang="tr" />)).not.toContain("tarafına yakın");
  });
});

describe("copy only claims what the deployment offers", () => {
  it("pricing lists the extras only when switched on", () => {
    const base = ["pricing.premium.f1", "pricing.premium.f2", "pricing.premium.f3", "pricing.premium.f4"];
    expect(featureKeys(null)).toEqual(base);
    expect(featureKeys({ cases: true, evidence: false })).toEqual([...base, "pricing.premium.f7", "pricing.premium.f6"]);
    expect(featureKeys({ cases: false, evidence: true })).toEqual([...base, "pricing.premium.f5"]);
    const on = html(
      <PricingTable
        lang="en"
        pricing={PRICING}
        premiumEnabled
        signedIn={false}
        signInOffered
        features={{ cases: true, evidence: true }}
      />,
    );
    expect(on).toContain(esc(t("en", "pricing.premium.f7")));
    expect(on).toContain(esc(t("en", "pricing.premium.f6")));
    // Verdicts off: the extras go with them.
    const off = html(
      <PricingTable lang="en" pricing={PRICING} premiumEnabled={false} signedIn={false} signInOffered features={{ cases: true, evidence: false }} />,
    );
    expect(off).not.toContain(esc(t("en", "pricing.premium.f7")));
    expect(off).not.toContain(esc(t("en", "pricing.premium.f6")));
  });

  it("the FAQ adds the premium questions only when switched on", () => {
    expect(faqItems(null)).toEqual(FAQ_ITEMS);
    const all = faqItems({ cases: true, evidence: true }).map((i) => i.q);
    expect(all).toContain("faq.both.q");
    expect(all).toContain("faq.evidence.q");
    expect(all.length).toBe(FAQ_ITEMS.length + 2);
    const out = html(<Faq lang="tr" features={{ cases: true, evidence: false }} />);
    expect(out).toContain(esc(t("tr", "faq.both.q")));
    expect(out).not.toContain(esc(t("tr", "faq.evidence.q")));
    // The Premium part of the cases answer only where Premium is sold.
    expect(out).not.toContain(esc(t("tr", "faq.both.premium")));
    const sold = html(<Faq lang="tr" features={{ cases: true, evidence: false }} premium />);
    expect(sold).toContain(esc(t("tr", "faq.both.premium")));
  });

  it("About lists both sides on its own and the premium extras only when switched on", () => {
    expect(caseAboutKeys(null)).toEqual([]);
    expect(caseAboutKeys({ cases: true, evidence: false })).toEqual(["about.cases1", "about.cases2"]);
    expect(premiumAboutKeys(null)).toEqual([]);
    expect(premiumAboutKeys({ cases: false, evidence: true })).toEqual(["about.premium2"]);
    expect(premiumAboutKeys({ cases: true, evidence: true })).toEqual(["about.premium2", "about.premium3", "about.premium4"]);
    // The Premium bullets talk about evidence, appeals and premium cases, never the free feature itself.
    for (const lang of ["en", "tr"] as const) {
      expect(t(lang, "about.premiumTitle")).not.toMatch(/both sides|iki taraf/i);
      expect(t(lang, "faq.both.a")).not.toMatch(/^(With Premium|Premium ile)/);
    }
  });

  it("privacy tells the truth about images, names, originals and removal in both languages", () => {
    expect(STRINGS.en["privacy.evidence"]).toMatch(/never store the image/);
    expect(STRINGS.en["privacy.evidence"]).toMatch(/6 hours/);
    expect(STRINGS.en["privacy.evidence"]).toMatch(/raw transcript is kept encrypted/);
    expect(STRINGS.en["privacy.cases"]).toMatch(/fingerprints/);
    expect(STRINGS.en["privacy.cases"]).toMatch(/stored only as a hash/);
    expect(STRINGS.en["privacy.cases"]).toMatch(/stored encrypted/);
    expect(STRINGS.en["privacy.cases"]).toMatch(/remove their own side/);
    expect(STRINGS.tr["privacy.evidence"]).toMatch(/görseli hiç saklamayız/);
    expect(STRINGS.tr["privacy.cases"]).toMatch(/parmak izlerini/);
    expect(STRINGS.tr["privacy.cases"]).toMatch(/şifreli/);
    expect(STRINGS.en["account.deleteConfirm"]).toMatch(/share links stop working/);
  });
});
