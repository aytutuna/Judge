import { afterEach, describe, expect, it } from "vitest";
import type { WorkerEnv } from "../cloudflare/env";
import { appendRemovalLog, pruneRemovalLog, readRemovalBucket, RETENTION_MS } from "../lib/originals/removal-log";
import { setWorkerEnv } from "../lib/worker-env";

/** An R2 bucket in memory: put, get, list and delete, keys in order. */
function fakeBucket() {
  const objects = new Map<string, string>();
  return {
    objects,
    put: async (key: string, value: string) => void objects.set(key, value),
    get: async (key: string) => (objects.has(key) ? { text: async () => objects.get(key)! } : null),
    delete: async (keys: string | string[]) => void [keys].flat().forEach((k) => objects.delete(k)),
    list: async ({ prefix, cursor, startAfter }: { prefix: string; cursor?: string; startAfter?: string }) => {
      const keys = [...objects.keys()].filter((k) => k.startsWith(prefix) && (!startAfter || k > startAfter)).sort();
      const from = cursor ? keys.findIndex((k) => k > cursor) : 0;
      const page = from < 0 ? [] : keys.slice(from, from + 100);
      return { objects: page.map((key) => ({ key })), truncated: from >= 0 && from + 100 < keys.length, cursor: page[page.length - 1] };
    },
  };
}

afterEach(() => setWorkerEnv(undefined as unknown as WorkerEnv));

describe("removal log in R2", () => {
  it("keeps one object per entry and reads them back in time order", async () => {
    const bucket = fakeBucket();
    setWorkerEnv({ BACKUPS: bucket } as unknown as WorkerEnv);
    await appendRemovalLog({ v: 1, at: "2026-11-02T00:00:00.000Z", kind: "verdict", id: "later", reason: "owner" });
    await appendRemovalLog({ v: 1, at: "2026-11-01T00:00:00.000Z", kind: "verdict", id: "earlier", reason: "owner" });
    expect(bucket.objects.size).toBe(2);
    const log = await readRemovalBucket();
    expect(log.skipped).toBe(0);
    expect(log.entries.map((e) => e.id)).toEqual(["earlier", "later"]);
  });

  it("drops entries past the retention and keeps the rest", async () => {
    const bucket = fakeBucket();
    setWorkerEnv({ BACKUPS: bucket } as unknown as WorkerEnv);
    const now = new Date("2027-03-01T00:00:00.000Z");
    const old = new Date(now.getTime() - RETENTION_MS - 86_400_000).toISOString();
    const fresh = new Date(now.getTime() - 86_400_000).toISOString();
    await appendRemovalLog({ v: 1, at: old, kind: "verdict", id: "old", reason: "owner" });
    await appendRemovalLog({ v: 1, at: fresh, kind: "verdict", id: "fresh", reason: "owner" });
    expect(await pruneRemovalLog(now)).toBe(1);
    expect((await readRemovalBucket()).entries.map((e) => e.id)).toEqual(["fresh"]);
  });

  it("reads 250 entries in pages of 60, each page continuing where the last stopped", async () => {
    const bucket = fakeBucket();
    setWorkerEnv({ BACKUPS: bucket } as unknown as WorkerEnv);
    const day = (i: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString();
    for (let i = 0; i < 250; i++) await appendRemovalLog({ v: 1, at: day(i), kind: "verdict", id: `id${String(i).padStart(3, "0")}`, reason: "owner" });
    const seen: string[] = [];
    let after: string | undefined;
    let calls = 0;
    do {
      const page = await readRemovalBucket({ after, limit: 60 });
      seen.push(...page.entries.map((e) => e.id));
      after = page.next ?? undefined;
      calls += 1;
    } while (after);
    expect(calls).toBe(5);
    expect(seen).toHaveLength(250);
    expect(seen).toEqual([...seen].sort());
    expect(new Set(seen).size).toBe(250);
  });
});
