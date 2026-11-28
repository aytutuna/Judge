import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** wrangler.jsonc without its // comments. */
function config(): { observability?: unknown; env?: Record<string, { observability?: unknown }> } {
  const text = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  return JSON.parse(text.replace(/^\s*\/\/.*$/gm, ""));
}

describe("wrangler.jsonc", () => {
  it("keeps invocation logs off in every environment: they would store every URL, link tokens and IPs", () => {
    const c = config();
    const all = [c.observability, ...Object.values(c.env ?? {}).map((e) => e.observability)];
    expect(all.length).toBeGreaterThan(1);
    for (const o of all) expect(o).toEqual({ enabled: true, logs: { invocation_logs: false } });
  });
});
