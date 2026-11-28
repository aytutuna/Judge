import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { currentSchema } from "../scripts/d1-schema";

describe("D1 migrations", () => {
  it("0001_schema.sql is what the ensure code makes (run scripts/d1-schema.ts)", async () => {
    const file = readFileSync(new URL("../migrations/0001_schema.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    expect(file).toBe(await currentSchema());
  }, 30_000);
});
