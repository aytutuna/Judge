import { describe, expect, it } from "vitest";
import { keepAlive, runWithContext } from "../lib/worker-env";

describe("keepAlive", () => {
  it("hands unawaited work to the request's waitUntil, also from nested async code", async () => {
    const held: Promise<unknown>[] = [];
    const work = Promise.resolve(1);
    await runWithContext({ waitUntil: (p) => void held.push(p) }, async () => {
      await new Promise((r) => setTimeout(r, 1));
      keepAlive(work);
    });
    expect(held).toEqual([work]);
  });

  it("does nothing outside a request", () => {
    expect(() => keepAlive(Promise.resolve())).not.toThrow();
  });
});
