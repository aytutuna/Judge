import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FactCheckList, safeSource } from "../components/FactCheckList";
import { JudgingOverlay } from "../components/JudgingOverlay";
import { VerdictView } from "../components/VerdictView";
import { t } from "../lib/i18n";
import type { FactCheck, VerdictResult } from "../lib/types";
import { panelSummary } from "../lib/verdict-display";

const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const count = (s: string, needle: string) => s.split(needle).length - 1;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;");

const checked: FactCheck = {
  status: "checked",
  claims: [
    {
      claim: "The Great Wall is visible from the Moon with the naked eye.",
      status: "refuted",
      summary: "Astronauts report it cannot be seen unaided from the Moon.",
      sources: [
        { title: "Great Wall of China | Britannica", url: "https://www.britannica.com/topic/Great-Wall-of-China" },
        { title: "NASA: China's Wall Less Great in View from Space", url: "https://www.nasa.gov/vision/space/workinginspace/great_wall.html" },
        { title: "Evil", url: "javascript:alert(1)" },
        { title: "Data", url: "data:text/html,hi" },
        { title: "Relative", url: "/local" },
        { title: "Duplicate", url: "https://www.britannica.com/topic/Great-Wall-of-China" },
        { title: "", url: "http://example.org/fourth" },
        { title: "Fifth", url: "https://example.net/fifth" },
      ],
    },
    { claim: "It is over 20,000 km long.", status: "supported", summary: "", sources: [] },
    { claim: "Built in one dynasty.", status: "mixed", summary: "Many dynasties.", sources: [] },
    { claim: "Visible from low orbit.", status: "unverified", summary: "No clear source.", sources: [] },
  ],
};

describe("safeSource", () => {
  it("accepts http(s) and shows the bare domain", () => {
    expect(safeSource("https://www.nasa.gov/x")).toEqual({ href: "https://www.nasa.gov/x", domain: "nasa.gov" });
    expect(safeSource("http://example.org/")?.domain).toBe("example.org");
  });

  it("drops everything else", () => {
    for (const u of ["javascript:alert(1)", "data:text/html,x", "/relative", "ftp://x.org/a", "not a url", ""]) {
      expect(safeSource(u), u).toBeNull();
    }
  });
});

describe("FactCheckList", () => {
  it("checked: every claim with a status chip, at most three safe links each", () => {
    const out = html(<FactCheckList factCheck={checked} lang="en" />);
    expect(out).toContain(t("en", "factcheck.title"));
    expect(out).toContain(esc(t("en", "factcheck.lead")));
    for (const s of ["supported", "refuted", "mixed", "unverified"] as const) {
      expect(out).toContain(`data-status="${s}"`);
      expect(out).toContain(esc(t("en", `factcheck.status.${s}`)));
    }
    expect(count(out, "<a ")).toBe(3);
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("data:text");
    expect(out).not.toContain('href="/local"');
    expect(out).toContain('rel="noopener noreferrer nofollow ugc"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain(">britannica.com<");
    // full title for screen readers; empty titles fall back to the domain
    expect(out).toContain("Great Wall of China | Britannica, opens in a new tab");
    expect(out).toContain("example.org, opens in a new tab");
    expect(out).not.toContain("Fifth");
  });

  it("none and unavailable are one muted line each, no links", () => {
    const none = html(<FactCheckList factCheck={{ status: "none", claims: [] }} lang="tr" />);
    expect(none).toContain(t("tr", "factcheck.none"));
    expect(none).not.toContain("<a ");
    const off = html(<FactCheckList factCheck={{ status: "unavailable", claims: [] }} lang="en" />);
    expect(off).toContain(esc(t("en", "factcheck.unavailable")));
    expect(off).not.toContain("<ol");
  });
});

const base: VerdictResult = {
  verdict: "side_b",
  dispute_type: "factual",
  headline: "You can't see the Wall from the Moon",
  crux: "Can the naked eye resolve the Wall from lunar distance?",
  split_points: null,
  conditional: null,
  argument_map: {
    side_a: [{ claim: "Astronauts saw it.", kind: "fact" }],
    side_b: [{ claim: "It is too narrow.", kind: "fact" }],
    bedrock_a: "Popular accounts.",
    bedrock_b: "Optics.",
  },
  facts_relied_on: ["The Wall is a few metres wide."],
  losing_side_best_point: "Some astronauts reported seeing it from low orbit.",
  confidence: 5,
  runs: ["side_b", "side_b", "side_b"],
  demo: false,
  lang: "en",
};

describe("VerdictView premium", () => {
  const premium: VerdictResult = {
    ...base,
    tier: "premium",
    fact_check: checked,
    panel: { models: ["claude-sonnet-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"] },
  };

  it("adds the badge, the panel line and the fact-check, before the facts", () => {
    const out = html(<VerdictView result={premium} lang="en" />);
    expect(out).toContain(">Premium<");
    expect(out).toContain("Premium panel with a web fact-check. Judges: 2 strong + 1 quick");
    expect(out.indexOf(t("en", "factcheck.title"))).toBeLessThan(out.indexOf("The Wall is a few metres wide."));
  });

  it("leaves free results exactly as they were", () => {
    const out = html(<VerdictView result={base} lang="en" />);
    expect(out).not.toContain(">Premium<");
    expect(out).not.toContain(t("en", "factcheck.title"));
    expect(out).not.toContain("Judges:");
  });
});

describe("panelSummary", () => {
  it("counts seat tiers in a fixed order, escalation included, without model names", () => {
    expect(panelSummary(["claude-haiku-5-5", "claude-sonnet-5-5", "claude-sonnet-5-5"], "en")).toBe(
      "Judges: 2 strong + 1 quick",
    );
    expect(
      panelSummary(["claude-sonnet-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-haiku-5-5", "claude-haiku-5-5"], "tr"),
    ).toBe("Yargıçlar: 2 güçlü + 3 hızlı");
    expect(panelSummary(["mystery-model"], "en")).toBe("Judges: 1 strong");
    expect(panelSummary(["claude-haiku-5-5"], "en")).toBe("Judges: 1 quick");
  });
});

describe("JudgingOverlay premium line", () => {
  const props = { lang: "en" as const, done: false, result: null, onFinished: () => {} };

  it("shows the web fact-check line and premium helper only when premium", () => {
    const plain = html(<JudgingOverlay {...props} />);
    expect(plain).not.toContain(t("en", "thinking.factcheck"));
    expect(plain).toContain(esc(t("en", "thinking.helper")));
    const premium = html(<JudgingOverlay {...props} premium />);
    expect(premium).toContain(t("en", "thinking.factcheck"));
    expect(premium).toContain(esc(t("en", "thinking.premiumHelper")));
  });

  it("announces the web check as finished only once the verdict is in, outside the aria-hidden list", () => {
    const srLine = (s: string) => `<p class="sr-only" aria-live="polite" aria-atomic="true">${esc(s)}</p>`;
    const waiting = html(<JudgingOverlay {...props} premium />);
    expect(waiting).toContain(srLine(t("en", "thinking.factcheck")));
    expect(waiting).not.toContain(t("en", "thinking.factcheckDone"));
    const done = html(<JudgingOverlay {...props} done premium />);
    expect(done).toContain(srLine(t("en", "thinking.factcheckDone")));
    expect(html(<JudgingOverlay {...props} />)).not.toContain(t("en", "thinking.factcheckDone"));
  });
});

describe("FactCheckList: the 'nothing looked up' line agrees with the dispute type", () => {
  it("factual and mixed disputes never say 'values or meanings, not facts'", () => {
    for (const lang of ["en", "tr"] as const) {
      for (const disputeType of ["factual", "mixed"] as const) {
        const out = html(<FactCheckList factCheck={{ status: "none", claims: [] }} lang={lang} disputeType={disputeType} />);
        expect(out).toContain(esc(t(lang, "factcheck.noneFactual")));
        expect(out).not.toContain(esc(t(lang, "factcheck.none")));
      }
      for (const disputeType of ["values", "definitional", "logical", undefined] as const) {
        const out = html(<FactCheckList factCheck={{ status: "none", claims: [] }} lang={lang} disputeType={disputeType} />);
        expect(out).toContain(esc(t(lang, "factcheck.none")));
      }
    }
  });

  it("the verdict card passes its dispute type", () => {
    const out = html(<VerdictView result={{ ...base, tier: "premium", fact_check: { status: "none", claims: [] } }} lang="en" />);
    expect(out).toContain(esc(t("en", "factcheck.noneFactual")));
  });
});
