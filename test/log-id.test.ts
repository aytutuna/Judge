import { describe, expect, it } from "vitest";
import { logId } from "../lib/log-id";
import { premiumLogLine } from "../lib/premium/run";

const usage = { calls: 1, input: 2, output: 3, searches: 0, byModel: {} };
const stats = { factCheck: "off", claims: 0, escalated: false, trial: false, ms: 5 } as never;

describe("verdict ids in logs", () => {
  it("shows a short stable hash, never the id", () => {
    const id = "abcd1234efgh";
    expect(logId(id)).toMatch(/^[0-9a-f]{8}$/);
    expect(logId(id)).toBe(logId(id));
    expect(logId(id)).not.toBe(logId("abcd1234efgi"));
    const line = premiumLogLine(id, "ok", { usage, stats });
    expect(line).toContain(`id=${logId(id)}`);
    expect(line).not.toContain(id);
  });
});
