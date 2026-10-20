import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VerdictView } from "../components/VerdictView";
import { restoredHeadline, VerdictList } from "../components/account/VerdictList";
import { RemovedVerdict } from "../components/RemovedVerdict";
import { t } from "../lib/i18n";
import { defaultDisplay, DisplayNameInput, firstNameOf, publicNameMap } from "../lib/originals-types";
import type { VerdictResult } from "../lib/types";

const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;");

const base: VerdictResult = {
  verdict: "side_b",
  dispute_type: "values",
  headline: "Party B is right",
  crux: "Whether Party A owes Party B the money.",
  split_points: null,
  conditional: null,
  argument_map: {
    side_a: [{ claim: "Party A paid for dinner.", kind: "fact" }],
    side_b: [{ claim: "Party B paid for the concert.", kind: "fact" }],
    bedrock_a: "Even.",
    bedrock_b: "Owed.",
  },
  facts_relied_on: [],
  losing_side_best_point: "Party A did pay for dinner.",
  confidence: 4,
  runs: ["side_b", "side_b", "side_b"],
  demo: false,
  lang: "en",
};

describe("share page names", () => {
  it("shows the display names, never 'You' (a name like Ben stays a name)", () => {
    const names = publicNameMap({ a: "Ben", b: "Harry", others: {} });
    const out = html(<VerdictView result={base} nameMap={names} publicNames lang="en" />);
    expect(out).toContain("Harry is right");
    expect(out).toContain("Ben");
    expect(out).not.toMatch(/\bYou\b/);
  });

  it("a Turkish display name 'Ben' stays a name in a Turkish verdict", () => {
    const tr: VerdictResult = { ...base, lang: "tr", headline: "Taraf B haklı", crux: "Taraf A'nın Taraf B'ye borcu var mı?" };
    const names = publicNameMap({ a: "Ben", b: "Harry", others: {} });
    const out = html(<VerdictView result={tr} nameMap={names} publicNames lang="tr" />);
    expect(out).toContain("Harry haklı");
    expect(out).not.toMatch(/\bSen\b/);
  });

  it("names off (or none stored): the labels, as before", () => {
    const out = html(<VerdictView result={base} publicNames lang="en" />);
    expect(out).toContain("Party B is right");
    expect(out).not.toContain("Harry");
  });

  it("the writer's own view restores from the stored map (narrator becomes You)", () => {
    const map = [
      { original: "I", replacement: "Party A" },
      { original: "Harry Potter", replacement: "Party B" },
    ];
    const out = html(<VerdictView result={base} nameMap={map} lang="en" />);
    expect(out).toContain("Harry Potter is right");
  });

  it("the removed page says so, in both languages", () => {
    expect(html(<RemovedVerdict lang="en" />)).toContain(t("en", "removed.title"));
    expect(html(<RemovedVerdict lang="tr" headingLevel={1} />)).toContain("Bu karar kaldırıldı");
  });
});

describe("display-name rules", () => {
  it("defaults: first names for Party B and Person C+, nothing for the writer, nothing for descriptions", () => {
    const map = [
      { original: "I", replacement: "Party A" },
      { original: "Harry Potter", replacement: "Party B" },
      { original: "my roommate", replacement: "Person C" },
      { original: "Leo's", replacement: "Person D" },
      { original: "x", replacement: "Person E" },
    ];
    expect(defaultDisplay(map, "en")).toEqual({ a: null, b: "Harry", others: { "Person D": "Leo" } });
    expect(firstNameOf("Ayşe Nur")).toBe("Ayşe");
    expect(firstNameOf("@harry99")).toBeNull();
    expect(firstNameOf("")).toBeNull();
  });

  it("DisplayNameInput trims and collapses spaces, refuses labels and markup", () => {
    expect(DisplayNameInput.parse("  Aytu   T. ")).toBe("Aytu T.");
    for (const bad of ["", "Party A", "taraf b'ye", "Person C", "<script>", "a​b", "x".repeat(41)]) {
      expect(DisplayNameInput.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe("account list", () => {
  it("restores the writer's names in headlines and greys out removed verdicts", () => {
    const v = {
      id: "v1",
      kind: "free" as const,
      createdAt: "2026-10-20T10:00:00.000Z",
      verdict: "side_b" as const,
      headline: "Party B is right",
      nameMap: [
        { original: "I", replacement: "Party A" },
        { original: "Harry", replacement: "Party B" },
      ],
      removed: false,
    };
    expect(restoredHeadline(v)).toBe("Harry is right");
    const out = html(
      <VerdictList
        lang="en"
        state={{ status: "ready", verdicts: [v, { ...v, id: "v2", headline: null, nameMap: [], removed: true }] }}
      />,
    );
    expect(out).toContain('href="/v/v1"');
    expect(out).toContain(esc("Harry is right"));
    expect(out).not.toContain('href="/v/v2"');
    expect(out).toContain(t("en", "account.verdicts.removed"));
  });
});

describe("review fixes: owner views", () => {
  it("the writer's own view uses their saved display name, with (you), where 'you' cannot be restored", async () => {
    const { VerdictView: View } = await import("../components/VerdictView");
    const tr: VerdictResult = {
      ...base,
      lang: "tr",
      headline: "Bilet parası hâlâ Taraf A'da duruyor",
      crux: "Taraf A'nın Taraf B'ye borcu var mı?",
    };
    const map = [
      { original: "Ben", replacement: "Party A" },
      { original: "Burak", replacement: "Party B" },
    ];
    const without = html(<View result={tr} nameMap={map} lang="tr" />);
    expect(without).toContain("Taraf A (sen)");
    const out = html(<View result={tr} nameMap={map} lang="tr" selfDisplayName="Ayşe" />);
    expect(out).toContain("Ayşe (sen)");
    expect(out).toContain(esc("Ayşe'de duruyor"));
    expect(out).not.toContain("Taraf A (sen)");
  });

  it("the names prompt is skipped once the server says the names were saved", async () => {
    const { needsNamesPrompt } = await import("../components/ShareButtons");
    const owner = {
      verdictId: "v1",
      token: null,
      display: { namesVisible: false, a: null, b: "Harry", others: {} },
      suggestedA: null,
      aIsWriter: true,
      otherLabels: [],
      namesConfirmed: false,
      onSaved: () => {},
    };
    expect(needsNamesPrompt(owner, false)).toBe(true);
    expect(needsNamesPrompt(owner, true)).toBe(false);
    expect(needsNamesPrompt({ ...owner, namesConfirmed: true }, false)).toBe(false);
    expect(needsNamesPrompt({ ...owner, display: { ...owner.display, a: "Ayşe" } }, false)).toBe(false);
    expect(needsNamesPrompt(undefined, false)).toBe(false);
  });

  it("Party B of a case is not sent to a case page they have no link to", async () => {
    const { OwnerPanel } = await import("../components/OwnerTools");
    const mine = {
      id: "v1",
      kind: "case" as const,
      createdAt: "2026-10-20T00:00:00.000Z",
      result: base,
      original: null,
      originalStatus: "stored" as const,
      nameMap: [],
      display: { namesVisible: true, a: null, b: null, others: {} },
      suggested: { a: null },
      removed: null,
      case: { id: "c1", party: "b" as const },
      via: "session" as const,
      namesConfirmed: true,
    };
    const b = html(<OwnerPanel lang="en" mine={mine} token={null} owner={null} signedIn onRemoved={() => {}} />);
    expect(b).toContain(esc(t("en", "owner.caseRespondent")));
    expect(b).not.toContain("/c/c1");
    const a = html(
      <OwnerPanel lang="en" mine={{ ...mine, case: { id: "c1", party: "a" } }} token={null} owner={null} signedIn onRemoved={() => {}} />,
    );
    expect(a).toContain("/c/c1");
  });

  it("the removed card can drop its own call to action and be focused", () => {
    const out = html(<RemovedVerdict lang="en" headingLevel={1} headingId="gone" cta={false} />);
    expect(out).toContain('id="gone"');
    expect(out).toContain('tabindex="-1"');
    expect(out).not.toContain(t("en", "shared.cta"));
    expect(html(<RemovedVerdict lang="en" />)).toContain(esc(t("en", "shared.cta")));
  });
});

describe("review fixes: display defaults and language", () => {
  it("a bystander narrator mapped to Person C is never a display name; Party A then gets a first name", () => {
    const map = [
      { original: "Ayşe", replacement: "Party A" },
      { original: "Mehmet", replacement: "Party B" },
      { original: "Ben", replacement: "Person C" },
    ];
    expect(defaultDisplay(map, "tr")).toEqual({ a: "Ayşe", b: "Mehmet", others: {} });
    // An English friend named Ben is still a name.
    expect(defaultDisplay([{ original: "I", replacement: "Party A" }, { original: "Ben", replacement: "Person C" }], "en")).toEqual({
      a: null,
      b: null,
      others: { "Person C": "Ben" },
    });
    expect(firstNameOf("Me")).toBeNull();
  });

  it("an English text with a Turkish place name stays English", async () => {
    const { localizeLabelsAuto, textLang } = await import("../lib/names");
    const s = "Party B moved to Beşiktaş and Party A said the rent is too high.";
    expect(textLang(s)).toBe("en");
    expect(localizeLabelsAuto(s)).toBe(s);
    expect(textLang("Ayşe'nin borcu ödenmeli")).toBe("tr");
  });
});
