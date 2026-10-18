import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.hoisted(() => vi.fn());

// Keep the real SDK (error classes, types) but swap the network call.
vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/sdk")>();
  class MockAnthropic extends actual.default {
    constructor() {
      super({ apiKey: "test-key" });
      this.messages = { create } as unknown as typeof this.messages;
    }
  }
  return { ...actual, default: MockAnthropic };
});

import Anthropic from "@anthropic-ai/sdk";
import { claudeJson, toClaudeSchema } from "../lib/claude";
import { JUDGE_SCHEMA } from "../lib/judge";

type Schema = Record<string, unknown>;

/** Every subschema in the tree, depth-first. */
function walk(schema: unknown, out: Schema[] = []): Schema[] {
  if (Array.isArray(schema)) {
    for (const s of schema) walk(s, out);
  } else if (typeof schema === "object" && schema !== null) {
    const s = schema as Schema;
    out.push(s);
    if (s.properties) for (const p of Object.values(s.properties as Schema)) walk(p, out);
    if (s.items) walk(s.items, out);
    if (s.anyOf) walk(s.anyOf, out);
  }
  return out;
}

function message(overrides: Record<string, unknown> = {}): Anthropic.Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    content: [{ type: "text", text: '{"answer":"yes"}', citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 12, output_tokens: 34 },
    ...overrides,
  } as unknown as Anthropic.Message;
}

const CALL = {
  system: "sys",
  user: "usr",
  schema: {
    type: "object",
    properties: { answer: { type: "string" } },
    required: ["answer"],
  },
};

beforeEach(() => {
  create.mockReset();
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("JUDGE_EFFORT", "");
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("toClaudeSchema", () => {
  const converted = toClaudeSchema(JUDGE_SCHEMA as unknown as Schema);

  it("adds additionalProperties: false to every object", () => {
    const objects = walk(converted).filter((s) => s.type === "object");
    // root, split_points item, conditional item, argument_map, 2x CLAIM
    expect(objects.length).toBe(6);
    for (const o of objects) expect(o.additionalProperties).toBe(false);
  });

  it("turns nullable into anyOf with null and leaves no nullable keys", () => {
    const props = converted.properties as Record<string, Schema>;
    for (const key of ["split_points", "conditional"]) {
      const anyOf = props[key].anyOf as Schema[];
      expect(anyOf).toHaveLength(2);
      expect(anyOf[0].type).toBe("array");
      expect(anyOf[1]).toEqual({ type: "null" });
    }
    expect(walk(converted).some((s) => "nullable" in s)).toBe(false);
  });

  it("preserves property order, keeping leaning/leaning_reason last", () => {
    const keys = Object.keys(converted.properties as Schema);
    expect(keys).toEqual(Object.keys(JUDGE_SCHEMA.properties));
    expect(keys.slice(-2)).toEqual(["leaning", "leaning_reason"]);
    expect((converted.required as string[]).slice(-2)).toEqual(["leaning", "leaning_reason"]);
  });

  it("keeps enums and does not mutate its input", () => {
    const before = JSON.stringify(JUDGE_SCHEMA);
    const again = toClaudeSchema(JUDGE_SCHEMA as unknown as Schema);
    expect((again.properties as Record<string, Schema>).verdict.enum).toEqual(
      JUDGE_SCHEMA.properties.verdict.enum,
    );
    expect(JSON.stringify(JUDGE_SCHEMA)).toBe(before);
  });
});

describe("claudeJson (mocked SDK)", () => {
  it("returns parsed data and sends a structured-output request", async () => {
    create.mockResolvedValueOnce(message());
    const res = await claudeJson<{ answer: string }>(CALL);
    expect(res).toEqual({ ok: true, data: { answer: "yes" } });

    const params = create.mock.calls[0][0];
    expect(params).toMatchObject({
      model: "claude-haiku-5-5",
      max_tokens: 16000,
      system: "sys",
      messages: [{ role: "user", content: "usr" }],
      output_config: {
        format: { type: "json_schema", schema: toClaudeSchema(CALL.schema) },
        effort: "medium",
      },
    });
    expect(params).not.toHaveProperty("temperature");
    expect(params).not.toHaveProperty("thinking");
  });

  it("reads the text block after leading thinking blocks", async () => {
    create.mockResolvedValueOnce(
      message({
        content: [
          { type: "thinking", thinking: "", signature: "sig" },
          { type: "text", text: '{"answer":"no"}', citations: null },
        ],
      }),
    );
    expect(await claudeJson(CALL)).toEqual({ ok: true, data: { answer: "no" } });
  });

  it("maps a refusal to blocked with the category", async () => {
    create.mockResolvedValueOnce(
      message({
        stop_reason: "refusal",
        stop_details: { type: "refusal", category: "general_harms", explanation: null },
      }),
    );
    expect(await claudeJson(CALL)).toEqual({ ok: false, blocked: true, reason: "general_harms" });
  });

  it("falls back to 'refusal' when no category is given", async () => {
    create.mockResolvedValueOnce(message({ stop_reason: "refusal", stop_details: null }));
    expect(await claudeJson(CALL)).toEqual({ ok: false, blocked: true, reason: "refusal" });
  });

  it("treats a max_tokens stop as an error", async () => {
    create.mockResolvedValueOnce(message({ stop_reason: "max_tokens" }));
    const res = await claudeJson(CALL);
    expect(res.ok).toBe(false);
    expect(res).toMatchObject({ blocked: false });
  });

  it("treats invalid JSON as an error", async () => {
    create.mockResolvedValueOnce(
      message({ content: [{ type: "text", text: '{"answer":', citations: null }] }),
    );
    expect(await claudeJson(CALL)).toEqual({
      ok: false,
      blocked: false,
      error: "response was not valid JSON",
    });
  });

  it("treats a missing text block as an error", async () => {
    create.mockResolvedValueOnce(message({ content: [] }));
    const res = await claudeJson(CALL);
    expect(res).toMatchObject({ ok: false, blocked: false });
  });

  it("keeps the HTTP status in API error text (route quota detection)", async () => {
    create.mockRejectedValueOnce(
      new Anthropic.RateLimitError(429, undefined, "rate limited", new Headers()),
    );
    const res = await claudeJson(CALL);
    expect(res.ok).toBe(false);
    const error = !res.ok && !res.blocked ? res.error : "";
    expect(error).toMatch(/^Claude HTTP 429: /);
    expect(/\bHTTP 429\b/.test(error)).toBe(true);
  });

  it("maps connection errors to a network error", async () => {
    create.mockRejectedValueOnce(new Anthropic.APIConnectionError({ message: "socket hang up" }));
    const res = await claudeJson(CALL);
    expect(res).toMatchObject({ ok: false, blocked: false });
    expect(!res.ok && !res.blocked ? res.error : "").toMatch(/^Claude network error/);
  });

  it("bounds every call with an abort signal (default and per-call budget)", async () => {
    create.mockResolvedValue(message());
    await claudeJson(CALL);
    await claudeJson({ ...CALL, timeoutMs: 5_000 });
    for (const c of create.mock.calls) {
      expect(c[1]?.signal).toBeInstanceOf(AbortSignal);
      expect(c[1]?.signal.aborted).toBe(false);
    }
  });

  it("maps a deadline abort to a timeout error, not an HTTP error", async () => {
    create.mockRejectedValueOnce(new Anthropic.APIUserAbortError());
    const res = await claudeJson({ ...CALL, timeoutMs: 5_000 });
    expect(res).toEqual({
      ok: false,
      blocked: false,
      error: "Claude request timed out after 5s",
    });
  });

  it("does not call the API without a key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(await claudeJson(CALL)).toEqual({
      ok: false,
      blocked: false,
      error: "ANTHROPIC_API_KEY not set",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("uses an explicit effort, else JUDGE_EFFORT, else medium", async () => {
    create.mockResolvedValue(message());
    await claudeJson({ ...CALL, effort: "low" });
    vi.stubEnv("JUDGE_EFFORT", "high");
    await claudeJson(CALL);
    vi.stubEnv("JUDGE_EFFORT", "bogus");
    await claudeJson(CALL);
    const efforts = create.mock.calls.map((c) => c[0].output_config.effort);
    expect(efforts).toEqual(["low", "high", "medium"]);
  });
});
