import { describe, expect, it, vi } from "vitest";
import { copyDatabase } from "../scripts/d1-copy";

describe("copyDatabase", () => {
  it("fails on a missing source before it touches the target", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(copyDatabase("/no/such/old.db", "https://staging.example.test", "s".repeat(32), () => {}, true)).rejects.toThrow(/no such file/);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
