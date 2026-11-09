import { describe, expect, it } from "vitest";
import cases from "./arguments.json";
import { DisputeType, FinalVerdict, PartyId } from "../lib/types";

describe("labeled test set", () => {
  it("has at least 30 well-formed cases with valid labels", () => {
    expect(cases.length).toBeGreaterThanOrEqual(30);
    const ids = new Set<string>();
    for (const c of cases.filter((x) => !("parties" in x))) {
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

  it("has well-formed cases with three and four sides, winners named by side letter", () => {
    const many = cases.filter((x): x is typeof x & { parties: number } => "parties" in x);
    expect(many.filter((c) => c.parties === 3).length).toBeGreaterThanOrEqual(2);
    expect(many.filter((c) => c.parties === 4).length).toBeGreaterThanOrEqual(2);
    const ids = new Set(cases.map((c) => c.id));
    expect(ids.size).toBe(cases.length);
    for (const c of many) {
      const letters = ["A", "B", "C", "D"].slice(0, c.parties);
      expect(c.argument.length, c.id).toBeLessThanOrEqual(6000);
      for (const l of letters) expect(c.argument, `${c.id} lacks side ${l}`).toContain(`PARTY ${l}'S SIDE:`);
      expect(c.argument, `${c.id} has too many sides`).not.toContain(`PARTY ${"ABCD"[c.parties]}'S SIDE:`);
      for (const t of c.expected.dispute_type) expect(DisputeType.safeParse(t).success, c.id).toBe(true);
      for (const v of c.expected.verdict_one_of) {
        const ok = v === "too_close" || (PartyId.safeParse(v).success && "abcd".indexOf(v) < c.parties);
        expect(ok, `case ${c.id} bad verdict ${v}`).toBe(true);
      }
    }
  });
});
