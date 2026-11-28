import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkerEnv } from "../cloudflare/env";
import { setWorkerEnv } from "../lib/worker-env";

const replayed: string[] = [];
vi.mock("../lib/originals/removal-replay", () => ({
  replayEntries: async (entries: { id: string }[]) => {
    replayed.push(...entries.map((e) => e.id));
    return { entries: entries.length, applied: entries.length, notInThisDatabase: 0, failed: 0 };
  },
}));
const { CRON_TASKS, REPLAY_PAGE, isCronTask, runCronTask } = await import("../lib/cron");

/** A bucket holding `n` removal log objects, listed in key order. */
function bucketWith(n: number) {
  const keys = Array.from({ length: n }, (_, i) => `removals/2026-01-01T00:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}.000Z-${i}.json`);
  return {
    list: async ({ cursor, startAfter }: { cursor?: string; startAfter?: string }) => {
      const rest = keys.filter((k) => (!startAfter || k > startAfter) && (!cursor || k > cursor));
      const page = rest.slice(0, 100);
      return { objects: page.map((key) => ({ key })), truncated: rest.length > 100, cursor: page[page.length - 1] };
    },
    get: async (key: string) => ({
      text: async () => JSON.stringify({ v: 1, at: key.slice(9, 33), kind: "verdict", id: `v${keys.indexOf(key)}`, reason: "owner" }),
    }),
  };
}

afterEach(() => setWorkerEnv(undefined as unknown as WorkerEnv));

describe("cron tasks", () => {
  it("replays 330 removals over several runs, each continuing from the cursor the last one gave", async () => {
    setWorkerEnv({ BACKUPS: bucketWith(330) } as unknown as WorkerEnv);
    let cursor: string | undefined;
    let runs = 0;
    do {
      const params = new URLSearchParams(cursor ? { cursor } : {});
      const res = await runCronTask("replay-removals", params);
      cursor = (res && res.next) || undefined;
      runs += 1;
    } while (cursor);
    expect(runs).toBe(Math.ceil(330 / REPLAY_PAGE));
    expect(replayed).toHaveLength(330);
    expect(new Set(replayed).size).toBe(330);
  });

  it("names the split daily tasks and refuses unknown ones", () => {
    expect(Object.keys(CRON_TASKS)).toEqual(expect.arrayContaining(["sweep", "events", "erasure", "cleanup", "backfill", "backup", "replay-removals"]));
    expect(isCronTask("daily")).toBe(false);
  });
});
