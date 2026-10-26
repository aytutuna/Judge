import { afterEach, describe, expect, it, vi } from "vitest";
import { mergeFirstPage, mergeHistory, settleHistory } from "../components/shell/useHistory";
import {
  HISTORY_KEY,
  HISTORY_MAX,
  SEED_KEY,
  SEED_TURN_KEY,
  addHistory,
  dropHistory,
  loadHistory,
  markHistoryRemoved,
  parseHistory,
  seedQueue,
  startHistory,
  type HistoryEntry,
} from "../lib/history-store";
import type { CaseSummary } from "../lib/case-types";
import type { OwnerVerdictSummary } from "../lib/originals-types";

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
});

const verdict = (id: string, createdAt: string, over: Partial<OwnerVerdictSummary> = {}): OwnerVerdictSummary => ({
  id,
  kind: "free",
  createdAt,
  verdict: "side_b",
  headline: `Headline ${id}`,
  nameMap: [],
  removed: false,
  ...over,
});

const kase = (id: string, createdAt: string): CaseSummary => ({
  id,
  status: "awaiting_respondent",
  mode: null,
  createdAt,
  expiresAt: "2026-12-01T00:00:00.000Z",
  respondentAnswered: false,
  verdict: null,
  headline: null,
  excerpt: "Party A says the dishes",
  removed: false,
});

describe("mergeHistory", () => {
  it("lists the account's verdicts and cases with local entries the server lacks, newest first", () => {
    const items = mergeHistory(
      {
        verdicts: [verdict("v3", "2026-10-22T10:00:00.000Z"), verdict("v1", "2026-10-20T10:00:00.000Z")],
        cases: [kase("c1", "2026-10-21T10:00:00.000Z")],
        nextVerdicts: null,
        nextCases: null,
      },
      [entry("v3", "2026-10-22T10:00:01.000Z", "Local copy"), entry("v2", "2026-10-19T10:00:00.000Z")],
    );
    expect(items.map((i) => `${i.kind}:${i.id}`)).toEqual(["verdict:v3", "case:c1", "verdict:v1", "verdict:v2"]);
    expect(items[0].title).toBe("Headline v3");
    expect(items[1]).toMatchObject({ status: "awaiting_respondent", title: "Party A says the dishes" });
  });

  it("holds back what is older than the later cursor until the next page arrives", () => {
    const items = mergeHistory(
      {
        verdicts: [verdict("v2", "2026-10-22T10:00:00.000Z"), verdict("v1", "2026-10-10T10:00:00.000Z")],
        cases: [kase("c1", "2026-10-21T10:00:00.000Z")],
        nextVerdicts: "2026-10-10T10:00:00.000Z",
        nextCases: "2026-10-21T10:00:00.000Z",
      },
      [entry("v0", "2026-10-01T10:00:00.000Z")],
    );
    expect(items.map((i) => i.id)).toEqual(["v2", "c1"]);
  });

  it("takes a reloaded first page as the truth down to its last row", () => {
    const old = {
      rows: [
        verdict("v4", "2026-10-22T10:00:00.000Z"),
        verdict("v3", "2026-10-20T10:00:00.000Z"),
        verdict("v2", "2026-10-12T10:00:00.000Z", { headline: "Stale" }),
        verdict("v1", "2026-10-02T10:00:00.000Z"),
      ],
      next: "2026-10-02T10:00:00.000Z",
    };
    // v3 was removed from the first page's range; older pages stay loaded.
    const fresh = {
      rows: [
        verdict("v5", "2026-10-23T10:00:00.000Z"),
        verdict("v4", "2026-10-22T10:00:00.000Z"),
        verdict("v2", "2026-10-12T10:00:00.000Z"),
      ],
      next: "2026-10-12T10:00:00.000Z",
    };
    const merged = mergeFirstPage(fresh, old);
    expect(merged.rows.map((v) => v.id)).toEqual(["v5", "v4", "v2", "v1"]);
    expect(merged.rows[2].headline).toBe("Headline v2");
    expect(merged.next).toBe(old.next);
    expect(mergeFirstPage({ rows: fresh.rows, next: null }, old)).toEqual({ rows: fresh.rows, next: null });
    expect(mergeFirstPage(fresh, { rows: old.rows, next: null }).next).toBeNull();
    expect(mergeFirstPage(fresh, null)).toBe(fresh);
  });

  it("works signed out from the local index alone", () => {
    const items = mergeHistory(null, [{ ...entry("v1", "2026-10-20T10:00:00.000Z", null), removed: true }]);
    expect(items).toEqual([
      { kind: "verdict", id: "v1", createdAt: "2026-10-20T10:00:00.000Z", title: null, status: null, removed: true, pending: false },
    ]);
  });
});
