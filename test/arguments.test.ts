import { describe, expect, it } from "vitest";
import cases from "./arguments.json";
import { DisputeType, JudgeVerdict } from "../lib/types";

const isWinner = (v: string) => v === "side_a" || v === "side_b";

describe("labeled test set", () => {
  it("has at least 40 well-formed cases with valid labels", () => {
    expect(cases.length).toBeGreaterThanOrEqual(40);
    const ids = new Set<string>();
    for (const c of cases) {
      expect(ids.has(c.id), `duplicate id ${c.id}`).toBe(false);
      ids.add(c.id);
      expect(["en", "tr"], `case ${c.id} bad lang`).toContain(c.lang);
      expect(c.argument.length).toBeGreaterThanOrEqual(20);
      expect(c.argument.length).toBeLessThanOrEqual(6000);
      for (const t of c.expected.dispute_type) {
        expect(DisputeType.safeParse(t).success, `case ${c.id} bad dispute_type ${t}`).toBe(true);
      }
      expect(c.expected.verdict_one_of.length).toBeGreaterThan(0);
      for (const v of c.expected.verdict_one_of) {
        // Labels are what a single judge may conclude; too_close is never a
        // correct answer.
        expect(JudgeVerdict.safeParse(v).success, `case ${c.id} bad verdict ${v}`).toBe(true);
      }
    }
  });

  it("is mostly clear-winner cases, with both sides winning and some exceptions", () => {
    const winnerCases = cases.filter((c) => c.expected.verdict_one_of.every(isWinner));
    expect(winnerCases.length / cases.length).toBeGreaterThanOrEqual(0.75);
    const labels = cases.flatMap((c) => c.expected.verdict_one_of);
    for (const v of ["side_a", "side_b", "split", "conditional", "dissolved"]) {
      expect(labels, `no case labeled ${v}`).toContain(v);
    }
  });

  it("includes Turkish cases", () => {
    expect(cases.filter((c) => c.lang === "tr").length).toBeGreaterThanOrEqual(5);
  });

  it("uses Party A / Party B labels like anonymized input", () => {
    for (const c of cases) {
      expect(c.argument, c.id).toContain("Party A");
      expect(c.argument, c.id).toContain("Party B");
    }
  });
});
