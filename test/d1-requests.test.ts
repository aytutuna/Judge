import { afterAll, describe, expect, it } from "vitest";
import type { WorkerEnv } from "../cloudflare/env";
import { fakeD1 } from "./helpers/fake-d1";

// On Workers a write must not queue behind one from a request that was
// cancelled: that one's D1 call never answers.
const real = await fakeD1({ schema: true });
let calls = 0;
const d1 = {
  prepare: real.prepare.bind(real),
  batch: (stmts: never) => (++calls === 1 ? new Promise(() => {}) : real.batch(stmts)),
};
const { setWorkerEnv } = await import("../lib/worker-env");
setWorkerEnv({ DB: d1 } as unknown as WorkerEnv);
const { entitlementWriteBatch } = await import("../lib/entitlements");

afterAll(() => setWorkerEnv(undefined as unknown as WorkerEnv));

describe("writes on Workers", () => {
  it("a second write completes while the first one never answers", async () => {
    void entitlementWriteBatch([{ sql: "INSERT INTO welcome_claims (claim, created_at) VALUES ('a', 't')", args: [] }]);
    const second = await Promise.race([
      entitlementWriteBatch([{ sql: "INSERT INTO welcome_claims (claim, created_at) VALUES ('b', 't')", args: [] }]).then(() => "done"),
      new Promise((r) => setTimeout(() => r("stuck"), 1000)),
    ]);
    expect(second).toBe("done");
  });
});
