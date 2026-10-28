import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HistoryList, groupHistory, stateLabel } from "../components/shell/HistoryList";
import { TabBar } from "../components/shell/TabBar";
import { fromRow, mergeHistory, type HistoryItem } from "../components/shell/useHistory";
import type { HistoryRow } from "../lib/history-types";
import { t } from "../lib/i18n";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;");

// Local time, so the day boundaries hold in any time zone.
const NOW = new Date(2026, 9, 23, 15, 0).getTime();
const at = (daysAgo: number, hour = 9) => new Date(2026, 9, 23 - daysAgo, hour).toISOString();

const row = (over: Partial<HistoryRow> & { id: string }): HistoryRow => ({
  kind: "verdict",
  role: "owner",
  party: "a",
  at: at(0),
  createdAt: at(0),
  state: "ready",
  yourMove: false,
  verdict: "side_a",
  contextAdded: false,
  contextBy: null,
  headline: `Title ${over.id}`,
  excerpt: null,
  nameMap: [],
  expiresAt: null,
  removed: false,
  removable: true,
  inviteToken: null,
  ...over,
});

const OWNER_MAP = [
  { original: "I", replacement: "Party A" },
  { original: "Deniz", replacement: "Party B" },
];
const RESPONDENT_MAP = [
  { original: "I", replacement: "Party B" },
  { original: "Ada", replacement: "Party A" },
];
const TOKEN = "T".repeat(22);

const ROWS: HistoryRow[] = [
  row({ id: "today1", at: at(0, 11) }),
  row({
    id: "case1",
    kind: "case",
    at: at(0, 8),
    state: "waiting",
    verdict: null,
    headline: null,
    excerpt: "Party B says the bike was theirs",
    nameMap: OWNER_MAP,
  }),
  row({ id: "week1", at: at(3), verdict: "side_b" }),
  row({ id: "week2", kind: "case", at: at(6, 1), headline: null, verdict: "split" }),
  row({ id: "old1", at: at(7, 23), state: "judging", verdict: null, headline: null, removable: false }),
  row({ id: "gone", at: at(30), state: "removed", removed: true, headline: null, verdict: null, removable: false }),
  row({ id: "gonecase", kind: "case", at: at(40), state: "removed_by_other", removed: true, nameMap: OWNER_MAP, verdict: "side_b" }),
];
const ITEMS: HistoryItem[] = ROWS.map(fromRow);

function list(over: Partial<ComponentProps<typeof HistoryList>> = {}): string {
  return renderToStaticMarkup(
    <HistoryList
      lang="en"
      history={{ items: ITEMS, status: "ready", more: false, loadingMore: false }}
      now={NOW}
      {...over}
    />,
  );
}

function tabs(over: Partial<ComponentProps<typeof TabBar>> = {}): string {
  return renderToStaticMarkup(<TabBar lang="en" pathname="/" account="menu" {...over} />);
}

const label = (over: Partial<HistoryRow> & { id: string }) => stateLabel("en", fromRow(row(over)));

describe("groupHistory", () => {
  it("splits today, the six days before and earlier, leaving out empty groups", () => {
    const groups = groupHistory(ITEMS, NOW);
    expect(groups.map((g) => [g.key, g.items.map((i) => i.id)])).toEqual([
      ["today", ["today1", "case1"]],
      ["week", ["week1", "week2"]],
      ["earlier", ["old1", "gone", "gonecase"]],
    ]);
    expect(groupHistory(ITEMS.slice(4), NOW).map((g) => g.key)).toEqual(["earlier"]);
    expect(groupHistory([], NOW)).toEqual([]);
  });
});

describe("stateLabel", () => {
  it("says each state in plain words, naming the other side from your own names", () => {
    expect(label({ id: "a", state: "judging" })).toBe("Judges thinking");
    expect(label({ id: "a", state: "rejudging" })).toBe("Judges thinking again");
    expect(label({ id: "a", state: "failed" })).toBe("Didn't finish");
    expect(label({ id: "a", state: "rejudge_failed" })).toBe("New context didn't go through");
    expect(label({ id: "a", kind: "case", state: "waiting", nameMap: OWNER_MAP })).toBe("Waiting for Deniz to answer");
    expect(label({ id: "a", kind: "case", state: "waiting" })).toBe("Waiting for the other side to answer");
    expect(label({ id: "a", kind: "case", state: "expired" })).toBe("Link expired");
    expect(label({ id: "a", state: "removed" })).toBe("Removed");
    expect(label({ id: "a", kind: "case", state: "removed_by_other", nameMap: OWNER_MAP })).toBe("Removed by Deniz");
    expect(label({ id: "a", kind: "case", state: "removed_by_other" })).toBe("Removed by the other side");
    expect(label({ id: "a", state: "unknown" as HistoryRow["state"] })).toBeNull();
  });

  it("says a ruling from your side: yours, theirs, or the outcome", () => {
    expect(label({ id: "a", verdict: "side_a", nameMap: OWNER_MAP })).toBe("You're right");
    expect(label({ id: "a", verdict: "side_b", nameMap: OWNER_MAP })).toBe("Deniz is right");
    expect(label({ id: "a", verdict: "side_b" })).toBe("Party B is right");
    const answered = { kind: "case" as const, role: "respondent" as const, party: "b" as const, nameMap: RESPONDENT_MAP };
    expect(label({ id: "a", ...answered, verdict: "side_b" })).toBe("You're right");
    expect(label({ id: "a", ...answered, verdict: "side_a" })).toBe("Ada is right");
    expect(label({ id: "a", verdict: "split" })).toBe(t("en", "verdict.split"));
    expect(label({ id: "a", verdict: "too_close" })).toBe(t("en", "verdict.tooClose"));
    expect(label({ id: "a", verdict: null })).toBe("Verdict ready");
    // Written about two other people: the winner is named, not "you".
    expect(label({ id: "a", verdict: "side_a", nameMap: [{ original: "Ali", replacement: "Party A" }] })).toBe("Ali is right");
  });
});

describe("HistoryList", () => {
  it("shows the date headings in order", () => {
    const html = list();
    const heads = ["shell.today", "shell.week", "shell.earlier"].map((k) =>
      html.indexOf(`>${t("en", k as "shell.today")}</h2>`),
    );
    expect(heads.every((i) => i > 0)).toBe(true);
    expect([...heads].sort((a, b) => a - b)).toEqual(heads);
  });

  it("links verdicts and cases, each with its state, names put back", () => {
    const html = list();
    expect(html).toContain('href="/v/today1"');
    expect(html).toContain('href="/c/case1"');
    expect(html).toContain("Waiting for Deniz to answer");
    expect(html).toContain("Deniz says the bike was theirs");
    expect(html).toContain(t("en", "verdict.split"));
    // An untitled case falls back to its date.
    expect(html).toContain(esc(t("en", "case.list.untitled", { date: "October 17" })));
    expect(html).not.toContain("aria-current");
  });

  it("does not link a verdict still being judged, or one that was removed", () => {
    const html = list();
    expect(html).not.toContain('href="/v/old1"');
    expect(html).toContain("Judges thinking");
    expect(html).not.toContain('href="/v/gone"');
  });

  it("mutes removed items; a removed verdict says so once", () => {
    const html = list();
    expect(html).toMatch(/<span class="[^"]*" data-removed="">/);
    expect(html).toMatch(/<a [^>]*data-removed=""[^>]*href="\/c\/gonecase"/);
    expect(html).toContain("Removed by Deniz");
    expect(html.split(">Removed<").length - 1).toBe(1);
  });

  it("marks a case you answered, opens it on its invite page, and tags your turn and added context", () => {
    const rows = [
      row({
        id: "ans",
        kind: "case",
        role: "respondent",
        party: "b",
        nameMap: RESPONDENT_MAP,
        inviteToken: TOKEN,
        verdict: "side_b",
        contextAdded: true,
      }),
      row({ id: "dead", kind: "case", role: "respondent", party: "b", inviteToken: null, at: at(0, 7) }),
      row({ id: "retry", kind: "case", state: "failed", yourMove: true, verdict: null, at: at(0, 6) }),
    ];
    const html = list({ history: { items: rows.map(fromRow), status: "ready", more: false, loadingMore: false } });
    expect(html).toContain(`href="/r/${TOKEN}"`);
    expect(html).not.toContain("/c/ans");
    expect(html).not.toContain("/c/dead");
    expect(html.split("You answered").length - 1).toBe(2);
    expect(html).toContain("After new context");
    expect(html).toContain('data-tone="yours"');
    expect(html).toContain("Your turn");
    expect(html).toContain('href="/c/retry"');
  });

  it("holds the account's rows and this browser's own in one list", () => {
    const answered = row({ id: "mine", kind: "case", role: "respondent", party: "b", at: at(0, 12), inviteToken: TOKEN });
    const items = mergeHistory({ rows: ROWS, next: null }, [{ id: "local", createdAt: at(0, 10), headline: "Local one" }], [answered]);
    expect(items.map((i) => i.id)).toEqual(["mine", "today1", "local", "case1", "week1", "week2", "old1", "gone", "gonecase"]);
  });

  it("signed out: this browser's list with a sign-in line back to the page", () => {
    const html = list({ signIn: true });
    expect(html).toContain(t("en", "shell.local"));
    expect(html).toContain(`href="/signin?next=${encodeURIComponent("/verdicts")}"`);
    expect(html).toContain('href="/v/today1"');
    expect(list()).not.toContain("/signin");
  });

  it("says when there is nothing yet, or that it is still loading", () => {
    const empty = list({ history: { items: [], status: "ready", more: false, loadingMore: false } });
    expect(empty).toContain(t("en", "shell.empty"));
    expect(empty).not.toContain("<h2");
    const loading = list({ history: { items: [], status: "loading", more: false, loadingMore: false } });
    expect(loading).toMatch(/role="status"[^>]*>Loading your history…/);
    expect(list({ history: { items: [], status: "error", more: false, loadingMore: false } })).toContain(
      esc(t("en", "shell.loadFailed")),
    );
  });

  it("offers more while a cursor is left, disabled while it loads", () => {
    expect(list({ history: { items: ITEMS, status: "ready", more: true, loadingMore: false } })).toContain(
      t("en", "shell.loadMore"),
    );
    const busy = list({ history: { items: ITEMS, status: "ready", more: true, loadingMore: true } });
    expect(busy).toMatch(/<button[^>]*disabled=""[^>]*>Loading your history…/);
    expect(list()).not.toContain(t("en", "shell.loadMore"));
  });

  it("speaks Turkish", () => {
    const html = list({ lang: "tr", signIn: true });
    expect(html).toContain(t("tr", "shell.today"));
    expect(html).toContain(t("tr", "history.state.waiting", { name: "Deniz" }));
    expect(html).toContain(t("tr", "shell.localSignIn"));
  });
});

describe("TabBar", () => {
  it("has the native app's three tabs and marks the open one", () => {
    const html = tabs();
    expect(html).toContain(`aria-label="${t("en", "nav.tabs")}"`);
    for (const href of ["/", "/verdicts", "/account"]) expect(html).toContain(`href="${href}"`);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/<a aria-current="page" href="\/">/);
    expect(tabs({ pathname: "/verdicts" })).toMatch(/<a aria-current="page" href="\/verdicts">/);
    expect(tabs({ pathname: "/account" })).toMatch(/<a aria-current="page" href="\/account">/);
    expect(tabs({ pathname: "/v/abc" })).not.toContain("aria-current");
  });

  it("signed out: sign in instead of the account, back to this page", () => {
    const html = tabs({ pathname: "/v/abc", account: "signin" });
    expect(html).toContain(`href="/signin?next=${encodeURIComponent("/v/abc")}"`);
    expect(html).toContain(`>${t("en", "nav.signIn")}</a>`);
    expect(html).not.toContain('href="/account"');
  });

  it("leaves the account tab out when no sign-in is offered", () => {
    const html = tabs({ account: "none" });
    expect(html).toContain('href="/verdicts"');
    expect(html).not.toContain('href="/account"');
    expect(html).not.toContain("/signin");
  });

  it("speaks Turkish", () => {
    const html = tabs({ lang: "tr" });
    for (const k of ["nav.new", "nav.verdicts", "nav.account"] as const) expect(html).toContain(`>${t("tr", k)}</a>`);
  });
});
