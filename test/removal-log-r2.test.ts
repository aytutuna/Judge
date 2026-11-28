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
    list: async ({ prefix }: { prefix: string }) => ({
      objects: [...objects.keys()].filter((k) => k.startsWith(prefix)).sort().map((key) => ({ key })),
      truncated: false,
    }),
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
});
