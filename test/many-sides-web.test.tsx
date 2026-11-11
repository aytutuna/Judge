import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CasePanel } from "../components/case/CaseScreen";
import { HomeForm, type HomeFormProps } from "../components/home/HomeForm";
import { JudgingScreen } from "../components/JudgingScreen";
import { VerdictView } from "../components/VerdictView";
import { summarize } from "../components/court/story";
import { stateLabel, tone } from "../components/shell/history-labels";
import { fromRow } from "../components/shell/useHistory";
import type { CaseView } from "../lib/case-types";
import { parseDraft } from "../lib/draft";
import type { HistoryRow } from "../lib/history-types";
import { loadLocales, t } from "../lib/i18n";
import { ENABLED, PARTY_LABELS } from "../lib/langs";
import { partyLabel } from "../lib/names";
import { joinSides, manySidesOk } from "../lib/sides";
import type { PartyId, VerdictResult } from "../lib/types";
import { OWNER_NAMES, caseView } from "./ui-case-fixtures";

const noop = () => {};
const text = "x".repeat(30);

const result = (parties: PartyId[], winner: PartyId | null, over: Partial<VerdictResult> = {}): VerdictResult => ({
  verdict: winner === "a" ? "side_a" : winner === "b" ? "side_b" : "too_close",
  dispute_type: "values",
  headline: winner ? `Party ${winner.toUpperCase()} carries the table` : "Nobody carries the table",
  crux: "Whose turn it is.",
  split_points: null,
  conditional: null,
  argument_map: { side_a: [], side_b: [], bedrock_a: "", bedrock_b: "" },
  facts_relied_on: [],
  losing_side_best_point: "",
  confidence: 4,
  runs: ["split", "split", "split"],
  demo: false,
  lang: "en",
  parties,
  winner,
  votes: winner ? [winner, winner, parties[1] === winner ? "a" : parties[1]] : ["other", "other", "other"],
  sides: parties.map((party) => ({ party, claims: [{ claim: `${party} claim`, kind: "fact" as const }], bedrock: `${party} bedrock` })),
  others: parties.filter((p) => p !== winner && winner).map((party) => ({ party, line: `${party} fell short on the dishes.` })),
  ...over,
});

const html = (el: React.ReactElement) => renderToStaticMarkup(el);

describe("verdict with three or four sides", () => {
  const three = result(["a", "b", "c"], "c");
  const four = result(["a", "b", "c", "d"], "d");

  it("lists every side, marks the winner and gives each other side its line", () => {
    const out = html(<VerdictView result={four} lang="en" />);
    for (const name of ["Party A", "Party B", "Party C", "Party D"]) expect(out).toContain(name);
    expect(out).toContain('data-party="d" data-winner=""');
    expect(out).not.toContain('data-party="c" data-winner');
    expect(out).toContain("a fell short on the dishes.");
    expect(out).toContain("c fell short on the dishes.");
    expect(out).not.toContain("d fell short on the dishes.");
  });

  it("has no balance, tug or lean bar", () => {
    const out = html(<VerdictView result={three} lang="en" />);
    expect(out).not.toContain("<svg viewBox=\"0 0 320");
    expect(out).not.toMatch(/role="img"/);
  });

  it("is green when the viewer's side wins and red when another side does", () => {
    const won = html(<VerdictView result={three} lang="en" selfParty="C" viewerIsSelfParty />);
    expect(won).toContain('data-tone="win"');
    expect(won).toContain(t("en", "verdict.winSelf").replace(/'/g, "&#x27;"));
    expect(won).toContain('data-you="c"');
    const lost = html(<VerdictView result={three} lang="en" selfParty="A" viewerIsSelfParty />);
    expect(lost).toContain('data-tone="lose"');
    expect(lost).toContain("Party C is right");
  });

  it("stays neutral on a share page, and when it is too close", () => {
    expect(html(<VerdictView result={three} lang="en" publicNames />)).not.toContain("data-tone=\"");
    const close = html(<VerdictView result={result(["a", "b", "c"], null)} lang="en" selfParty="B" viewerIsSelfParty />);
    expect(close).not.toContain("data-tone=\"");
    expect(close).toContain(t("en", "verdict.tooClose"));
  });

  it("a two-sided verdict is drawn as before", () => {
    const two = result(["a", "b", "c"], "a");
    const { parties, winner, votes, sides, others, ...plain } = two;
    void parties;
    void winner;
    void votes;
    void sides;
    void others;
    const out = html(<VerdictView result={{ ...plain, runs: ["side_a", "side_a", "side_b"] }} lang="en" />);
    expect(out).not.toContain("data-winner");
    expect(out).toContain("Party A is right");
  });
});

describe("history rows for many sides", () => {
  const row = (over: Partial<HistoryRow>): HistoryRow =>
    ({
      kind: "case",
      id: "c1",
      at: "2026-11-01T10:00:00.000Z",
      role: "owner",
      party: "a",
      state: "ready",
      verdict: "too_close",
      headline: "The table goes to Party C",
      excerpt: null,
      nameMap: [
        { original: "Cem", replacement: "Party C" },
        { original: "I", replacement: "Party A" },
      ],
      removable: true,
      yourMove: false,
      contextAdded: false,
      removed: false,
      inviteToken: null,
      parties: ["a", "b", "c"],
      winner: "c",
      ...over,
    }) as HistoryRow;

  it("colours by the viewer's own party, not by a or b", () => {
    expect(tone(fromRow(row({ party: "a" })))).toBe("theirs");
    expect(tone(fromRow(row({ party: "c", role: "respondent" })))).toBe("yours");
    expect(tone(fromRow(row({ winner: null })))).toBeUndefined();
  });

  it("names the winner, you or too close", () => {
    expect(stateLabel("en", fromRow(row({ party: "a" })))).toBe("Cem is right");
    expect(stateLabel("en", fromRow(row({ party: "c", role: "respondent" })))).toBe(t("en", "verdict.winSelf"));
    expect(stateLabel("en", fromRow(row({ winner: null })))).toBe(t("en", "verdict.tooClose"));
  });
});

describe("court story", () => {
  it("takes the winner from the result on three or four sides", () => {
    const r = result(["a", "b", "c", "d"], "d");
    expect(summarize(r).winner).toBe("d");
    expect(summarize(r).votes).toEqual(r.votes);
    expect(summarize(result(["a", "b", "c"], null)).winner).toBeNull();
  });
});

describe("home form with more sides", () => {
  const props = (over: Partial<HomeFormProps> = {}): HomeFormProps => ({
    lang: "en",
    mine: text,
    onMine: noop,
    mineName: "",
    onMineName: noop,
    theirs: text,
    onTheirs: noop,
    theirName: "",
    onTheirName: noop,
    theirsOpen: true,
    onAddTheirs: noop,
    onRemoveTheirs: noop,
    length: 60,
    blank: false,
    onClear: noop,
    onExample: noop,
    canSubmit: true,
    onSubmit: noop,
    canInvite: false,
    holding: false,
    error: null,
    status: null,
    ...over,
  });
  const form = (over: Partial<HomeFormProps> = {}) => html(<HomeForm {...props(over)} />);
  const more = (n: number) => Array.from({ length: n }, () => ({ text, name: "" }));

  it("offers another side once the second has text, up to four", () => {
    expect(form()).toContain(t("en", "home.addSide"));
    expect(form({ theirs: "" })).not.toContain(t("en", "home.addSide"));
    expect(form({ more: more(1) })).toContain(t("en", "home.addSide"));
    expect(form({ more: more(2) })).not.toContain(t("en", "home.addSide"));
  });

  it("shows a card per side, the last one as the composer", () => {
    const out = form({ more: more(2) });
    expect(out.match(/<textarea/g)).toHaveLength(4);
    expect(out).toContain('data-side="C"');
    expect(out).toContain('data-side="D" data-docked');
  });

  it("only the last side can be removed", () => {
    expect(form().match(/aria-label="Remove their side"/g)).toHaveLength(1);
    expect(form({ more: more(2) }).match(/aria-label="Remove their side"/g)).toHaveLength(1);
  });

  it("two sides look as before: no add row until their side has text", () => {
    const out = form({ theirs: "", theirsOpen: true });
    expect(out).not.toContain(t("en", "home.addTheirSide"));
    expect(out).not.toContain(t("en", "home.addSide"));
  });

  it("offers links for every other side while none of them has text", () => {
    const out = form({ theirs: "", more: more(1).map((s) => ({ ...s, text: "" })), onInvite: noop, canInvite: true });
    expect(out).toContain(t("en", "home.sendLink"));
    expect(out).toContain(t("en", "home.addSide"));
  });
});

describe("judging screen with more sides", () => {
  it("shows a tile for each of C and D, named or labelled", () => {
    const out = html(
      <JudgingScreen
        lang="en"
        mine={{ name: "Ada", text: "Mine." }}
        theirs={{ name: "", text: "Theirs." }}
        more={[
          { name: "Cem", text: "Third." },
          { name: " ", text: "Fourth." },
        ]}
        done={false}
        result={null}
        onFinished={noop}
        onCancel={noop}
      />,
    );
    expect(out).toContain('data-side="C"');
    expect(out).toContain(">Cem<");
    expect(out).toContain('data-side="D"');
    expect(out).toContain(">Party D<");
  });
});

describe("typed sides", () => {
  it("joins C and D after the first two", () => {
    const a = { text: "One.", name: "Ada" };
    const b = { text: "Two.", name: "" };
    expect(joinSides("en", a, b, [{ text: "Three.", name: "Cem" }, { text: "Four.", name: "" }])).toBe(
      "Ada says: One.\n\nTheir side: Two.\n\nCem says: Three.\n\nParty D: Four.",
    );
  });

  it("wants each of them worth judging", () => {
    expect(manySidesOk([{ text, name: "" }, { text, name: "" }, { text, name: "" }])).toBe(true);
    expect(manySidesOk([{ text, name: "" }, { text: "short", name: "" }, { text, name: "" }])).toBe(false);
  });
});

describe("draft with more sides", () => {
  it("keeps C and D, and an old draft without them still restores", () => {
    const draft = parseDraft(JSON.stringify({ argument: text, otherSide: text, theirsOpen: true, more: [{ text, name: "Cem" }, { text: "", name: "" }] }));
    expect(draft?.more).toEqual([{ text, name: "Cem" }, { text: "", name: "" }]);
    expect(parseDraft(JSON.stringify({ argument: text, otherSide: text }))?.more).toBeUndefined();
  });

  it("drops what is malformed", () => {
    expect(parseDraft(JSON.stringify({ argument: text, more: "no" }))?.more).toBeUndefined();
    expect(parseDraft(JSON.stringify({ argument: text, more: [{ text: 5 }] }))?.more).toBeUndefined();
    expect(parseDraft(JSON.stringify({ argument: text, more: [{ text }, { text }, { text }] }))?.more).toHaveLength(2);
  });
});

describe("owner case page with a link per side", () => {
  const view = (over: Partial<CaseView> = {}): CaseView =>
    caseView({
      parties: ["a", "b", "c"],
      respondentAnswered: true,
      invites: [
        { party: "b", status: "answered", inviteUrl: null, answeredAt: "2026-10-21T09:00:00.000Z" },
        { party: "c", status: "waiting", inviteUrl: "https://okjudge.com/r/CCCCCCCCCCCCCCCCCCCCCC", answeredAt: null },
      ],
      inviteUrl: null,
      canJudgeAnswered: true,
      ...over,
    });
  const owner = (v: CaseView) =>
    html(
      <CasePanel
        lang="en"
        view={v}
        names={OWNER_NAMES}
        overlay={null}
        onOverlayFinished={noop}
        fresh={false}
        busy={false}
        actionError={null}
        resetDone={false}
        onJudgeNow={noop}
        onRetry={noop}
        onReset={noop}
        onRemove={noop}
        appeal={null}
      />,
    );

  it("lists each invited side with its status and only the waiting side's link", () => {
    const out = owner(view());
    expect(out).toContain('data-party="b"');
    expect(out).toContain('data-party="c"');
    expect(out).toContain(t("en", "case.side.answered"));
    expect(out).toContain(t("en", "case.side.waiting"));
    expect(out).toContain("https://okjudge.com/r/CCCCCCCCCCCCCCCCCCCCCC");
    expect(out).toContain(t("en", "case.invite.copy"));
  });

  it("offers to judge with the sides that answered, and says what that does", () => {
    const out = owner(view());
    expect(out).toContain(t("en", "case.judgeAnswered"));
    expect(out).toContain(t("en", "case.judgeAnswered.confirm").replace(/'/g, "&#x27;"));
    expect(owner(view({ canJudgeAnswered: false }))).toContain(t("en", "case.judgeNow"));
  });

  it("offers the same once the invites expired, and says it uses a unit", () => {
    const out = owner(view({ status: "expired" }));
    expect(out).toContain(t("en", "case.judgeAnswered"));
    expect(out).toContain(t("en", "case.judgeExpired.yes"));
  });
});

describe("party labels", () => {
  it("C and D read like A and B in every language", async () => {
    await loadLocales();
    for (const lang of ENABLED) {
      const word = (PARTY_LABELS[lang] ?? PARTY_LABELS.en)[0].slice(0, -1);
      expect(partyLabel(lang, "a"), lang).toBe(`${word}A`);
      expect(partyLabel(lang, "c"), lang).toBe(`${word}C`);
      expect(partyLabel(lang, "d"), lang).toBe(`${word}D`);
    }
  });
});
