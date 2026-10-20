import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verdictLang } from "../lib/content-lang";
import { t } from "../lib/i18n";
import { WindowLimiter } from "../lib/ratelimit";
import {
  applyText,
  checkSegments,
  extractText,
  flattenText,
  inTargetLanguage,
  mapPartyLabels,
  planSegments,
  reassemble,
  TRANSLATE_SCHEMA,
  TRANSLATE_TIMEOUT_MS,
  translateResult,
  translateSystemPrompt,
  translateUserMessage,
  unflattenText,
} from "../lib/translate";
import type { VerdictResult } from "../lib/types";
import { EN_REPLY, EN_TEXT, TR_ECHO_REPLY, TR_RESULT } from "./translate-fixtures";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("extractText / applyText", () => {
  it("extracts every free-text field and only those", () => {
    const text = extractText(TR_RESULT);
    expect(text.split_points).toEqual(["Taraf A botanik konusunda haklı.", "Taraf B mutfak konusunda haklı."]);
    expect(text.side_b).toHaveLength(2);
    expect(text.lean_reason).toBe("Taraf A'nın tanımı daha sağlam.");
    expect(text.crux_trial).toEqual({ attack: "Saldırı metni.", reasoning: "" });
    expect(Object.keys(text).sort()).toEqual(Object.keys(EN_TEXT).sort());
  });

  it("uses null for groups the verdict does not have", () => {
    const text = extractText({ ...TR_RESULT, split_points: null, conditional: null, lean: undefined, crux_trial: undefined });
    expect(text.split_points).toBeNull();
    expect(text.conditional).toBeNull();
    expect(text.lean_reason).toBeNull();
    expect(text.crux_trial).toBeNull();
  });

  it("swaps text in and leaves enums, numbers, runs and flags untouched", () => {
    const out = applyText(TR_RESULT, EN_TEXT, "en");
    expect(out.lang).toBe("en");
    expect(out.headline).toBe("Both are partly right");
    expect(out.verdict).toBe(TR_RESULT.verdict);
    expect(out.dispute_type).toBe(TR_RESULT.dispute_type);
    expect(out.confidence).toBe(3);
    expect(out.runs).toEqual(TR_RESULT.runs);
    expect(out.escalated).toBe(true);
    expect(out.split_points!.map((p) => p.party)).toEqual(["a", "b"]);
    expect(out.argument_map.side_b.map((c) => c.kind)).toEqual(["definition", "value"]);
    expect(out.lean).toEqual({ party: "a", unanimous: false, reason: "Party A's definition holds up better." });
    expect(out.crux_trial).toEqual({ attack: "The attack.", outcome: "uncertain", reasoning: "" });
    // The original is not mutated.
    expect(TR_RESULT.headline).toBe("İkisi de kısmen haklı");
  });

  it("keeps a null lean null and an absent lean absent", () => {
    const tie = applyText({ ...TR_RESULT, lean: null }, { ...EN_TEXT, lean_reason: null }, "en");
    expect(tie.lean).toBeNull();
    const none = applyText({ ...TR_RESULT, lean: undefined }, { ...EN_TEXT, lean_reason: null }, "en");
    expect(none.lean).toBeUndefined();
  });
});

describe("segments", () => {
  const source = extractText(TR_RESULT);

  it("flatten and unflatten round-trip, with absent groups staying null", () => {
    const flat = flattenText(source).map((s) => s.text);
    expect(unflattenText(source, flat)).toEqual(source);
    const bare = { ...source, split_points: null, conditional: null, lean_reason: null, crux_trial: null };
    expect(unflattenText(bare, flattenText(bare).map((s) => s.text))).toEqual(bare);
  });

  it("numbers every string with letters from 0 and leaves empty or letterless ones out", () => {
    const plan = planSegments({ ...source, bedrock_b: "—" }, "en");
    expect(plan.segments.map((s) => s.i)).toEqual(plan.segments.map((_, i) => i));
    const sent = plan.segments.map((s) => s.text);
    expect(sent).not.toContain("");
    expect(sent).not.toContain("—");
    expect(plan.segments).toHaveLength(flattenText(source).length - 2);
  });

  it("notes the headline and the bare condition clause for the target", () => {
    const en = planSegments(source, "en").segments;
    expect(en[0]).toMatchObject({ text: source.headline, note: expect.stringContaining("10 words") });
    const ifSeg = en.find((s) => s.text === source.conditional![0].if_value);
    expect(ifSeg?.note).toContain('"If"');
    const tr = planSegments(EN_TEXT, "tr").segments.find((s) => s.text === EN_TEXT.conditional![0].if_value);
    expect(tr?.note).toContain("-sa/-se");
    expect(en.find((s) => s.text === source.crux)?.note).toBeUndefined();
  });

  it("reassembles a reply by i, whatever order it comes in", () => {
    const plan = planSegments(source, "en");
    const shuffled = { segments: [...EN_REPLY.segments].reverse() };
    const checked = checkSegments(plan.segments, shuffled, "en");
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    const out = unflattenText(source, reassemble(plan, checked.texts));
    expect(out).toEqual(EN_TEXT);
    // The unsent empty string keeps its slot.
    expect(out.crux_trial?.reasoning).toBe("");
  });

  it("asks for an integer i and a string text per segment", () => {
    expect(TRANSLATE_SCHEMA.properties.segments.items.properties).toEqual({
      i: { type: "integer" },
      text: { type: "string" },
    });
  });
});

describe("checkSegments", () => {
  const segs = planSegments(extractText(TR_RESULT), "en").segments;
  const reply = (f: (s: { i: number; text: string }[]) => { i: number; text: string }[]) => ({
    segments: f(EN_REPLY.segments.map((s) => ({ ...s }))),
  });

  it("accepts a complete reply", () => {
    expect(checkSegments(segs, EN_REPLY, "en")).toEqual({ ok: true, texts: EN_REPLY.segments.map((s) => s.text) });
  });

  it("requires every i exactly once, with text", () => {
    expect(checkSegments(segs, reply((s) => s.slice(1)), "en")).toEqual({
      ok: false,
      error: "segments 0 missing or empty",
    });
    expect(checkSegments(segs, reply((s) => [...s, s[2]]), "en")).toEqual({ ok: false, error: "reply repeats segment 2" });
    expect(checkSegments(segs, reply((s) => [...s, { i: 99, text: "x" }]), "en")).toMatchObject({ ok: false });
    expect(checkSegments(segs, reply((s) => s.map((x) => (x.i === 3 ? { ...x, text: " " } : x))), "en")).toEqual({
      ok: false,
      error: "segments 3 missing or empty",
    });
    expect(checkSegments(segs, { segments: [] }, "en")).toMatchObject({ ok: false });
  });

  it("rejects a reply that is not the segment schema", () => {
    for (const bad of [EN_TEXT, "nope", null, { segments: [{ i: "0", text: "x" }] }]) {
      expect(checkSegments(segs, bad, "en")).toEqual({ ok: false, error: "reply did not match the segment schema" });
    }
  });

  it("rejects long segments echoed back, but not short ones that may stay the same", () => {
    const long = [{ i: 0, text: "Domates bitkinin çiçeğinden gelişen bir meyvedir." }, { i: 1, text: "Hayır." }];
    // Only the long segment counts as echoed; "Hayır." could be a name or a quote.
    expect(checkSegments(long, { segments: long }, "en")).toEqual({ ok: false, error: "segments 0 came back untranslated" });
    const shortSame = [
      { i: 0, text: "Domates bitkinin çiçeğinden gelişen bir meyvedir." },
      { i: 1, text: "Kadıköy" },
    ];
    expect(
      checkSegments(shortSame, { segments: [{ i: 0, text: "A tomato is a fruit that grows from the plant's flower." }, { i: 1, text: "Kadıköy" }] }, "en"),
    ).toMatchObject({ ok: true });
  });

  it("accepts segments that legitimately stay the same (product names, titles, quotes)", () => {
    const s = [
      { i: 0, text: "iPhone 15 Pro Max versus Galaxy S24 Ultra" },
      { i: 1, text: 'bu kitapta "Kırmızı Elma" adlı bölümde domates bitkinin çiçeğinden gelişen bir meyve olarak geçer.' },
    ];
    const reply = {
      segments: [
        { i: 0, text: "iPhone 15 Pro Max versus Galaxy S24 Ultra" },
        { i: 1, text: 'In this book, the chapter "Kırmızı Elma" describes the tomato as a fruit of the plant\'s flower.' },
      ],
    };
    expect(checkSegments(s, reply, "en")).toMatchObject({ ok: true });
    // A plain-prose segment echoed alongside is still caught.
    const echoed = { segments: [reply.segments[0], s[1]] };
    expect(checkSegments(s, echoed, "en")).toMatchObject({ ok: false, error: "segments 1 came back untranslated" });
  });

  it("counts an echo with only the party labels swapped as untranslated", () => {
    const s = [{ i: 0, text: "Taraf A'nın tanımı bilimsel olarak daha sağlam duruyor." }];
    expect(checkSegments(s, { segments: [{ i: 0, text: "Party A's tanımı bilimsel olarak daha sağlam duruyor." }] }, "en")).toMatchObject({
      ok: false,
      error: expect.stringContaining("untranslated"),
    });
  });

  it("rejects the whole source echoed back, either way round", () => {
    expect(checkSegments(segs, TR_ECHO_REPLY, "en")).toMatchObject({ ok: false });
    const enSegs = planSegments(EN_TEXT, "tr").segments;
    expect(checkSegments(enSegs, EN_REPLY, "tr")).toMatchObject({ ok: false });
  });
});

describe("party labels", () => {
  it("maps leftover source labels to the target labels", () => {
    expect(mapPartyLabels("Taraf A and Taraf B", "en")).toBe("Party A and Party B");
    expect(mapPartyLabels("Party A haklı, Party B değil", "tr")).toBe("Taraf A haklı, Taraf B değil");
    expect(mapPartyLabels("Party A is right", "en")).toBe("Party A is right");
  });

  it("Turkish suffixes become English grammar (tr -> en)", () => {
    expect(mapPartyLabels("Taraf A'nın claim beats Taraf B'nin", "en")).toBe("Party A's claim beats Party B's");
    expect(mapPartyLabels("Agreeing with Taraf B'ye is fair", "en")).toBe("Agreeing with Party B is fair");
    // A label the model already switched, with the Turkish suffix left on.
    expect(mapPartyLabels("Party A'nın claim and Party B’nin reply", "en")).toBe("Party A's claim and Party B's reply");
    expect(mapPartyLabels("It goes to Party A'ya, not Party B'den", "en")).toBe("It goes to Party A, not Party B");
    // Correct English is left alone.
    expect(mapPartyLabels("Party B's objection and Party A’s point", "en")).toBe("Party B's objection and Party A’s point");
  });

  it("English genitives become Turkish suffixes (en -> tr)", () => {
    expect(mapPartyLabels("Party A's tanımı, Party B's itirazı", "tr")).toBe("Taraf A'nın tanımı, Taraf B'nin itirazı");
    expect(mapPartyLabels("Party A’s claim", "tr")).toBe("Taraf A'nın claim");
    // A label the model already switched, with the English suffix left on.
    expect(mapPartyLabels("Taraf A's tanımı ve Taraf B's itirazı", "tr")).toBe("Taraf A'nın tanımı ve Taraf B'nin itirazı");
    // Correct Turkish is left alone.
    expect(mapPartyLabels("Taraf A'nın tanımı Taraf B'ye göre", "tr")).toBe("Taraf A'nın tanımı Taraf B'ye göre");
  });

  it("fixes the vowel harmony of a suffix on a Turkish label", () => {
    expect(mapPartyLabels("Taraf A'nin tanımı", "tr")).toBe("Taraf A'nın tanımı");
    expect(mapPartyLabels("Taraf B'ya göre", "tr")).toBe("Taraf B'ye göre");
    expect(mapPartyLabels("Taraf A'ye ve Taraf B'dan", "tr")).toBe("Taraf A'ya ve Taraf B'den");
    expect(mapPartyLabels("Taraf A'da, Taraf B'de", "tr")).toBe("Taraf A'da, Taraf B'de");
  });

  it("keeps name placeholders in their English form, with the right suffix", () => {
    expect(mapPartyLabels("Kişi C'nin duyguları", "tr")).toBe("Person C'nin duyguları");
    expect(mapPartyLabels("Person C's feelings and Person D’s", "tr")).toBe("Person C'nin feelings and Person D'nin");
    expect(mapPartyLabels("Person C'nin feelings, told to Person D'ye", "en")).toBe("Person C's feelings, told to Person D");
    expect(mapPartyLabels("Kişi C agreed with Person C's view", "en")).toBe("Person C agreed with Person C's view");
    expect(mapPartyLabels("Person C'ye göre", "tr")).toBe("Person C'ye göre");
  });

  it("never harmonises the invariant -ki and -ken after a Turkish label", () => {
    expect(mapPartyLabels("Taraf A'nınki daha güçlü", "tr")).toBe("Taraf A'nınki daha güçlü");
    expect(mapPartyLabels("Taraf A'daki sorun", "tr")).toBe("Taraf A'daki sorun");
    expect(mapPartyLabels("Taraf A'yken", "tr")).toBe("Taraf A'yken");
    expect(mapPartyLabels("Taraf B'deki sorun, Taraf B'nin", "tr")).toBe("Taraf B'deki sorun, Taraf B'nin");
    // Harmony still applies to the case suffix before the invariant tail.
    expect(mapPartyLabels("Taraf A'dekı", "tr")).toBe("Taraf A'dakı");
    expect(mapPartyLabels("Person C'deki sorun, Person C'yken", "tr")).toBe("Person C'deki sorun, Person C'yken");
  });

  it("keeps English contractions and the Turkish -ki possessive when going to English", () => {
    expect(mapPartyLabels("Party A'll pay", "en")).toBe("Party A'll pay");
    expect(mapPartyLabels("Party B'd rather", "en")).toBe("Party B'd rather");
    expect(mapPartyLabels("Party A've left, Party B're here, Party A'm", "en")).toBe(
      "Party A've left, Party B're here, Party A'm",
    );
    expect(mapPartyLabels("Taraf A'nınki is stronger", "en")).toBe("Party A's is stronger");
    expect(mapPartyLabels("Taraf B'ninki is weaker", "en")).toBe("Party B's is weaker");
    expect(mapPartyLabels("Person C'll pay and Person D'd rather", "en")).toBe("Person C'll pay and Person D'd rather");
    expect(mapPartyLabels("Person C'nunki is stronger", "en")).toBe("Person C's is stronger");
    // Real case suffixes are still dropped.
    expect(mapPartyLabels("Taraf A'dan, Taraf B'ye, Taraf A'yla, Taraf B'de", "en")).toBe(
      "Party A, Party B, Party A, Party B",
    );
  });

  it("applyText enforces target labels even when the model slips", () => {
    const out = applyText(TR_RESULT, { ...EN_TEXT, crux: "Taraf A'nın claim versus Party B'nin" }, "en");
    expect(out.crux).toBe("Party A's claim versus Party B's");
  });
});

describe("prompts", () => {
  const segs = planSegments(extractText(TR_RESULT), "en").segments;

  it("the system prompt puts faithfulness first and carries no judge voice rules", () => {
    for (const [source, target] of [["tr", "en"], ["en", "tr"]] as const) {
      const prompt = translateSystemPrompt(source, target);
      expect(prompt).toContain('"Party A" <-> "Taraf A"');
      expect(prompt.indexOf("Never add, drop, soften or strengthen")).toBeLessThan(prompt.indexOf("Natural wording"));
      expect(prompt).not.toMatch(/VOICE|framework|blunt/i);
    }
    expect(translateSystemPrompt("tr", "en")).toContain("from Turkish into English");
    expect(translateSystemPrompt("en", "tr")).toContain('"sen"');
  });

  it("the user message states the task, the label rule and the numbered segments (tr -> en)", () => {
    const msg = translateUserMessage("tr", "en", segs);
    expect(msg).toContain("Translate every segment from Turkish to English. Return the same i values");
    expect(msg).toContain(`"Taraf A'nın" -> "Party A's"`);
    expect(msg).toContain(`"Taraf B'ye" -> "to Party B"`);
    const body = msg.slice(msg.indexOf("[\n"), msg.lastIndexOf("\n]") + 2);
    expect(JSON.parse(body)).toEqual(segs);
    expect(msg).toContain(`Return all ${segs.length} segments (i = 0 to ${segs.length - 1})`);
    expect(msg).not.toContain("previous answer");
  });

  it("the user message for en -> tr spells out the Turkish suffixes", () => {
    const msg = translateUserMessage("en", "tr", planSegments(EN_TEXT, "tr").segments);
    expect(msg).toContain("Translate every segment from English to Turkish.");
    expect(msg).toContain(`"Party A's" -> "Taraf A'nın"`);
    expect(msg).toContain(`"to Party B" -> "Taraf B'ye"`);
  });

  it("the retry message adds a firmer reminder with the reason", () => {
    const msg = translateUserMessage("tr", "en", segs, "segments 1, 2 came back untranslated");
    expect(msg).toContain("previous answer was rejected (segments 1, 2 came back untranslated)");
    expect(msg).toContain("Returning the Turkish text unchanged is wrong");
  });
});

describe("inTargetLanguage", () => {
  const trTexts = planSegments(extractText(TR_RESULT), "en").segments.map((s) => s.text);
  const enTexts = EN_REPLY.segments.map((s) => s.text);

  it("accepts text in the target language", () => {
    expect(inTargetLanguage(enTexts, "en")).toBe(true);
    expect(inTargetLanguage(trTexts, "tr")).toBe(true);
  });

  it("rejects the source echoed back", () => {
    expect(inTargetLanguage(trTexts, "en")).toBe(false);
    expect(inTargetLanguage(enTexts, "tr")).toBe(false);
  });

  it("lets English carry Turkish names, places and quotes", () => {
    expect(inTargetLanguage([...enTexts, "The café is in Kadıköy."], "en")).toBe(true);
    expect(inTargetLanguage(["Ayşe's point stands", "Şükrü wins on the facts"], "en")).toBe(true);
    expect(
      inTargetLanguage(
        ['Party B says "kısır" is a salad, not a side dish, and Party A says the word "kısır" only means the bulgur dish.'],
        "en",
      ),
    ).toBe(true);
  });
});

describe("translateResult", () => {
  it("makes one low-effort segment call and returns the translated copy", async () => {
    const call = vi.fn().mockResolvedValue({ ok: true, data: EN_REPLY });
    const res = await translateResult(TR_RESULT, "en", { call });
    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0][0]).toMatchObject({ effort: "low", schema: TRANSLATE_SCHEMA, timeoutMs: TRANSLATE_TIMEOUT_MS });
    expect(call.mock.calls[0][0].user).toBe(translateUserMessage("tr", "en", planSegments(extractText(TR_RESULT), "en").segments));
    expect(res).toEqual({ ok: true, result: applyText(TR_RESULT, EN_TEXT, "en") });
  });

  it("returns the original without a call when it is already in the target", async () => {
    const call = vi.fn();
    expect(await translateResult(TR_RESULT, "tr", { call })).toEqual({ ok: true, result: TR_RESULT });
    expect(call).not.toHaveBeenCalled();
  });

  it("an echoed reply is retried once at medium effort with a reminder, and the retry wins", async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, data: TR_ECHO_REPLY })
      .mockResolvedValueOnce({ ok: true, data: EN_REPLY });
    const res = await translateResult(TR_RESULT, "en", { call });
    expect(call).toHaveBeenCalledTimes(2);
    expect(call.mock.calls[1][0]).toMatchObject({ effort: "medium" });
    expect(call.mock.calls[1][0].user).toContain("previous answer was rejected");
    expect(res).toEqual({ ok: true, result: applyText(TR_RESULT, EN_TEXT, "en") });
  });

  it("retries a max_tokens cut-off at low effort, other bad replies at medium", async () => {
    const cut = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, blocked: false, error: "response hit max_tokens (truncated JSON)" })
      .mockResolvedValueOnce({ ok: true, data: EN_REPLY });
    expect((await translateResult(TR_RESULT, "en", { call: cut })).ok).toBe(true);
    expect(cut.mock.calls[1][0]).toMatchObject({ effort: "low" });
    const bad = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, blocked: false, error: "response was not valid JSON" })
      .mockResolvedValueOnce({ ok: true, data: EN_REPLY });
    expect((await translateResult(TR_RESULT, "en", { call: bad })).ok).toBe(true);
    expect(bad.mock.calls[1][0]).toMatchObject({ effort: "medium" });
  });

  it("fails after the retry also fails (never partial)", async () => {
    const call = vi.fn().mockResolvedValue({ ok: true, data: TR_ECHO_REPLY });
    const res = await translateResult(TR_RESULT, "en", { call });
    expect(call).toHaveBeenCalledTimes(2);
    expect(res).toMatchObject({ ok: false, error: expect.stringContaining("untranslated") });
  });

  it("retries a bad shape or a broken JSON reply, but not a refusal or a request error", async () => {
    for (const first of [
      { ok: true, data: { segments: EN_REPLY.segments.slice(2) } },
      { ok: true, data: "not an object" },
      { ok: false, blocked: false, error: "response was not valid JSON" },
      { ok: false, blocked: false, error: "response hit max_tokens (truncated JSON)" },
    ]) {
      const call = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce({ ok: true, data: EN_REPLY });
      expect((await translateResult(TR_RESULT, "en", { call })).ok).toBe(true);
      expect(call).toHaveBeenCalledTimes(2);
    }
    for (const first of [
      { ok: false, blocked: false, error: "Claude HTTP 500: boom" },
      { ok: false, blocked: false, error: "Claude request timed out after 60s" },
      { ok: false, blocked: true, reason: "policy" },
    ]) {
      const call = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce({ ok: true, data: EN_REPLY });
      expect((await translateResult(TR_RESULT, "en", { call })).ok).toBe(false);
      expect(call).toHaveBeenCalledTimes(1);
    }
  });

  it("gives the retry only the time left, and skips it when too little is left", async () => {
    let now = 0;
    const slowEcho = vi.fn(async () => {
      now += TRANSLATE_TIMEOUT_MS - 20_000;
      return { ok: true as const, data: TR_ECHO_REPLY };
    });
    await translateResult(TR_RESULT, "en", { call: slowEcho, now: () => now });
    expect(slowEcho).toHaveBeenCalledTimes(2);
    expect(slowEcho.mock.calls).toHaveLength(2);
    expect((slowEcho.mock.calls as unknown as [{ timeoutMs: number }][])[1][0].timeoutMs).toBe(20_000);

    now = 0;
    const slowerEcho = vi.fn(async () => {
      now += TRANSLATE_TIMEOUT_MS - 5_000;
      return { ok: true as const, data: TR_ECHO_REPLY };
    });
    expect((await translateResult(TR_RESULT, "en", { call: slowerEcho, now: () => now })).ok).toBe(false);
    expect(slowerEcho).toHaveBeenCalledTimes(1);
  });

  it("translates a model refusal from the dictionary, without a call", async () => {
    const refused: VerdictResult = {
      ...TR_RESULT,
      verdict: "too_close",
      headline: t("tr", "refused.headline"),
      crux: t("tr", "refused.crux"),
      split_points: null,
      conditional: null,
      argument_map: {
        side_a: [{ claim: t("tr", "refused.claim"), kind: "logic" }],
        side_b: [{ claim: t("tr", "refused.claim"), kind: "logic" }],
        bedrock_a: "—",
        bedrock_b: "—",
      },
      losing_side_best_point: t("tr", "refused.bestPoint"),
      lean: undefined,
      crux_trial: undefined,
      model_refused: true,
    };
    const call = vi.fn();
    const res = await translateResult(refused, "en", { call });
    expect(call).not.toHaveBeenCalled();
    expect(res.ok && res.result.headline).toBe(t("en", "refused.headline"));
    expect(res.ok && res.result.argument_map.side_a[0].claim).toBe(t("en", "refused.claim"));
    expect(res.ok && res.result.lang).toBe("en");
  });
});

describe("verdictLang", () => {
  const { lang: _lang, ...legacy } = TR_RESULT;
  void _lang;

  it("trusts the recorded language", () => {
    expect(verdictLang({ ...TR_RESULT, lang: "en" })).toBe("en");
  });

  it("falls back to the text heuristic for rows without one", () => {
    expect(verdictLang(legacy)).toBe("tr");
    expect(verdictLang(applyText(TR_RESULT, EN_TEXT, "en"))).toBe("en");
    const { lang: _l, ...enLegacy } = applyText(TR_RESULT, EN_TEXT, "en");
    void _l;
    expect(verdictLang(enLegacy)).toBe("en");
  });

  it("looks past a headline with no Turkish-only letters", () => {
    expect(verdictLang({ ...legacy, headline: "Domates meyve", crux: "Botanik" })).toBe("tr");
  });
});

describe("WindowLimiter (translation bucket)", () => {
  it("allows up to the limit per window, per visitor", () => {
    const limiter = new WindowLimiter(2, 60_000);
    expect(limiter.check("v", 0).ok).toBe(true);
    expect(limiter.check("v", 1).ok).toBe(true);
    expect(limiter.check("v", 2)).toEqual({ ok: false, code: "rate_limited", retryAfterSec: 60 });
    expect(limiter.check("other", 2).ok).toBe(true);
    expect(limiter.check("v", 60_001).ok).toBe(true);
  });
});

describe("premium fact-check text", () => {
  const PREMIUM_TR: VerdictResult = {
    ...TR_RESULT,
    tier: "premium",
    panel: { models: ["claude-sonnet-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"] },
    fact_check: {
      status: "checked",
      claims: [
        {
          claim: "Domates botanik olarak bir meyvedir.",
          status: "supported",
          summary: "Botanik kaynaklar domatesi meyve sayar.",
          sources: [{ title: "Tomato | Britannica", url: "https://www.britannica.com/plant/tomato" }],
        },
        {
          claim: "Taraf B'nin dediği gibi yasal olarak sebzedir.",
          status: "mixed",
          summary: "Bir mahkeme kararı vergi için sebze saydı.",
          sources: [],
        },
      ],
    },
  };
  const EN_FACTS = [
    { claim: "Botanically, a tomato is a fruit.", summary: "Botanical sources count the tomato as a fruit." },
    { claim: "As Party B says, it is legally a vegetable.", summary: "A court ruling counted it as a vegetable for tax." },
  ];

  it("extracts claim and summary slots only for a checked fact-check, after every other slot", () => {
    const text = extractText(PREMIUM_TR);
    expect(text.fact_check).toEqual([
      { claim: "Domates botanik olarak bir meyvedir.", summary: "Botanik kaynaklar domatesi meyve sayar." },
      { claim: "Taraf B'nin dediği gibi yasal olarak sebzedir.", summary: "Bir mahkeme kararı vergi için sebze saydı." },
    ]);
    const base = flattenText(extractText(TR_RESULT)).map((s) => s.text);
    const withFacts = flattenText(text).map((s) => s.text);
    expect(withFacts.slice(0, base.length)).toEqual(base);
    expect(withFacts.slice(base.length)).toEqual([
      "Domates botanik olarak bir meyvedir.",
      "Botanik kaynaklar domatesi meyve sayar.",
      "Taraf B'nin dediği gibi yasal olarak sebzedir.",
      "Bir mahkeme kararı vergi için sebze saydı.",
    ]);
    expect(unflattenText(text, withFacts)).toEqual(text);
  });

  it("adds no slots for none / unavailable fact-checks or free results", () => {
    for (const fact_check of [
      { status: "none" as const, claims: [] },
      { status: "unavailable" as const, claims: [] },
      undefined,
    ]) {
      const text = extractText({ ...TR_RESULT, fact_check });
      expect(text).not.toHaveProperty("fact_check");
      expect(planSegments(text, "en").segments).toEqual(planSegments(extractText(TR_RESULT), "en").segments);
    }
  });

  it("translates claims and summaries but keeps status, sources, tier and panel", () => {
    const out = applyText(PREMIUM_TR, { ...EN_TEXT, fact_check: EN_FACTS }, "en");
    expect(out.tier).toBe("premium");
    expect(out.panel).toEqual(PREMIUM_TR.panel);
    expect(out.fact_check?.status).toBe("checked");
    expect(out.fact_check?.claims).toEqual([
      { ...PREMIUM_TR.fact_check!.claims[0], ...EN_FACTS[0] },
      { ...PREMIUM_TR.fact_check!.claims[1], ...EN_FACTS[1] },
    ]);
    expect(out.fact_check?.claims[0].sources).toEqual([
      { title: "Tomato | Britannica", url: "https://www.britannica.com/plant/tomato" },
    ]);
  });

  it("round-trips through translateResult with the fact-check segments", async () => {
    const plan = planSegments(extractText(PREMIUM_TR), "en");
    const english = planSegments({ ...EN_TEXT, fact_check: EN_FACTS }, "en").segments;
    expect(english).toHaveLength(plan.segments.length);
    const call = vi.fn().mockResolvedValue({ ok: true, data: { segments: english.map(({ i, text }) => ({ i, text })) } });
    const res = await translateResult(PREMIUM_TR, "en", { call });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.lang).toBe("en");
    expect(res.result.fact_check?.claims.map((c) => c.claim)).toEqual(EN_FACTS.map((f) => f.claim));
    expect(res.result.fact_check?.claims.map((c) => c.status)).toEqual(["supported", "mixed"]);
  });
});

describe("two-sided and appeal fields", () => {
  const TWO: VerdictResult = {
    ...TR_RESULT,
    two_sided: true,
    agreed_facts: ["İkisi de faturayı biliyordu."],
    disputed_facts: [
      { fact: "Fatura ödendi mi?", party_a: "Ödendi.", party_b: "Ödenmedi.", finding: "b", decisive: true },
    ],
    would_change: ["Nisan ayına ait bir banka kaydı."],
    evidence_used: { a: 1, b: 2 },
    appeal: {
      by: "b",
      outcome: "changed",
      previous_id: "v1",
      previous_verdict: "side_a",
      previous_confidence: 4,
      confidence_change: -1,
      summary: "Yeni ekran görüntüsü ödemenin geç yapıldığını gösterdi.",
    },
  };

  it("are extracted only when present and round-trip through flatten/unflatten", () => {
    expect(extractText(TR_RESULT)).not.toHaveProperty("agreed_facts");
    expect(extractText(TR_RESULT)).not.toHaveProperty("appeal_summary");
    const text = extractText(TWO);
    expect(text.agreed_facts).toEqual(["İkisi de faturayı biliyordu."]);
    expect(text.disputed_facts).toEqual([{ fact: "Fatura ödendi mi?", party_a: "Ödendi.", party_b: "Ödenmedi." }]);
    expect(text.would_change).toEqual(["Nisan ayına ait bir banka kaydı."]);
    expect(text.appeal_summary).toBe("Yeni ekran görüntüsü ödemenin geç yapıldığını gösterdi.");
    expect(unflattenText(text, flattenText(text).map((s) => s.text))).toEqual(text);
  });

  it("applyText swaps their text and keeps findings, flags, counts and the appeal facts", () => {
    const en = {
      ...EN_TEXT,
      agreed_facts: ["Both knew about the bill."],
      disputed_facts: [{ fact: "Was the bill paid?", party_a: "Paid.", party_b: "Not paid." }],
      would_change: ["A bank record for April."],
      appeal_summary: "The new screenshot showed the payment was late.",
    };
    const out = applyText(TWO, en, "en");
    expect(out.agreed_facts).toEqual(["Both knew about the bill."]);
    expect(out.disputed_facts).toEqual([
      { fact: "Was the bill paid?", party_a: "Paid.", party_b: "Not paid.", finding: "b", decisive: true },
    ]);
    expect(out.would_change).toEqual(["A bank record for April."]);
    expect(out.appeal).toEqual({ ...TWO.appeal, summary: "The new screenshot showed the payment was late." });
    expect(out.two_sided).toBe(true);
    expect(out.evidence_used).toEqual({ a: 1, b: 2 });
  });
});
