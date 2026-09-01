import { describe, expect, it } from "vitest";
import cases from "./arguments.json";
import { DisputeType, FinalVerdict } from "../lib/types";

describe("labeled test set", () => {
  it("has at least 30 well-formed cases with valid labels", () => {
    expect(cases.length).toBeGreaterThanOrEqual(30);
    const ids = new Set<string>();
    for (const c of cases) {
      expect(ids.has(c.id), `duplicate id ${c.id}`).toBe(false);
      ids.add(c.id);
      expect(c.argument.length).toBeGreaterThanOrEqual(20);
      expect(c.argument.length).toBeLessThanOrEqual(6000);
      for (const t of c.expected.dispute_type) {
        expect(DisputeType.safeParse(t).success, `case ${c.id} bad dispute_type ${t}`).toBe(true);
      }
      expect(c.expected.verdict_one_of.length).toBeGreaterThan(0);
      for (const v of c.expected.verdict_one_of) {
        expect(FinalVerdict.safeParse(v).success, `case ${c.id} bad verdict ${v}`).toBe(true);
      }
    }
  });
});
