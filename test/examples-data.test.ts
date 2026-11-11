import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LANG_CODES } from "@/lib/langs";
import { MAX_ARGUMENT } from "@/lib/sides";
import type { Example } from "@/lib/examples";

const dir = join(__dirname, "../lib/examples");
const read = (lang: string): Record<string, Example> => JSON.parse(readFileSync(join(dir, `${lang}.json`), "utf8"));
const en = read("en");
const ids = Object.keys(en);
const MAX_NAME = 40;
const emoji = /^\p{Extended_Pictographic}/u;

describe("example data", () => {
  it("has a file for every language and nothing else", () => {
    expect(readdirSync(dir).map((f) => f.replace(/\.json$/, "")).sort()).toEqual([...LANG_CODES].sort());
  });

  it("has 150 English examples with distinct titles and texts", () => {
    expect(ids).toHaveLength(150);
    expect(new Set(Object.values(en).map((e) => e.title)).size).toBe(150);
    expect(new Set(Object.values(en).flatMap((e) => [e.a, e.b])).size).toBe(300);
  });

  describe.each(LANG_CODES)("%s", (lang) => {
    const data = read(lang);

    it("has every id in the same order, with all five fields", () => {
      expect(Object.keys(data)).toEqual(ids);
      for (const e of Object.values(data)) {
        expect(Object.keys(e)).toEqual(["title", "aName", "a", "bName", "b"]);
        for (const v of Object.values(e)) expect(v.trim()).not.toBe("");
      }
    });

    it("has distinct titles, no slots, an emoji first, names apart and nothing over the limits", () => {
      const titles = new Set<string>();
      for (const e of Object.values(data)) {
        titles.add(e.title);
        expect(e.title).toMatch(emoji);
        expect(e.aName).not.toBe(e.bName);
        expect(e.aName.length).toBeLessThanOrEqual(MAX_NAME);
        expect(e.bName.length).toBeLessThanOrEqual(MAX_NAME);
        expect(e.a.length).toBeLessThanOrEqual(MAX_ARGUMENT);
        expect(e.b.length).toBeLessThanOrEqual(MAX_ARGUMENT);
        for (const v of Object.values(e)) expect(v).not.toMatch(/[{}]/);
      }
      expect(titles.size).toBe(ids.length);
    });
  });
});
