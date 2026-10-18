import { describe, expect, it } from "vitest";
import { JUDGE_SCHEMA, judgeRunCount, systemPrompt } from "../lib/judge";

describe("judgeRunCount", () => {
  it("defaults to 3", () => {
    expect(judgeRunCount(undefined)).toBe(3);
    expect(judgeRunCount("")).toBe(3);
    expect(judgeRunCount("abc")).toBe(3);
  });

  it("is always odd and never above the configured count", () => {
    expect(judgeRunCount("1")).toBe(1);
    expect(judgeRunCount("2")).toBe(1);
    expect(judgeRunCount("3")).toBe(3);
    expect(judgeRunCount("4")).toBe(3);
    expect(judgeRunCount("2.5")).toBe(1);
    expect(judgeRunCount("-1")).toBe(1);
  });
});

describe("judge schema", () => {
  it("keeps the forced ruling as the last two properties", () => {
    const keys = Object.keys(JUDGE_SCHEMA.properties);
    expect(keys.slice(-2)).toEqual(["leaning", "leaning_reason"]);
    expect(JUDGE_SCHEMA.required.slice(-2)).toEqual(["leaning", "leaning_reason"]);
  });

  it("requires the exception basis right after the verdict", () => {
    const keys = Object.keys(JUDGE_SCHEMA.properties);
    expect(keys.indexOf("exception_basis")).toBe(keys.indexOf("verdict") + 1);
    expect(JUDGE_SCHEMA.required).toContain("exception_basis");
  });
});

describe("judge prompt", () => {
  const en = systemPrompt({ preset: "balanced" }, false, "en");

  it("makes a clear winner the default and gates each exception", () => {
    expect(en).toContain("a clear winner is the default");
    for (const exception of ['"split"', '"conditional"', '"dissolved"']) {
      expect(en).toContain(`- ${exception}: (a)`);
    }
    expect(en).toContain("state the test in exception_basis");
  });

  it("asks for exception_basis in Turkish when the output is Turkish", () => {
    const tr = systemPrompt({ preset: "balanced" }, false, "tr");
    expect(tr).toMatch(/LANGUAGE:.*exception_basis/);
    expect(en).not.toContain("LANGUAGE:");
  });
});
