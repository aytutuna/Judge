import { describe, expect, it } from "vitest";
import cases from "./arguments.json";
import { mockVerdict } from "../lib/mock";
import { VerdictResult, DisputeType, FinalVerdict } from "../lib/types";

describe("mock verdicts", () => {
  it("conform to the VerdictResult schema for every test argument", () => {
    for (const c of cases) {
      const result = mockVerdict(c.argument, { preset: "balanced" });
      const parsed = VerdictResult.safeParse(result);
      expect(parsed.success, `case ${c.id}: ${parsed.success ? "" : parsed.error.message}`).toBe(true);
      expect(result.demo).toBe(true);
    }
  });

  it("is deterministic for the same input", () => {
    const a = mockVerdict("Should we get a dog? I say yes, my partner says no because of allergies. This matters to us.", { preset: "balanced" });
    const b = mockVerdict("Should we get a dog? I say yes, my partner says no because of allergies. This matters to us.", { preset: "balanced" });
    expect(a).toEqual(b);
  });

  it("steers value arguments to conditional verdicts", () => {
    const r = mockVerdict("Freedom or safety, which matters more? We cannot agree at all on this one.", { preset: "balanced" });
    expect(r.verdict).toBe("conditional");
    expect(r.conditional?.length).toBeGreaterThan(0);
  });
});

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
