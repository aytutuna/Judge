import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.hoisted(() => vi.fn());

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

import { claudeJson } from "../lib/claude";

const CALL = {
  system: "sys",
  user: "usr",
  schema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] },
  effort: "low" as const,
  model: "claude-haiku-5-5",
};

beforeEach(() => {
  create.mockReset();
  create.mockResolvedValue({
    id: "m",
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    content: [{ type: "text", text: '{"answer":"yes"}', citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.unstubAllEnvs());

describe("claudeJson images", () => {
  it("without images sends exactly the text-only request", async () => {
    await claudeJson(CALL);
    await claudeJson({ ...CALL, images: [] });
    for (const [body] of create.mock.calls) {
      expect(body).toEqual({
        model: "claude-haiku-5-5",
        max_tokens: 16_000,
        system: "sys",
        messages: [{ role: "user", content: "usr" }],
        output_config: {
          format: {
            type: "json_schema",
            schema: {
              type: "object",
              properties: { answer: { type: "string" } },
              required: ["answer"],
              additionalProperties: false,
            },
          },
          effort: "low",
        },
      });
    }
  });

  it("puts base64 image blocks before the text", async () => {
    await claudeJson({ ...CALL, images: [{ mediaType: "image/png", data: "iVBORw0KGgo=" }] });
    const body = create.mock.calls[0][0];
    expect(body.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } },
          { type: "text", text: "usr" },
        ],
      },
    ]);
    expect(body).not.toHaveProperty("temperature");
  });
});
