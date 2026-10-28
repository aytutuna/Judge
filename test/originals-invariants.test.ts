import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

/** Owner rule: verdict rows (and case verdict rows) are never deleted in any
 * code path; removal blanks personal data and closes the links. */

const ROOT = path.resolve(__dirname, "..");
const PROTECTED = [
  "verdicts",
  "case_verdicts",
  "verdict_translations",
  "cases",
  "case_sides",
  "case_appeals",
  "case_people",
  "originals",
  "verdict_meta",
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe("no row deletes on verdicts, cases or originals", () => {
  it("lib/, app/, scripts/ and proxy.ts never DELETE from a protected table", () => {
    const sources = [...files(path.join(ROOT, "lib")), ...files(path.join(ROOT, "app")), ...files(path.join(ROOT, "scripts"))];
    sources.push(path.join(ROOT, "proxy.ts"));
    const offenders: string[] = [];
    const re = new RegExp(String.raw`DELETE\s+FROM\s+"?(${PROTECTED.join("|")})"?(?![A-Za-z0-9_])`, "i");
    for (const file of sources) {
      const text = readFileSync(file, "utf8");
      if (re.test(text)) offenders.push(path.relative(ROOT, file));
    }
    expect(offenders).toEqual([]);
  });
});

vi.mock("@/lib/originals/removed", () => ({
  verdictRemoved: async (id: string) => {
    if (id === "boom") throw new Error("db down");
    return id === "gone123";
  },
}));

describe("proxy.ts", () => {
  it("answers a removed verdict's page with a self-contained 410, noindex, no-store; fails closed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { proxy, config } = await import("../proxy");
    const { NextRequest } = await import("next/server");
    expect(config.matcher).toEqual(["/v/:id"]);
    const res = await proxy(new NextRequest("http://localhost/v/gone123", { headers: { "accept-language": "tr-TR,tr;q=0.9" } }));
    expect(res.status).toBe(410);
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const html = await res.text();
    expect(html).toContain('lang="tr" dir="ltr"');
    expect(html).toContain("Bu karar kaldırıldı");
    // Same pick as the share page: the first enabled language in the header.
    const second = await proxy(new NextRequest("http://localhost/v/gone123", { headers: { "accept-language": "xx-YY,tr;q=0.8" } }));
    expect(await second.text()).toContain("Sen de kendi tartışmanı çözdür");
    const live = await proxy(new NextRequest("http://localhost/v/live123"));
    expect(live.status).toBe(200);
    expect(live.headers.get("x-middleware-next")).toBe("1");
    // Fails closed: a failed check never lets a possibly removed verdict render.
    const failed = await proxy(new NextRequest("http://localhost/v/boom"));
    expect(failed.status).toBe(503);
    expect(failed.headers.get("x-middleware-next")).toBeNull();
    expect(failed.headers.get("cache-control")).toBe("no-store");
    expect(await failed.text()).toContain("can't be shown right now");
  });
});
