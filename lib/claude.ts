/**
 * Thin wrapper over the official Anthropic SDK: structured-JSON calls.
 * Model output is constrained to a JSON schema (output_config.format) so it
 * always parses; callers still validate the shape with zod.
 */

import Anthropic from "@anthropic-ai/sdk";

export const JUDGE_MODEL = process.env.CLAUDE_MODEL ?? "claude-haiku-5-5";
/** Model for anonymization. Same model by default — the call is cheap
 * either way and runs at low effort; override to split them. */
export const LITE_MODEL = process.env.CLAUDE_MODEL_LITE ?? "claude-haiku-5-5";

/** Thinking is adaptive (on by default) and counts toward this cap, so it
 * needs headroom beyond the JSON itself. Non-streaming calls stay well under
 * the SDK's long-request threshold at this size. */
const MAX_TOKENS = 16_000;

/** Default end-to-end budget per call, SDK retries included. A non-streaming
 * response arrives only once generation is done, so this has to cover a full
 * MAX_TOKENS generation (~110s at the ~145 tok/s observed). Enforced with an
 * abort signal, which the SDK never retries — unlike its own per-attempt
 * timeout, which would resend the same slow request. */
const CALL_TIMEOUT_MS = 120_000;

export type Effort = "low" | "medium" | "high";
const EFFORTS: readonly Effort[] = ["low", "medium", "high"];

export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** Default depth for judge and trial calls; JUDGE_EFFORT overrides it. */
function defaultEffort(): Effort {
  const env = process.env.JUDGE_EFFORT as Effort | undefined;
  return env && EFFORTS.includes(env) ? env : "medium";
}

export type ClaudeJsonCall = {
  system: string;
  user: string;
  /** Compact schema (see toClaudeSchema): JSON Schema plus `nullable: true`. */
  schema: Record<string, unknown>;
  /** Thinking depth and token spend. Defaults to JUDGE_EFFORT, else "medium".
   * There is no temperature: the model rejects non-default sampling params. */
  effort?: Effort;
  model?: string;
  /** End-to-end budget for this call. Defaults to CALL_TIMEOUT_MS. */
  timeoutMs?: number;
};

export type ClaudeJsonResult<T> =
  | { ok: true; data: T }
  | { ok: false; blocked: true; reason: string }
  | { ok: false; blocked: false; error: string };

type Schema = Record<string, unknown>;

function isSchema(value: unknown): value is Schema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Compact schema -> structured-outputs JSON Schema. Every object gets
 * `additionalProperties: false` (required by the API) and `nullable: true`
 * becomes `anyOf: [<schema>, {type: "null"}]`. Property declaration order is
 * preserved — lib/judge.ts depends on it. Pure: never mutates the input.
 */
export function toClaudeSchema(schema: Schema): Schema {
  const { nullable, ...rest } = schema;
  const out: Schema = {};
  for (const [key, value] of Object.entries(rest)) {
    if (key === "properties" && isSchema(value)) {
      const props: Schema = {};
      for (const [name, sub] of Object.entries(value)) {
        props[name] = isSchema(sub) ? toClaudeSchema(sub) : sub;
      }
      out.properties = props;
    } else if (key === "items" && isSchema(value)) {
      out.items = toClaudeSchema(value);
    } else if (key === "anyOf" && Array.isArray(value)) {
      out.anyOf = value.map((s: unknown) => (isSchema(s) ? toClaudeSchema(s) : s));
    } else {
      out[key] = Array.isArray(value) ? [...value] : value;
    }
  }
  if (out.type === "object") out.additionalProperties = false;
  return nullable === true ? { anyOf: [out, { type: "null" }] } : out;
}

/** One shared client, created on first use. The SDK retries 408/409/429/5xx
 * and connection errors with backoff (honoring retry-after). No client
 * timeout: the SDK's per-attempt default (10 min) sits far above
 * CALL_TIMEOUT_MS, so the per-call signal is what bounds a request. */
let sharedClient: Anthropic | undefined;
function client(): Anthropic {
  sharedClient ??= new Anthropic({ maxRetries: 3 });
  return sharedClient;
}

/** The HTTP status stays in the text: the route keys "quota" off `HTTP 429`. */
function describeError(e: unknown, timeoutMs: number): string {
  // Checked first: APIUserAbortError is an APIError subclass. Only our
  // deadline signal aborts these calls.
  if (e instanceof Anthropic.APIUserAbortError) {
    return `Claude request timed out after ${Math.round(timeoutMs / 1000)}s`;
  }
  if (e instanceof Anthropic.APIConnectionError) {
    return `Claude network error: ${e.message}`;
  }
  if (e instanceof Anthropic.APIError) {
    return `Claude HTTP ${e.status ?? "?"}: ${e.message.slice(0, 300)}`;
  }
  return `Claude request failed: ${e instanceof Error ? e.message : String(e)}`;
}

export async function claudeJson<T>(
  call: ClaudeJsonCall,
): Promise<ClaudeJsonResult<T>> {
  if (!hasApiKey()) return { ok: false, blocked: false, error: "ANTHROPIC_API_KEY not set" };

  const timeoutMs = call.timeoutMs ?? CALL_TIMEOUT_MS;
  let message: Anthropic.Message;
  try {
    message = await client().messages.create(
      {
        model: call.model ?? JUDGE_MODEL,
        max_tokens: MAX_TOKENS,
        system: call.system,
        messages: [{ role: "user", content: call.user }],
        output_config: {
          format: { type: "json_schema", schema: toClaudeSchema(call.schema) },
          effort: call.effort ?? defaultEffort(),
        },
      },
      { signal: AbortSignal.timeout(timeoutMs) },
    );
  } catch (e) {
    return { ok: false, blocked: false, error: describeError(e, timeoutMs) };
  }

  const u = message.usage;
  console.log(
    `[claude] tokens in=${u.input_tokens} out=${u.output_tokens} total=${u.input_tokens + u.output_tokens}`,
  );

  // Branch on stop_reason before reading content: a refusal may not match
  // the schema, and a max_tokens stop leaves the JSON truncated.
  if (message.stop_reason === "refusal") {
    return { ok: false, blocked: true, reason: message.stop_details?.category ?? "refusal" };
  }
  if (message.stop_reason === "max_tokens") {
    return { ok: false, blocked: false, error: "response hit max_tokens (truncated JSON)" };
  }

  // Thinking blocks may precede the answer — select text blocks by type.
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  if (!text) {
    return { ok: false, blocked: false, error: `empty response (stop_reason: ${message.stop_reason ?? "?"})` };
  }
  try {
    return { ok: true, data: JSON.parse(text) as T };
  } catch {
    return { ok: false, blocked: false, error: "response was not valid JSON" };
  }
}
