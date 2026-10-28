import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HistoryList, groupHistory } from "../components/shell/HistoryList";
import { TabBar } from "../components/shell/TabBar";
import { mergeHistory, type HistoryItem } from "../components/shell/useHistory";
import type { CaseSummary } from "../lib/case-types";
import { t } from "../lib/i18n";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;");

// Local time, so the day boundaries hold in any time zone.
const NOW = new Date(2026, 9, 23, 15, 0).getTime();
const at = (daysAgo: number, hour = 9) => new Date(2026, 9, 23 - daysAgo, hour).toISOString();

const item = (over: Partial<HistoryItem> & { id: string }): HistoryItem => ({
  kind: "verdict",
  createdAt: at(0),
  title: `Title ${over.id}`,
  status: null,
  removed: false,
  pending: false,
  ...over,
});

const ITEMS: HistoryItem[] = [
  item({ id: "today1", createdAt: at(0, 11) }),
  item({ id: "case1", kind: "case", createdAt: at(0, 8), status: "awaiting_respondent" }),
  item({ id: "week1", createdAt: at(3) }),
  item({ id: "week2", kind: "case", createdAt: at(6, 1), status: "judged", title: null }),
  item({ id: "old1", createdAt: at(7, 23) }),
  item({ id: "gone", createdAt: at(30), removed: true, title: null }),
  item({ id: "gonecase", kind: "case", createdAt: at(40), removed: true, status: "expired" }),
];

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

describe("HistoryList", () => {
  it("shows the date headings in order", () => {
    const html = list();
    const heads = ["shell.today", "shell.week", "shell.earlier"].map((k) =>
      html.indexOf(`>${t("en", k as "shell.today")}</h2>`),
    );
    expect(heads.every((i) => i > 0)).toBe(true);
    expect([...heads].sort((a, b) => a - b)).toEqual(heads);
  });

  it("links verdicts and cases, with each case's state", () => {
    const html = list();
    expect(html).toContain('href="/v/today1"');
    expect(html).toContain('href="/c/case1"');
    expect(html).toContain(t("en", "shell.case.waiting"));
    expect(html).toContain(t("en", "shell.case.judged"));
    // An untitled case falls back to its date.
    expect(html).toContain(esc(t("en", "case.list.untitled", { date: "October 17" })));
    expect(html).not.toContain("aria-current");
  });

  it("holds every case of the account in one list with the verdicts, each with its state", () => {
    const kase = (id: string, createdAt: string, over: Partial<CaseSummary>): CaseSummary => ({
      id,
      status: "awaiting_respondent",
      mode: null,
      createdAt,
      expiresAt: "2026-11-30T09:00:00.000Z",
      respondentAnswered: false,
      verdict: null,
      headline: null,
      excerpt: null,
      removed: false,
      ...over,
    });
    const cases = [
      kase("judged", at(0, 10), { status: "judged", headline: "Party B paid", verdict: "side_b" }),
      kase("waiting", at(1), { excerpt: "Party A says the bike was theirs for March" }),
      kase("judging", at(2), { status: "judging", respondentAnswered: true }),
      kase("failed", at(3), { status: "failed" }),
      kase("expired", at(9), { status: "expired" }),
      kase("closed", at(10), { status: "judged", removed: true }),
    ];
    const verdicts = [
      { id: "mine", kind: "free" as const, createdAt: at(0, 12), verdict: "side_a" as const, headline: "Party A is right", nameMap: [], removed: false },
    ];
    const items = mergeHistory({ verdicts, cases, nextVerdicts: null, nextCases: null }, []);
    expect(items.map((i) => i.id)).toEqual(["mine", "judged", "waiting", "judging", "failed", "expired", "closed"]);
    const html = list({ history: { items, status: "ready", more: false, loadingMore: false } });
    expect(html).toContain('href="/v/mine"');
    for (const c of cases) expect(html).toContain(`href="/c/${c.id}"`);
    for (const k of ["waiting", "judging", "judged", "failed", "expired"] as const) {
      expect(html).toContain(esc(t("en", `shell.case.${k}`)));
    }
    expect(html).toContain("Party B paid");
    expect(html).toContain("Party A says the bike was theirs for March");
    expect(html).toContain(esc(t("en", "case.list.untitled", { date: "October 21" })));
    expect(html).toContain(t("en", "account.verdicts.removed"));
  });

  it("lists a verdict still being judged without linking its 404ing share page", () => {
    const items = [item({ id: "busy", title: null, pending: true }), ...ITEMS];
    const html = list({ history: { items, status: "ready", more: false, loadingMore: false } });
    expect(html).not.toContain('href="/v/busy"');
    expect(html).toContain(t("en", "shell.untitled"));
    expect(html).toContain(t("en", "shell.case.judging"));
  });

  it("mutes removed items and does not link a removed verdict", () => {
    const html = list();
    expect(html).not.toContain('href="/v/gone"');
    expect(html).toMatch(/<span class="[^"]*" data-removed="">/);
    expect(html).toMatch(/<a [^>]*data-removed=""[^>]*href="\/c\/gonecase"/);
    expect(html.split(t("en", "account.verdicts.removed")).length - 1).toBe(2);
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
    expect(html).toContain(t("tr", "shell.case.waiting"));
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
