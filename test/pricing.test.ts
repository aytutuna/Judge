import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PRICING, STORE_PRODUCTS, formatPrice, packById } from "../lib/pricing";

describe("pricing config", () => {
  it("holds the owner's placeholder prices", () => {
    expect(PRICING.currency).toBe("USD");
    expect(PRICING.purchasesEnabled).toBe(false);
    expect(PRICING.packs).toEqual([
      { id: "pack_1", credits: 1, priceUsd: 1 },
      { id: "pack_10", credits: 10, priceUsd: 7.5 },
    ]);
    expect(PRICING.monthly).toEqual({ id: "monthly", priceUsd: 15, fairUseCap: 35, periodDays: 30 });
  });

  it("packById finds packs and nothing else", () => {
    expect(packById("pack_10")?.credits).toBe(10);
    expect(packById("monthly")).toBeUndefined();
    expect(packById("")).toBeUndefined();
  });

  it("every web product id maps to what PRICING sells", () => {
    for (const pack of PRICING.packs) expect(STORE_PRODUCTS[pack.id]).toEqual({ kind: "credits", credits: pack.credits });
    expect(STORE_PRODUCTS[PRICING.monthly.id]).toEqual({ kind: "subscription", planId: "monthly" });
    for (const [id, product] of Object.entries(STORE_PRODUCTS)) {
      // Valid product id characters in both App Store Connect and Google Play.
      expect(id).toMatch(/^[a-z0-9_]+$/);
      if (product.kind === "credits") expect(PRICING.packs.some((p) => p.credits === product.credits), id).toBe(true);
    }
  });

  it("formats prices per language", () => {
    expect(formatPrice(7.5, "en")).toBe("$7.50");
    expect(formatPrice(7.5, "tr")).toMatch(/^\$7,50$/);
    expect(formatPrice(0.166, "en")).toBe("$0.17");
  });

  it("is a pure module the mobile app can reuse (no Next, React, DOM or Node imports)", () => {
    const src = readFileSync(path.join(__dirname, "..", "lib", "pricing.ts"), "utf8");
    const imports = [...src.matchAll(/^import\s.*?from\s+"([^"]+)"/gm)].map((m) => m[1]);
    for (const spec of imports) expect(spec, spec).toMatch(/^\.\/(account-types|i18n|langs)$/);
    expect(src).not.toMatch(/\b(window|document|localStorage|process)\b/);
  });
});
