import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { stateLabel, titleOf } from "../components/shell/history-labels";
import { Panel, SideMenu } from "../components/shell/SideMenu";
import { fromRow, mergeHistory, type HistoryItem } from "../components/shell/useHistory";
import type { HistoryRow } from "../lib/history-types";
import { t } from "../lib/i18n";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;");

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
const mocked = vi.hoisted(() => ({ history: null as unknown, viewer: null as unknown }));
vi.mock("../lib/use-viewer", async (orig) => {
  const actual = await orig<typeof import("../lib/use-viewer")>();
  return { ...actual, useViewer: () => mocked.viewer ?? actual.useViewer() };
});
vi.mock("../components/shell/useHistory", async (orig) => {
  const actual = await orig<typeof import("../components/shell/useHistory")>();
  return { ...actual, useHistory: (...a: Parameters<typeof actual.useHistory>) => mocked.history ?? actual.useHistory(...a) };
});

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

function menu(over: Partial<ComponentProps<typeof Panel>> = {}): string {
  return renderToStaticMarkup(<Panel lang="en" pathname="/" onClosed={() => {}} {...over} />);
}

const label = (over: Partial<HistoryRow> & { id: string }) => stateLabel("en", fromRow(row(over)));

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

function listed(history: Record<string, unknown> = {}, over: Partial<ComponentProps<typeof Panel>> = {}): string {
  mocked.history = { items: ITEMS, status: "ready", more: false, loadingMore: false, loadMore: () => {}, ...history };
  try {
    return menu(over);
  } finally {
    mocked.history = null;
  }
}

describe("the menu's lists", () => {
  it("splits verdicts and links under their headings, Verdicts first", () => {
    const html = listed();
    const verdicts = html.indexOf(`>${t("en", "nav.verdicts")}</h2>`);
    const links = html.indexOf(`>${t("en", "nav.links")}</h2>`);
    expect(verdicts).toBeGreaterThan(0);
    expect(links).toBeGreaterThan(verdicts);
    expect(html.indexOf('href="/v/today1"')).toBeLessThan(links);
    expect(html.indexOf('href="/c/case1"')).toBeGreaterThan(links);
    expect(html).not.toContain('href="/verdicts"');
  });

  it("hides a section with no items", () => {
    const verdictsOnly = listed({ items: ITEMS.filter((i) => i.kind === "verdict") });
    expect(verdictsOnly).toContain(`>${t("en", "nav.verdicts")}</h2>`);
    expect(verdictsOnly).not.toContain(`>${t("en", "nav.links")}</h2>`);
    const linksOnly = listed({ items: ITEMS.filter((i) => i.kind === "case") });
    expect(linksOnly).not.toContain(`>${t("en", "nav.verdicts")}</h2>`);
    expect(linksOnly).toContain(`>${t("en", "nav.links")}</h2>`);
  });

  it("links verdicts and cases, each with its state, names put back", () => {
    const html = listed();
    expect(html).toContain('href="/v/today1"');
    expect(html).toContain('href="/c/case1"');
    expect(html).toContain("Waiting for Deniz to answer");
    expect(html).toContain("Deniz says the bike was theirs");
    expect(html).toContain(t("en", "verdict.split"));
    // An untitled case falls back to its date.
    expect(html).toContain(esc(t("en", "case.list.untitled", { date: "October 17" })));
  });

  it("does not link a verdict still being judged, or one that was removed", () => {
    const html = listed();
    expect(html).not.toContain('href="/v/old1"');
    expect(html).toContain("Judges thinking");
    expect(html).not.toContain('href="/v/gone"');
  });

  it("mutes removed items; a removed verdict says so once", () => {
    const html = listed();
    expect(html).toMatch(/<span class="[^"]*" data-removed="">/);
    expect(html).toMatch(/<a [^>]*data-removed=""[^>]*href="\/c\/gonecase"/);
    expect(html).toContain("Removed by Deniz");
    expect(html.split(">Removed<").length - 1).toBe(1);
  });

  it("opens a case you answered on its invite page, and does not link one whose invite is closed", () => {
    const rows = [
      row({ id: "ans", kind: "case", role: "respondent", party: "b", nameMap: RESPONDENT_MAP, inviteToken: TOKEN, verdict: "side_b" }),
      row({ id: "dead", kind: "case", role: "respondent", party: "b", inviteToken: null, at: at(0, 7) }),
      row({ id: "retry", kind: "case", state: "failed", yourMove: true, verdict: null, at: at(0, 6) }),
    ];
    const html = listed({ items: rows.map(fromRow) });
    expect(html).toContain(`href="/r/${TOKEN}"`);
    expect(html).not.toContain("/c/ans");
    expect(html).not.toContain("/c/dead");
    expect(html).toContain('data-tone="yours"');
    expect(html).toContain('href="/c/retry"');
  });

  it("holds the account's rows and this browser's own in one list", () => {
    const answered = row({ id: "mine", kind: "case", role: "respondent", party: "b", at: at(0, 12), inviteToken: TOKEN });
    const items = mergeHistory({ rows: ROWS, next: null }, [{ id: "local", createdAt: at(0, 10), headline: "Local one" }], [answered]);
    expect(items.map((i) => i.id)).toEqual(["mine", "today1", "local", "case1", "week1", "week2", "old1", "gone", "gonecase"]);
  });

  it("signed out: says the list is this browser's, with a sign-in link back to the page", () => {
    mocked.viewer = { status: "ready", me: { user: null }, config: { signIn: { apple: false, google: true, email: false, dev: false } } };
    try {
      const html = listed({}, { pathname: "/v/abc" });
      expect(html).toContain(t("en", "shell.local"));
      expect(html).toContain(`href="/signin?next=${encodeURIComponent("/v/abc")}"`);
      expect(html).toContain('href="/v/today1"');
    } finally {
      mocked.viewer = null;
    }
    expect(listed()).not.toContain(t("en", "shell.local"));
  });

  it("says when there is nothing yet, or that it is still loading", () => {
    const empty = listed({ items: [] });
    expect(empty).toContain(t("en", "shell.empty"));
    expect(empty).not.toContain("<section");
    expect(listed({ items: [], status: "loading" })).toMatch(/role="status"[^>]*>Loading your history…/);
    expect(listed({ items: [], status: "error" })).toContain(esc(t("en", "shell.loadFailed")));
  });

  it("keeps the rows and offers a retry when a refresh failed", () => {
    const html = listed({ status: "error" });
    expect(html).toContain("<section");
    expect(html).toContain(esc(t("en", "shell.loadFailed")));
    expect(html).toContain(t("en", "case.retry"));
  });

  it("offers more at the end while a cursor is left, disabled while it loads", () => {
    const more = listed({ more: true });
    expect(more).toContain(t("en", "shell.loadMore"));
    expect(more.indexOf(t("en", "shell.loadMore"))).toBeGreaterThan(more.indexOf('href="/c/case1"'));
    expect(listed({ more: true, loadingMore: true })).toMatch(/<button[^>]*disabled=""[^>]*>Loading your history…/);
    expect(listed()).not.toContain(t("en", "shell.loadMore"));
  });

  it("speaks Turkish", () => {
    const html = listed({}, { lang: "tr" });
    expect(html).toContain(`>${t("tr", "nav.links")}</h2>`);
    expect(html).toContain(t("tr", "history.state.waiting", { name: "Deniz" }));
  });
});

describe("SideMenu", () => {
  it("renders only its button until opened", () => {
    const html = renderToStaticMarkup(<SideMenu lang="en" pathname="/" />);
    expect(html).toContain(`aria-label="${t("en", "nav.tabs")}"`);
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("<dialog");
  });

  it("lists New and Settings and marks the open page", () => {
    const html = menu();
    expect(html).toContain(`aria-label="${t("en", "nav.tabs")}"`);
    for (const href of ["/", "/settings"]) expect(html).toContain(`href="${href}"`);
    expect(html).not.toContain('href="/verdicts"');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="page" href="\/"/);
    expect(menu({ pathname: "/settings" })).toMatch(/aria-current="page" href="\/settings"/);
    expect(menu({ pathname: "/v/abc" })).not.toContain("aria-current");
  });

  it("closes with the scrim, labelled Cancel", () => {
    expect(menu()).toContain(`aria-label="${t("en", "case.cancel")}"`);
  });

  it("lists every item, not just the newest few, with the profile after the lists", () => {
    const items = Array.from({ length: 30 }, (_, i) => fromRow(row({ id: `many${i}`, headline: `Many ${i}` })));
    const html = listed({ items });
    for (const item of items) expect(html).toContain(titleOf("en", item));
    expect(html.indexOf("Many 29")).toBeLessThan(html.indexOf("aria-controls="));
  });

  it("speaks Turkish", () => {
    const html = menu({ lang: "tr" });
    for (const k of ["nav.new", "nav.settings"] as const) expect(html).toContain(`>${t("tr", k)}</a>`);
  });

  it("puts the profile above Settings, with Pricing and Sign in behind it", () => {
    const html = menu();
    const profile = html.indexOf('aria-controls=');
    expect(profile).toBeGreaterThan(html.indexOf('href="/"'));
    expect(html.indexOf('href="/settings"')).toBeGreaterThan(profile);
    expect(html).toContain(t("en", "nav.account"));
    expect(html).toMatch(/hidden=""[^>]*>[^]*href="\/pricing"/);
    expect(html).not.toContain(t("en", "nav.signOut"));
  });

  it("offers Sign in only where the server has a way to sign in and the page is not the sign-in page", () => {
    const viewer = { status: "ready", me: { user: null }, config: { signIn: { apple: false, google: true, email: false, dev: false } } };
    try {
      expect(menu()).not.toContain("/signin?next=");
      mocked.viewer = viewer;
      expect(menu()).toContain("/signin?next=%2F");
      expect(menu({ pathname: "/signin" })).not.toContain("/signin?next=");
      mocked.viewer = { ...viewer, config: { signIn: { apple: false, google: false, email: false, dev: false } } };
      expect(menu()).not.toContain("/signin?next=");
    } finally {
      mocked.viewer = null;
    }
  });

  it("makes each verdict its own tinted card and keeps the result in words", () => {
    const items = [
      row({ id: "w", verdict: "side_a" }),
      row({ id: "l", verdict: "side_b" }),
      row({ id: "s", verdict: "split" }),
      row({ id: "j", state: "judging", verdict: null }),
    ].map(fromRow);
    mocked.history = { items, status: "ready", more: false, loadingMore: false, loadMore: () => {} };
    try {
      const html = menu();
      expect(html.match(/data-tone="yours"/g)).toHaveLength(1);
      expect(html.match(/data-tone="theirs"/g)).toHaveLength(1);
      expect(html.match(/<(a|span) [^>]*class="_recent_/g)).toHaveLength(4);
      for (const item of items) expect(html).toContain(esc(stateLabel("en", item) ?? ""));
    } finally {
      mocked.history = null;
    }
  });
});
