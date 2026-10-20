/**
 * Thin wrapper over the official Anthropic SDK: structured-JSON calls.
 * Model output is constrained to a JSON schema (output_config.format) so it
 * always parses; callers still validate the shape with zod.
 */

import { AsyncLocalStorage } from "node:async_hooks";
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

/** The effort a call without an explicit `effort` gets (JUDGE_EFFORT, else
 * "medium"), for callers that need to name it. */
export function defaultJudgeEffort(): Effort {
  return defaultEffort();
}

/** Token and search totals of the calls made inside one withUsageMeter run,
 * overall and per model. Counts only, never content. */
export type UsageTotals = {
  calls: number;
  input: number;
  output: number;
  searches: number;
  byModel: Record<string, { calls: number; input: number; output: number; searches: number }>;
};

const usageMeter = new AsyncLocalStorage<UsageTotals>();

function emptyUsage(): UsageTotals {
  return { calls: 0, input: 0, output: 0, searches: 0, byModel: {} };
}

/** Records one response's usage on the active meter, if there is one. */
function meter(model: string, input: number, output: number, searches: number): void {
  const totals = usageMeter.getStore();
  if (!totals) return;
  totals.calls += 1;
  totals.input += input;
  totals.output += output;
  totals.searches += searches;
  const m = (totals.byModel[model] ??= { calls: 0, input: 0, output: 0, searches: 0 });
  m.calls += 1;
  m.input += input;
  m.output += output;
  m.searches += searches;
}

/** Runs `fn` and totals the usage of every Claude call it makes (including
 * calls in parallel branches). Calls outside a meter are not counted. */
export async function withUsageMeter<T>(fn: () => Promise<T>): Promise<{ value: T; usage: UsageTotals }> {
  const usage = emptyUsage();
  const value = await usageMeter.run(usage, fn);
  return { value, usage };
}

/** One image for a vision call (base64, no data: prefix). The media type
 * must come from the sniffed bytes, never from the client. */
export type ClaudeImage = {
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  data: string;
};

export type ClaudeJsonCall = {
  system: string;
  user: string;
  /** Images placed before the user text. Absent or empty: the request is
   * exactly the text-only one. */
  images?: ClaudeImage[];
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

/** The user turn: the plain text, or the images followed by the text. */
function userContent(call: ClaudeJsonCall): string | Anthropic.ContentBlockParam[] {
  if (!call.images?.length) return call.user;
  return [
    ...call.images.map(
      (image): Anthropic.ImageBlockParam => ({
        type: "image",
        source: { type: "base64", media_type: image.mediaType, data: image.data },
      }),
    ),
    { type: "text", text: call.user },
  ];
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
        messages: [{ role: "user", content: userContent(call) }],
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
  meter(call.model ?? JUDGE_MODEL, u.input_tokens, u.output_tokens, 0);

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

/** The basic web search tool (no dynamic filtering): every result comes back
 * as a web_search_tool_result block, where cited sources are verified. */
export const WEB_SEARCH_TOOL = "web_search_20250305";

export type ClaudeSearchJsonCall = ClaudeJsonCall & {
  /** The web search tool's max_uses for this request. */
  maxSearches: number;
};

export type ClaudeSearchJsonResult<T> =
  | {
      ok: true;
      data: T;
      /** Web searches the request ran (usage.server_tool_use). */
      searches: number;
      /** url -> title of every result the searches returned. */
      results: Map<string, string>;
    }
  | { ok: false; blocked: true; reason: string }
  | { ok: false; blocked: false; error: string };

/**
 * One structured-JSON call with Anthropic's server-side web search tool
 * available. The search runs inside the request (no client tool loop), and
 * the answer still follows the JSON schema. Structured output suppresses
 * text citations, so the result also carries every URL the searches
 * returned: callers check cited URLs against it. A `pause_turn` stop (the
 * server loop hit its iteration limit) is an error, never resumed.
 */
export async function claudeSearchJson<T>(
  call: ClaudeSearchJsonCall,
): Promise<ClaudeSearchJsonResult<T>> {
  if (!hasApiKey()) return { ok: false, blocked: false, error: "ANTHROPIC_API_KEY not set" };

  const timeoutMs = call.timeoutMs ?? CALL_TIMEOUT_MS;
  const model = call.model ?? JUDGE_MODEL;
  let message: Anthropic.Message;
  try {
    message = await client().messages.create(
      {
        model,
        max_tokens: MAX_TOKENS,
        system: call.system,
        messages: [{ role: "user", content: call.user }],
        tools: [{ type: WEB_SEARCH_TOOL, name: "web_search", max_uses: call.maxSearches }],
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

  const results = new Map<string, string>();
  let searchCalls = 0;
  for (const block of message.content) {
    if (block.type === "server_tool_use" && block.name === "web_search") searchCalls += 1;
    if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const r of block.content) if (!results.has(r.url)) results.set(r.url, r.title);
    }
  }
  // Billing counts come from usage; the blocks are the backstop if usage
  // under-reports, so a search that returned results is never read as none.
  const u = message.usage;
  const searches = Math.max(u.server_tool_use?.web_search_requests ?? 0, searchCalls);
  console.log(
    `[claude] tokens in=${u.input_tokens} out=${u.output_tokens} total=${u.input_tokens + u.output_tokens} searches=${searches} results=${results.size}`,
  );
  meter(model, u.input_tokens, u.output_tokens, searches);

  if (message.stop_reason === "refusal") {
    return { ok: false, blocked: true, reason: message.stop_details?.category ?? "refusal" };
  }
  if (message.stop_reason === "max_tokens") {
    return { ok: false, blocked: false, error: "response hit max_tokens (truncated JSON)" };
  }
  if (message.stop_reason === "pause_turn") {
    return { ok: false, blocked: false, error: "search loop paused (pause_turn)" };
  }

  // The answer is the last text block: with tools, short text may come
  // before the searches, and thinking blocks may lead.
  const texts = message.content.filter((b): b is Anthropic.TextBlock => b.type === "text");
  const text = texts.length ? texts[texts.length - 1].text : "";
  if (!text) {
    return { ok: false, blocked: false, error: `empty response (stop_reason: ${message.stop_reason ?? "?"})` };
  }
  try {
    return { ok: true, data: JSON.parse(text) as T, searches, results };
  } catch {
    return { ok: false, blocked: false, error: "response was not valid JSON" };
  }
}
