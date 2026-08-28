/**
 * Minimal Gemini REST client (no SDK): structured-JSON calls with retries.
 * Model output is forced into a responseSchema so it always parses.
 */

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";
export const JUDGE_MODEL = process.env.GEMINI_MODEL ?? "gemini-flash-latest";
/** Lighter model for anonymization — cheaper, and on the free tier it has its
 * own per-model rate-limit bucket, leaving the judge's quota untouched. */
export const LITE_MODEL = process.env.GEMINI_MODEL_LITE ?? "gemini-flash-lite-latest";

export function hasApiKey(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

export type GeminiJsonCall = {
  system: string;
  user: string;
  /** Gemini responseSchema (OpenAPI-style subset of JSON Schema). */
  schema: Record<string, unknown>;
  temperature?: number;
  /** 0 disables thinking (fast/cheap); undefined lets the model decide. */
  thinkingBudget?: number;
  model?: string;
};

export type GeminiJsonResult<T> =
  | { ok: true; data: T }
  | { ok: false; blocked: true; reason: string }
  | { ok: false; blocked: false; error: string };

const RETRIABLE = new Set([429, 500, 502, 503, 504]);

/** Free-tier 429s tell us how long to wait ("Please retry in 28.9s"). */
function retryDelayMs(status: number, bodyText: string, attempt: number): number {
  if (status === 429) {
    const m = bodyText.match(/retry in ([\d.]+)s/i);
    if (m) return Math.min(Math.ceil(parseFloat(m[1]) * 1000) + 500, 45_000);
    return 20_000;
  }
  return 1500 * 2 ** attempt;
}

export async function geminiJson<T>(
  call: GeminiJsonCall,
): Promise<GeminiJsonResult<T>> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, blocked: false, error: "GEMINI_API_KEY not set" };

  const body = {
    systemInstruction: { parts: [{ text: call.system }] },
    contents: [{ role: "user", parts: [{ text: call.user }] }],
    generationConfig: {
      temperature: call.temperature ?? 0.7,
      responseMimeType: "application/json",
      responseSchema: call.schema,
      ...(call.thinkingBudget !== undefined
        ? { thinkingConfig: { thinkingBudget: call.thinkingBudget } }
        : {}),
    },
  };

  const model = call.model ?? JUDGE_MODEL;
  let lastError = "unknown error";
  let waitMs = 0;
  for (let attempt = 0; attempt <= 2; attempt++) {
    if (attempt > 0 && waitMs > 0) {
      await new Promise((r) => setTimeout(r, waitMs));
    }
    let res: Response;
    try {
      res = await fetch(`${BASE}/${model}:generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": key,
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      lastError = `network error: ${e instanceof Error ? e.message : String(e)}`;
      waitMs = 1500 * 2 ** attempt;
      continue;
    }

    if (RETRIABLE.has(res.status)) {
      const bodyText = await res.text().catch(() => "");
      lastError = `Gemini HTTP ${res.status}`;
      waitMs = retryDelayMs(res.status, bodyText, attempt);
      continue;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        blocked: false,
        error: `Gemini HTTP ${res.status}: ${text.slice(0, 300)}`,
      };
    }

    const json = (await res.json()) as {
      promptFeedback?: { blockReason?: string };
      candidates?: Array<{
        finishReason?: string;
        content?: { parts?: Array<{ text?: string }> };
      }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        totalTokenCount?: number;
      };
    };

    if (json.promptFeedback?.blockReason) {
      return { ok: false, blocked: true, reason: json.promptFeedback.blockReason };
    }
    const candidate = json.candidates?.[0];
    if (!candidate) {
      return { ok: false, blocked: false, error: "Gemini returned no candidates" };
    }
    if (candidate.finishReason === "SAFETY" || candidate.finishReason === "PROHIBITED_CONTENT") {
      return { ok: false, blocked: true, reason: candidate.finishReason };
    }

    const text = candidate.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text) {
      lastError = `empty response (finishReason: ${candidate.finishReason ?? "?"})`;
      waitMs = 1500 * 2 ** attempt;
      continue;
    }

    if (json.usageMetadata) {
      const u = json.usageMetadata;
      console.log(
        `[gemini] tokens in=${u.promptTokenCount ?? "?"} out=${u.candidatesTokenCount ?? "?"} total=${u.totalTokenCount ?? "?"}`,
      );
    }

    try {
      return { ok: true, data: JSON.parse(text) as T };
    } catch {
      lastError = "response was not valid JSON";
      waitMs = 1500 * 2 ** attempt;
      continue;
    }
  }
  return { ok: false, blocked: false, error: lastError };
}
