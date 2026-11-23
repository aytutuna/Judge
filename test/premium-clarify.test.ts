import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/claude", () => ({ claudeJson: vi.fn(), LITE_MODEL: "claude-haiku-5-5" }));

import { claudeJson, type ClaudeJsonCall } from "../lib/claude";
import { CLARIFY_SYSTEM, CLARIFY_TIMEOUT_MS, clarifyQuestions, toClarifyResponse } from "../lib/premium/clarify";
import { idempotencyKey, withClarifications } from "../lib/premium/context";

const mockClaude = vi.mocked(claudeJson);

function q(question: string, winner_1 = "side_1", winner_2 = "side_2") {
  return { question, answer_1: "yes", winner_1, answer_2: "no", winner_2 };
}

beforeEach(() => {
  mockClaude.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("clarifyQuestions", () => {
  it("asks Haiku at low effort within the clarify budget and returns ids q1/q2", async () => {
    mockClaude.mockResolvedValue({
      ok: true,
      data: { questions: [q("Did B agree beforehand?"), q("How much was it?", "side_2", "neither")] },
    });
    const res = await clarifyQuestions("Mark says I owe him; I say we split it.", "en");
    expect(res).toEqual({
      questions: [
        { id: "q1", text: "Did B agree beforehand?", options: ["yes", "no"] },
        { id: "q2", text: "How much was it?", options: ["yes", "no"] },
      ],
    });
    const call = mockClaude.mock.calls[0][0] as ClaudeJsonCall;
    expect(call).toMatchObject({
      model: "claude-haiku-5-5",
      effort: "low",
      timeoutMs: CLARIFY_TIMEOUT_MS,
      user: "THE ARGUMENT:\n\nMark says I owe him; I say we split it.",
    });
    expect(call.system.startsWith(CLARIFY_SYSTEM)).toBe(true);
    expect(call.system).toContain("in English");
  });

  it("asks in Turkish with informal sen for tr", async () => {
    mockClaude.mockResolvedValue({ ok: true, data: { questions: [] } });
    expect(await clarifyQuestions("text", "tr")).toEqual({ questions: [] });
    const call = mockClaude.mock.calls[0][0] as ClaudeJsonCall;
    expect(call.system).toContain("in Turkish");
    expect(call.system).toContain('never "siz"');
  });

  it("never asks about values or for names (prompt rules)", () => {
    expect(CLARIFY_SYSTEM).toContain("Never ask about values");
    expect(CLARIFY_SYSTEM).toContain("never ask for names");
    expect(CLARIFY_SYSTEM).toContain("The default is no questions");
    expect(CLARIFY_SYSTEM).toContain("Never more than 2");
  });

  it("fails open with no questions on errors, refusals, timeouts and throws", async () => {
    mockClaude.mockResolvedValueOnce({ ok: false, blocked: false, error: "Claude request timed out after 20s" });
    expect(await clarifyQuestions("t", "en")).toEqual({ questions: [] });
    mockClaude.mockResolvedValueOnce({ ok: false, blocked: true, reason: "general_harms" });
    expect(await clarifyQuestions("t", "en")).toEqual({ questions: [] });
    mockClaude.mockRejectedValueOnce(new Error("boom"));
    expect(await clarifyQuestions("t", "en")).toEqual({ questions: [] });
  });
});

describe("toClarifyResponse", () => {
  it("trims, drops empties and malformed items, and keeps at most two", () => {
    expect(
      toClarifyResponse({ questions: [q("  "), 3, "Bare?", q(" First? "), q("Second?"), q("Third?")] }),
    ).toEqual({
      questions: [
        { id: "q1", text: "First?", options: ["yes", "no"] },
        { id: "q2", text: "Second?", options: ["yes", "no"] },
      ],
    });
  });

  it("cuts long questions to 140 characters at a word boundary", () => {
    const long = `${"word ".repeat(60)}end?`;
    const [first] = toClarifyResponse({ questions: [q(long)] }).questions;
    expect(first.text.length).toBeLessThanOrEqual(140);
    expect(first.text.endsWith("…")).toBe(true);
    expect(first.text).not.toMatch(/wor…$/);
  });

  it("drops questions whose answers don't change the winner", () => {
    expect(
      toClarifyResponse({
        questions: [q("Same either way?", "side_1", "side_1"), q("Was it agreed?"), q("Odd?", "side_1", "maybe")],
      }),
    ).toEqual({ questions: [{ id: "q1", text: "Was it agreed?", options: ["yes", "no"] }] });
  });

  it("turns the two answers into trimmed, capped, distinct options", () => {
    const long = `${"word ".repeat(30)}end`;
    const [a, b] = toClarifyResponse({
      questions: [
        { ...q("A?"), answer_1: "  Yes,   I paid ", answer_2: "yes, i paid" },
        { ...q("B?"), answer_1: long, answer_2: "  " },
      ],
    }).questions;
    expect(a.options).toEqual(["Yes, I paid"]);
    expect(b.options).toHaveLength(1);
    expect(b.options![0].length).toBeLessThanOrEqual(80);
    expect(b.options![0].endsWith("…")).toBe(true);
  });

  it("reads a malformed payload as no questions", () => {
    expect(toClarifyResponse(null)).toEqual({ questions: [] });
    expect(toClarifyResponse({ questions: "x" })).toEqual({ questions: [] });
  });
});

describe("withClarifications", () => {
  const ARG = "Mark says I owe him for dinner; I say we split it.";

  it("appends answered questions in English", () => {
    expect(
      withClarifications(
        ARG,
        [
          { question: "Did you agree to split?", answer: "Yes, by text" },
          { question: "How much?", answer: "40 euros" },
        ],
        "en",
      ),
    ).toBe(`${ARG}\n\nMore details from the person asking:\n- Q: Did you agree to split?\n  A: Yes, by text\n- Q: How much?\n  A: 40 euros`);
  });

  it("uses the Turkish labels for tr", () => {
    expect(withClarifications(ARG, [{ question: "Anlaştın mı?", answer: "Evet" }], "tr")).toBe(
      `${ARG}\n\nSoran kişiden ek bilgiler:\n- S: Anlaştın mı?\n  C: Evet`,
    );
  });

  it("drops skipped answers and returns the argument unchanged when nothing was answered", () => {
    expect(withClarifications(ARG, undefined, "en")).toBe(ARG);
    expect(withClarifications(ARG, [], "en")).toBe(ARG);
    expect(withClarifications(ARG, [{ question: "Q?", answer: "  " }], "en")).toBe(ARG);
    expect(
      withClarifications(ARG, [{ question: "Q1?", answer: "" }, { question: "Q2?", answer: "yes" }], "en"),
    ).toBe(`${ARG}\n\nMore details from the person asking:\n- Q: Q2?\n  A: yes`);
  });
});

describe("idempotencyKey", () => {
  it("is undefined when absent, the key when valid, null otherwise", () => {
    expect(idempotencyKey(new Headers())).toBeUndefined();
    expect(idempotencyKey(new Headers({ "Idempotency-Key": "3f2b9c1e-8d7a-4b6c-9e0f-1a2b3c4d5e6f" }))).toBe(
      "3f2b9c1e-8d7a-4b6c-9e0f-1a2b3c4d5e6f",
    );
    expect(idempotencyKey(new Headers({ "Idempotency-Key": "has space" }))).toBeNull();
    expect(idempotencyKey(new Headers({ "Idempotency-Key": "x".repeat(65) }))).toBeNull();
    expect(idempotencyKey(new Headers({ "Idempotency-Key": "" }))).toBeNull();
  });
});
