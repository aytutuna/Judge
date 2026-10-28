import { afterEach, describe, expect, it, vi } from "vitest";
import { mergeFirstPage, mergeHistory, rememberAnswered, settleHistory } from "../components/shell/useHistory";
import {
  ANSWERED_KEY,
  HISTORY_KEY,
  HISTORY_MAX,
  SEED_KEY,
  SEED_TURN_KEY,
  addAnswered,
  addHistory,
  dropHistory,
  loadAnswered,
  loadHistory,
  markHistoryRemoved,
  parseAnswered,
  parseHistory,
  seedQueue,
  startHistory,
  type HistoryEntry,
} from "../lib/history-store";
import type { CaseView } from "../lib/case-types";
import type { HistoryRow } from "../lib/history-types";

function fakeStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k: string) => data.get(k) ?? null,
    key: (i: number) => [...data.keys()][i] ?? null,
    removeItem: (k: string) => void data.delete(k),
    setItem: (k: string, v: string) => void data.set(k, String(v)),
  };
}

const entry = (id: string, createdAt: string, headline: string | null = `About ${id}`): HistoryEntry => ({
  id,
  createdAt,
  headline,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("history index", () => {
  it("drops malformed entries and unreadable values", () => {
    expect(parseHistory(null)).toEqual([]);
    expect(parseHistory("{")).toEqual([]);
    expect(parseHistory(JSON.stringify({ id: "x" }))).toEqual([]);
    const good = entry("v1", "2026-10-20T10:00:00.000Z");
    const parsed = parseHistory(
      JSON.stringify([good, { id: "v2", createdAt: "not a date", headline: null }, { id: 3 }]),
    );
    expect(parsed).toEqual([good]);
  });

  it("lists verdicts newest first, replaces a repeated id and keeps at most 50", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    for (let i = 0; i < HISTORY_MAX + 5; i++) addHistory(entry(`v${i}`, new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString()));
    let list = loadHistory();
    expect(list).toHaveLength(HISTORY_MAX);
    expect(list[0].id).toBe(`v${HISTORY_MAX + 4}`);
    expect(list.at(-1)?.id).toBe("v5");

    addHistory(entry("v20", "2026-02-01T00:00:00.000Z", "Again"));
    list = loadHistory();
    expect(list).toHaveLength(HISTORY_MAX);
    expect(list[0]).toMatchObject({ id: "v20", headline: "Again" });
    expect(list.filter((e) => e.id === "v20")).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]")[0].id).toBe("v20");
  });

  it("keeps a removed verdict, muted and without its headline", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    addHistory(entry("v1", "2026-10-20T10:00:00.000Z", "Ada is right"));
    markHistoryRemoved("v1");
    markHistoryRemoved("unknown");
    expect(loadHistory()).toEqual([{ id: "v1", createdAt: "2026-10-20T10:00:00.000Z", headline: null, removed: true }]);
  });

  it("still lists this page view's verdicts when storage is blocked", () => {
    const blocked = fakeStorage();
    blocked.getItem = () => {
      throw new Error("blocked");
    };
    blocked.setItem = () => {
      throw new Error("blocked");
    };
    vi.stubGlobal("localStorage", blocked);
    addHistory(entry("v9", "2026-10-21T10:00:00.000Z"));
    expect(loadHistory().map((e) => e.id)).toContain("v9");
  });

  it("keeps a new verdict listed when storage is full but still readable", () => {
    const full = fakeStorage();
    full.setItem(HISTORY_KEY, JSON.stringify([entry("v1", "2026-10-20T10:00:00.000Z")]));
    full.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    vi.stubGlobal("localStorage", full);
    addHistory(entry("v2", "2026-10-21T10:00:00.000Z"));
    expect(loadHistory().map((e) => e.id)).toEqual(["v2", "v1"]);
    expect(loadHistory().map((e) => e.id)).toEqual(["v2", "v1"]);
  });

  it("drops a verdict that failed after it was indexed", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    addHistory(entry("v1", "2026-10-20T10:00:00.000Z"));
    addHistory({ id: "v2", createdAt: "2026-10-21T10:00:00.000Z", headline: null, pending: true });
    dropHistory("v2");
    dropHistory("unknown");
    expect(loadHistory().map((e) => e.id)).toEqual(["v1"]);
  });

  it("fills in a verdict that was still judging in its own place", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    addHistory({ id: "v2", createdAt: "2026-10-21T10:00:05.000Z", headline: null, pending: true });
    addHistory(entry("v3", "2026-10-22T10:00:00.000Z"));
    addHistory(entry("v2", "2026-10-21T10:00:00.000Z", "Ada is right"));
    expect(loadHistory()).toEqual([entry("v3", "2026-10-22T10:00:00.000Z"), entry("v2", "2026-10-21T10:00:00.000Z", "Ada is right")]);
  });

  it("queues the verdicts written before the index once per browser", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    startHistory(["v1", "v2"]);
    startHistory(["v3"]);
    expect(seedQueue()).toEqual(["v1", "v2"]);
    expect(localStorage.getItem(HISTORY_KEY)).toBe("[]");
  });
});

describe("settleHistory", () => {
  const json = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });

  it("looks up queued and judging entries one at a time and stops when throttled", async () => {
    const storage = fakeStorage();
    storage.setItem(SEED_KEY, JSON.stringify(["old1", "old2", "old3"]));
    storage.setItem(
      HISTORY_KEY,
      JSON.stringify([
        { id: "gone", createdAt: "2026-10-22T10:00:00.000Z", headline: null, pending: true },
        { id: "busy", createdAt: "2026-10-21T10:00:00.000Z", headline: null, pending: true },
      ]),
    );
    storage.setItem("judge.owner.old1", "t".repeat(43));
    vi.stubGlobal("localStorage", storage);
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        if (url === "/api/v1/verdicts/gone") return json(200, { id: "gone", status: "failed", code: "unavailable" });
        if (url === "/api/v1/verdicts/busy") return json(200, { id: "busy", status: "judging", pollAfterMs: 2000 });
        if (url === "/api/v1/verdicts/old1") return json(200, { id: "old1", status: "ready" });
        if (url === "/api/v1/verdicts/old1/mine") {
          return json(200, {
            id: "old1",
            createdAt: "2026-09-01T10:00:00.000Z",
            result: { headline: "A is right" },
            nameMap: [],
            removed: null,
          });
        }
        return json(429);
      }),
    );
    await settleHistory();
    expect(calls).toEqual([
      "/api/v1/verdicts/gone",
      "/api/v1/verdicts/busy",
      "/api/v1/verdicts/old1",
      "/api/v1/verdicts/old1/mine",
      "/api/v1/verdicts/old2",
    ]);
    expect(loadHistory()).toEqual([
      { id: "busy", createdAt: "2026-10-21T10:00:00.000Z", headline: null, pending: true },
      { id: "old1", createdAt: "2026-09-01T10:00:00.000Z", headline: "A is right" },
    ]);
    expect(seedQueue()).toEqual(["old2", "old3"]);
  });

  it("leaves the queue to the tab that took it in the last ten minutes, judging entries aside", async () => {
    const storage = fakeStorage();
    storage.setItem(SEED_KEY, JSON.stringify(["old1"]));
    storage.setItem(HISTORY_KEY, JSON.stringify([{ id: "busy", createdAt: "2026-10-21T10:00:00.000Z", headline: null, pending: true }]));
    storage.setItem(SEED_TURN_KEY, String(Date.now() - 60_000));
    vi.stubGlobal("localStorage", storage);
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        return json(200, { id: "busy", status: "judging", pollAfterMs: 2000 });
      }),
    );
    await settleHistory();
    expect(calls).toEqual(["/api/v1/verdicts/busy"]);
    expect(seedQueue()).toEqual(["old1"]);

    storage.setItem(SEED_TURN_KEY, String(Date.now() - 11 * 60_000));
    calls.length = 0;
    await settleHistory();
    expect(calls).toEqual(["/api/v1/verdicts/busy", "/api/v1/verdicts/old1"]);
    expect(Date.now() - Number(storage.getItem(SEED_TURN_KEY))).toBeLessThan(60_000);
  });

  it("looks again at a case it answered that was still being judged", async () => {
    const storage = fakeStorage();
    storage.setItem(ANSWERED_KEY, JSON.stringify([answeredRow("c1", "2026-10-21T10:00:00.000Z", { state: "judging" })]));
    storage.setItem(HISTORY_KEY, "[]");
    storage.setItem("settle.claim.c1", CLAIM);
    vi.stubGlobal("localStorage", storage);
    const calls: { url: string; claim: string | null }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, claim: new Headers(init?.headers).get("respondent-claim") });
        return json(200, { case: view({ id: "c1", status: "judged", verdicts: [verdictView("side_b", "Party B paid")] }) });
      }),
    );
    await settleHistory();
    expect(calls).toEqual([{ url: `/api/v1/respond/${TOKEN}`, claim: CLAIM }]);
    expect(loadAnswered()[0]).toMatchObject({ id: "c1", state: "ready", verdict: "side_b", headline: "Party B paid" });
  });
});

const TOKEN = "T".repeat(22);
const CLAIM = "C".repeat(22);

const row = (id: string, at: string, over: Partial<HistoryRow> = {}): HistoryRow => ({
  kind: "verdict",
  id,
  role: "owner",
  party: "a",
  at,
  createdAt: at,
  state: "ready",
  yourMove: false,
  verdict: "side_b",
  contextAdded: false,
  contextBy: null,
  headline: `Headline ${id}`,
  excerpt: null,
  nameMap: [],
  expiresAt: null,
  removed: false,
  removable: true,
  inviteToken: null,
  ...over,
});

const answeredRow = (id: string, at: string, over: Partial<HistoryRow> = {}) =>
  row(id, at, { kind: "case", role: "respondent", party: "b", inviteToken: TOKEN, headline: null, verdict: null, ...over });

function view(over: Partial<CaseView>): CaseView {
  return {
    id: "c1",
    role: "respondent",
    yourParty: "b",
    status: "judging",
    mode: "two_sided",
    tier: "premium",
    lang: "en",
    createdAt: "2026-10-20T10:00:00.000Z",
    expiresAt: "2026-10-27T10:00:00.000Z",
    judgedAt: null,
    respondentAnswered: true,
    inviteUrl: null,
    ownInvite: false,
    sides: [],
    verdicts: [],
    appeals: [],
    canJudgeNow: false,
    appeal: { allowed: false, blockedBy: "not_judged" },
    lastError: null,
    pollAfterMs: null,
    names: null,
    display: { namesVisible: true, a: null, b: null },
    removed: null,
    yourOriginal: "stored",
    inAccount: false,
    ...over,
  };
}

const verdictView = (verdict: "side_a" | "side_b", headline: string) =>
  ({ seq: 1, id: "v1", appealId: null, createdAt: "2026-10-21T10:05:00.000Z", result: { verdict, headline } }) as CaseView["verdicts"][number];

describe("cases answered signed out", () => {
  it("are kept apart from the verdicts, newest first, at most 50, malformed ones dropped", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    for (let i = 0; i < HISTORY_MAX; i++) addHistory(entry(`v${i}`, new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString()));
    for (let i = 0; i < HISTORY_MAX + 3; i++) addAnswered(answeredRow(`c${i}`, new Date(Date.UTC(2026, 1, 1, 0, i)).toISOString()));
    expect(loadHistory()).toHaveLength(HISTORY_MAX);
    expect(loadAnswered()).toHaveLength(HISTORY_MAX);
    expect(loadAnswered()[0].id).toBe(`c${HISTORY_MAX + 2}`);
    // Older tabs read only judge.history, so they never see a case there.
    expect(JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]").every((e: { id: string }) => e.id.startsWith("v"))).toBe(true);

    const good = answeredRow("c1", "2026-10-20T10:00:00.000Z");
    expect(parseAnswered(JSON.stringify([good, { ...good, id: "c2", inviteToken: "short" }, { ...good, id: "c3", kind: "verdict" }, 7]))).toEqual([good]);
    expect(parseAnswered("{")).toEqual([]);
  });

  it("are listed from the page they were answered on, keeping when they were answered", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    const names = [{ original: "I", replacement: "Party B" }];
    rememberAnswered(view({}), TOKEN, names);
    const first = loadAnswered()[0];
    expect(first).toMatchObject({ id: "c1", role: "respondent", party: "b", state: "judging", inviteToken: TOKEN, nameMap: names });
    rememberAnswered(view({ status: "judged", verdicts: [verdictView("side_a", "Party A paid")] }), TOKEN, []);
    expect(loadAnswered()).toHaveLength(1);
    expect(loadAnswered()[0]).toMatchObject({ state: "ready", verdict: "side_a", at: first.at, nameMap: names });
    // The owner's own invite, or an invite not answered, is not listed.
    rememberAnswered(view({ id: "c2", ownInvite: true }), TOKEN, []);
    rememberAnswered(view({ id: "c3", respondentAnswered: false }), TOKEN, []);
    expect(loadAnswered().map((r) => r.id)).toEqual(["c1"]);
  });
});

describe("mergeHistory", () => {
  it("lists the account's rows with local entries the server lacks, newest first", () => {
    const items = mergeHistory(
      {
        rows: [row("v3", "2026-10-22T10:00:00.000Z"), row("c1", "2026-10-21T10:00:00.000Z", { kind: "case" }), row("v1", "2026-10-20T10:00:00.000Z")],
        next: null,
      },
      [entry("v3", "2026-10-22T10:00:01.000Z", "Local copy"), entry("v2", "2026-10-19T10:00:00.000Z")],
      [answeredRow("c1", "2026-10-21T11:00:00.000Z"), answeredRow("c9", "2026-10-23T10:00:00.000Z")],
    );
    expect(items.map((i) => `${i.kind}:${i.id}`)).toEqual(["case:c9", "verdict:v3", "case:c1", "verdict:v1", "verdict:v2"]);
    expect(items[1].title).toBe("Headline v3");
    expect(items[2].role).toBe("owner");
  });

  it("holds back local entries older than the last row loaded until the next page arrives", () => {
    const items = mergeHistory(
      { rows: [row("v2", "2026-10-22T10:00:00.000Z"), row("c1", "2026-10-21T10:00:00.000Z", { kind: "case" })], next: "cursor" },
      [entry("v0", "2026-10-01T10:00:00.000Z"), entry("v5", "2026-10-21T12:00:00.000Z")],
      [answeredRow("c0", "2026-10-02T10:00:00.000Z")],
    );
    expect(items.map((i) => i.id)).toEqual(["v2", "v5", "c1"]);
  });

  it("works signed out from this browser's lists alone", () => {
    const items = mergeHistory(null, [{ ...entry("v1", "2026-10-20T10:00:00.000Z", null), removed: true }, { ...entry("v2", "2026-10-21T10:00:00.000Z", null), pending: true }]);
    expect(items.map((i) => [i.id, i.state, i.href])).toEqual([
      ["v2", "judging", null],
      ["v1", "removed", null],
    ]);
  });
});

describe("mergeFirstPage", () => {
  it("takes a reloaded first page as the truth down to its last row", () => {
    const old = {
      rows: [
        row("v4", "2026-10-22T10:00:00.000Z"),
        row("v3", "2026-10-20T10:00:00.000Z"),
        row("v2", "2026-10-12T10:00:00.000Z", { headline: "Stale" }),
        row("v1", "2026-10-02T10:00:00.000Z"),
      ],
      next: "old-cursor",
    };
    // v3 was removed from the first page's range; older pages stay loaded.
    const fresh = {
      rows: [row("v5", "2026-10-23T10:00:00.000Z"), row("v4", "2026-10-22T10:00:00.000Z"), row("v2", "2026-10-12T10:00:00.000Z")],
      next: "fresh-cursor",
    };
    const merged = mergeFirstPage(fresh, old);
    expect(merged.rows.map((v) => v.id)).toEqual(["v5", "v4", "v2", "v1"]);
    expect(merged.rows[2].headline).toBe("Headline v2");
    expect(merged.next).toBe("old-cursor");
    expect(mergeFirstPage({ rows: fresh.rows, next: null }, old)).toEqual({ rows: fresh.rows, next: null });
    expect(mergeFirstPage(fresh, { rows: old.rows, next: null }).next).toBeNull();
    expect(mergeFirstPage(fresh, { rows: old.rows.slice(0, 2), next: "short" }).next).toBe("fresh-cursor");
    expect(mergeFirstPage(fresh, null)).toBe(fresh);
  });

  it("tells rows with the same time apart by key", () => {
    const same = "2026-10-20T10:00:00.000Z";
    const old = { rows: [row("b", same), row("a", same)], next: "x" };
    const fresh = { rows: [row("c", same), row("b", same)], next: "y" };
    expect(mergeFirstPage(fresh, old).rows.map((r) => r.id)).toEqual(["c", "b", "a"]);
  });
});

