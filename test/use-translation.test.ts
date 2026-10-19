import { describe, expect, it, vi } from "vitest";
import { applyText } from "../lib/translate";
import {
  CLAIM_KINDS,
  DISPUTE_TYPES,
  FINAL_VERDICTS,
  JUDGE_VERDICTS,
  dropRetryable,
  fetchTranslation,
  looksLikeVerdict,
  translationView,
} from "../lib/use-translation";
import { ClaimKind, DisputeType, FinalVerdict, JudgeVerdict, VerdictResult } from "../lib/types";
import { EN_TEXT, TR_RESULT } from "./translate-fixtures";

const EN_COPY = applyText(TR_RESULT, EN_TEXT, "en");

describe("translationView", () => {
  it("shows the original in its own language", () => {
    expect(translationView(TR_RESULT, "tr", undefined)).toEqual({
      result: TR_RESULT,
      status: "original",
      source: "tr",
    });
    // A stale entry never overrides the original in its own language.
    expect(translationView(TR_RESULT, "tr", EN_COPY).result).toBe(TR_RESULT);
  });

  it("keeps the original visible while loading and after an error", () => {
    expect(translationView(TR_RESULT, "en", undefined)).toEqual({
      result: TR_RESULT,
      status: "loading",
      source: "tr",
    });
    expect(translationView(TR_RESULT, "en", "error")).toEqual({
      result: TR_RESULT,
      status: "error",
      source: "tr",
    });
    expect(translationView(TR_RESULT, "en", "blocked").status).toBe("error");
  });

  it("swaps in a fetched translation", () => {
    expect(translationView(TR_RESULT, "en", EN_COPY)).toEqual({
      result: EN_COPY,
      status: "translated",
      source: "tr",
    });
  });
});

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("fetchTranslation", () => {
  it("POSTs to the translate endpoint and returns the result", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      reply(200, { id: "abc", lang: "en", source: "tr", translated: true, result: EN_COPY }),
    );
    expect(await fetchTranslation("abc", "en", fetchImpl)).toEqual(EN_COPY);
    expect(fetchImpl).toHaveBeenCalledWith("/api/verdict/abc/translate?lang=en", { method: "POST" });
  });

  it("reports HTTP errors, bad bodies, wrong language and network failures as retryable", async () => {
    const cases: (() => Promise<Response>)[] = [
      async () => reply(503, { code: "unavailable" }),
      async () => reply(429, { code: "rate_limited" }),
      async () => reply(404, { code: "not_found" }),
      async () => reply(200, { nope: true }),
      async () => reply(200, { id: "abc", lang: "tr", source: "tr", translated: false, result: TR_RESULT }),
      async () => new Response("not json", { status: 200 }),
      async () => {
        throw new TypeError("network");
      },
    ];
    for (const impl of cases) {
      expect(await fetchTranslation("abc", "en", vi.fn(impl))).toEqual({ failed: true, retryAfterSec: null });
    }
  });

  it("passes on a 429's Retry-After, capped at ten minutes", async () => {
    const limited = (after: string) =>
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: "rate_limited" }), { status: 429, headers: { "Retry-After": after } }),
      );
    expect(await fetchTranslation("abc", "en", limited("42"))).toEqual({ failed: true, retryAfterSec: 42 });
    expect(await fetchTranslation("abc", "en", limited("86400"))).toEqual({ failed: true, retryAfterSec: 600 });
  });
});

describe("dropRetryable", () => {
  it("forgets plain failures so the next visit retries, keeps translations and rate-limit blocks", () => {
    const entries = { "abc:en": "error", "def:en": "blocked", "ghi:en": EN_COPY } as const;
    expect(dropRetryable(entries)).toEqual({ "def:en": "blocked", "ghi:en": EN_COPY });
  });

  it("returns the same object when there is nothing to drop", () => {
    const entries = { "def:en": "blocked" as const, "ghi:en": EN_COPY };
    expect(dropRetryable(entries)).toBe(entries);
  });
});

describe("looksLikeVerdict (client shape check, no zod)", () => {
  it("lists exactly the schema's enum values", () => {
    expect([...FINAL_VERDICTS]).toEqual(FinalVerdict.options);
    expect([...JUDGE_VERDICTS]).toEqual(JudgeVerdict.options);
    expect([...DISPUTE_TYPES]).toEqual(DisputeType.options);
    expect([...CLAIM_KINDS]).toEqual(ClaimKind.options);
  });

  it("accepts what the server schema accepts", () => {
    for (const r of [TR_RESULT, EN_COPY]) {
      expect(VerdictResult.safeParse(r).success).toBe(true);
      expect(looksLikeVerdict(r)).toBe(true);
    }
  });

  it("rejects bodies the card could not render", () => {
    const broken: unknown[] = [
      null,
      [],
      "verdict",
      {},
      { ...TR_RESULT, verdict: "maybe" },
      { ...TR_RESULT, headline: 3 },
      { ...TR_RESULT, confidence: 0 },
      { ...TR_RESULT, confidence: 2.5 },
      { ...TR_RESULT, runs: ["side_a", "too_close"] },
      { ...TR_RESULT, facts_relied_on: "none" },
      { ...TR_RESULT, split_points: undefined },
      { ...TR_RESULT, argument_map: { ...TR_RESULT.argument_map, side_a: [] } },
      { ...TR_RESULT, argument_map: { ...TR_RESULT.argument_map, side_b: [{ claim: "x", kind: "vibe" }] } },
    ];
    for (const b of broken) {
      expect(looksLikeVerdict(b)).toBe(false);
      expect(VerdictResult.safeParse(b).success).toBe(false);
    }
  });
});
