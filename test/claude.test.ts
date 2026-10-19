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
import { claudeJson, claudeSearchJson, toClaudeSchema, withUsageMeter } from "../lib/claude";
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

describe("claudeSearchJson (mocked SDK)", () => {
  const SEARCH_CALL = { ...CALL, model: "claude-haiku-5-5", effort: "low" as const, maxSearches: 3 };

  function searched(overrides: Record<string, unknown> = {}): Anthropic.Message {
    return message({
      content: [
        { type: "thinking", thinking: "", signature: "sig" },
        { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "q" }, caller: { type: "direct" } },
        {
          type: "web_search_tool_result",
          tool_use_id: "s1",
          caller: { type: "direct" },
          content: [
            { type: "web_search_result", url: "https://a.org/x", title: "A", encrypted_content: "e", page_age: null },
            { type: "web_search_result", url: "https://b.org/y", title: "B", encrypted_content: "e", page_age: null },
          ],
        },
        {
          type: "web_search_tool_result",
          tool_use_id: "s2",
          caller: { type: "direct" },
          content: { type: "web_search_tool_result_error", error_code: "unavailable" },
        },
        { type: "text", text: "Let me check.", citations: null },
        { type: "text", text: '{"answer":"yes"}', citations: null },
      ],
      usage: { input_tokens: 2000, output_tokens: 300, server_tool_use: { web_search_requests: 2, web_fetch_requests: 0 } },
      ...overrides,
    });
  }

  it("sends the web search tool with max_uses next to the JSON-schema output", async () => {
    create.mockResolvedValueOnce(searched());
    const res = await claudeSearchJson<{ answer: string }>(SEARCH_CALL);
    expect(res.ok).toBe(true);
    const params = create.mock.calls[0][0];
    expect(params).toMatchObject({
      model: "claude-haiku-5-5",
      max_tokens: 16000,
      system: "sys",
      messages: [{ role: "user", content: "usr" }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
      output_config: { format: { type: "json_schema", schema: toClaudeSchema(CALL.schema) }, effort: "low" },
    });
    expect(params).not.toHaveProperty("temperature");
    expect(params).not.toHaveProperty("thinking");
    expect(params).not.toHaveProperty("tool_choice");
    expect(create.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("parses the last text block and returns the search count and result URLs", async () => {
    create.mockResolvedValueOnce(searched());
    const res = await claudeSearchJson<{ answer: string }>(SEARCH_CALL);
    expect(res).toEqual({
      ok: true,
      data: { answer: "yes" },
      searches: 2,
      results: new Map([
        ["https://a.org/x", "A"],
        ["https://b.org/y", "B"],
      ]),
    });
  });

  it("counts the search calls in the content when usage under-reports them", async () => {
    create.mockResolvedValueOnce(
      searched({ usage: { input_tokens: 2000, output_tokens: 300, server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 } } }),
    );
    expect(await claudeSearchJson(SEARCH_CALL)).toMatchObject({ ok: true, searches: 1 });
  });

  it("counts zero searches when the model did not search", async () => {
    create.mockResolvedValueOnce(message({ usage: { input_tokens: 10, output_tokens: 5, server_tool_use: null } }));
    const res = await claudeSearchJson(SEARCH_CALL);
    expect(res).toMatchObject({ ok: true, searches: 0 });
  });

  it("treats pause_turn and max_tokens as errors and a refusal as blocked", async () => {
    create.mockResolvedValueOnce(searched({ stop_reason: "pause_turn" }));
    expect(await claudeSearchJson(SEARCH_CALL)).toEqual({
      ok: false,
      blocked: false,
      error: "search loop paused (pause_turn)",
    });
    create.mockResolvedValueOnce(searched({ stop_reason: "max_tokens" }));
    expect(await claudeSearchJson(SEARCH_CALL)).toMatchObject({ ok: false, blocked: false });
    create.mockResolvedValueOnce(
      searched({ stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber", explanation: null } }),
    );
    expect(await claudeSearchJson(SEARCH_CALL)).toEqual({ ok: false, blocked: true, reason: "cyber" });
  });

  it("maps HTTP errors and timeouts like claudeJson", async () => {
    create.mockRejectedValueOnce(new Anthropic.RateLimitError(429, undefined, "rate limited", new Headers()));
    const res = await claudeSearchJson(SEARCH_CALL);
    expect(!res.ok && !res.blocked ? res.error : "").toMatch(/^Claude HTTP 429: /);
    create.mockRejectedValueOnce(new Anthropic.APIUserAbortError());
    expect(await claudeSearchJson({ ...SEARCH_CALL, timeoutMs: 40_000 })).toEqual({
      ok: false,
      blocked: false,
      error: "Claude request timed out after 40s",
    });
  });

  it("does not call the API without a key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(await claudeSearchJson(SEARCH_CALL)).toMatchObject({ ok: false, blocked: false });
    expect(create).not.toHaveBeenCalled();
  });
});

describe("withUsageMeter", () => {
  it("totals tokens and searches per model across parallel calls inside the meter only", async () => {
    create.mockImplementation(async (params: { model: string; tools?: unknown[] }) =>
      params.tools
        ? message({ usage: { input_tokens: 1000, output_tokens: 100, server_tool_use: { web_search_requests: 2, web_fetch_requests: 0 } } })
        : message({ usage: { input_tokens: 10, output_tokens: 20 } }),
    );
    const { value, usage } = await withUsageMeter(async () => {
      await Promise.all([
        claudeJson({ ...CALL, model: "claude-sonnet-5-5" }),
        claudeJson({ ...CALL, model: "claude-haiku-5-5" }),
        claudeSearchJson({ ...CALL, model: "claude-haiku-5-5", maxSearches: 3 }),
      ]);
      return "done";
    });
    // Outside any meter: not counted anywhere.
    await claudeJson(CALL);
    expect(value).toBe("done");
    expect(usage).toEqual({
      calls: 3,
      input: 1020,
      output: 140,
      searches: 2,
      byModel: {
        "claude-sonnet-5-5": { calls: 1, input: 10, output: 20, searches: 0 },
        "claude-haiku-5-5": { calls: 2, input: 1010, output: 120, searches: 2 },
      },
    });
  });
});
