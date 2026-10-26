/**
 * Golden fixtures for the native apps' unit tests, computed by the web's own
 * pure modules so a Kotlin/Swift port of the display logic is checked
 * against the real thing rather than a re-reading of it:
 *
 *   mobile/shared/fixtures/verdicts.json         sample API bodies (validated with lib/types.ts)
 *   mobile/shared/fixtures/display-vectors.json  expected labels, tug, tilt, waits, errors,
 *                                                restored names
 *
 * verdicts.json also carries the Premium and account bodies the apps build and
 * test against offline (each validated with the web's zod schemas where one
 * exists, otherwise built with its TypeScript type):
 *   config                  GET /api/v1/config: full (every provider, premium and
 *                           features on, purchases off) and minimal (google only,
 *                           premium off)
 *   me                      GET /api/v1/me: signed_out, free (premium_required),
 *                           credits7, subscriber (used/cap), fair_use (resetsAt),
 *                           no_credits
 *   clarifyResponse         POST /api/v1/clarify: two_questions, none
 *   evidenceResponse        POST /api/v1/evidence: {items} with ok, unreadable,
 *                           refused, unsupported, too_large, failed
 *   premiumVerdictResponse  response (premium verdict plus entitlement), accepted
 *                           (202 body) and polls {judging, failed_quota, ready}
 *                           (GET /api/v1/verdicts/{id}, lib/verdict-poll.ts)
 *   cases                   views (CaseView per state: waiting_for_respondent,
 *                           respondent_answered, judging, judged, judged_one_sided,
 *                           judged_tr, appeal_judging, appeal_upheld,
 *                           appeal_overturned, appeal_changed, failed, expired,
 *                           removed, waiting_free, judged_free), list (GET /api/v1/cases with next),
 *                           createResponse (POST /api/v1/cases) and appealResponse
 *   asyncErrors             {status, body} per code in the lib/api-errors.ts
 *                           envelope: signin_required, premium_required,
 *                           no_credits, fair_use, in_progress, appeal_used,
 *                           case_closed, removed, rate_limited
 *
 * Run from the repo root (needs `npm ci`): npx tsx mobile/shared/fixtures/export-fixtures.ts
 * Add --check to fail when the committed files are stale.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { cruxStyle } from "../../../lib/crux-style";
import { verdictLang } from "../../../lib/content-lang";
import { apiErrorMessage, formatWait, t, type Lang } from "../../../lib/i18n";
import { partyNames, personalizeResult, resolveParties, restoreNames } from "../../../lib/names";
import { svgRotateDeg } from "../../../lib/balance";
import { PRESETS } from "../../../lib/frameworks";
import { PALETTE, PALETTE_ALPHA } from "../../../lib/palette";
import { FINISH_CAPTION, FINISH_STEPS, MAX_FINISH_MS, READY, STILL_JUDGING, THINKING_STEPS } from "../../../lib/thinking";
import { KEY_BY_CAPTION } from "../../../lib/thinking-keys";
import { confidenceLabel, leanTally, tugFinal, verdictLabel } from "../../../lib/verdict-display";
import { applyText, checkSegments, extractText, planSegments, reassemble, unflattenText } from "../../../lib/translate";
import { z } from "zod";
import type { AppConfig as WebAppConfig, AuthProviders, Entitlement, MeResponse, SubscriptionView, Viewer } from "../../../lib/account-types";
import {
  CASE_POLL_MS,
  type AppealResponse,
  type CaseAppealView,
  type CaseListResponse,
  type CaseSideView,
  type CaseVerdictView,
  type CaseView,
  type CreateCaseResponse,
  type EvidenceItemResult,
  type EvidenceUploadResponse,
} from "../../../lib/case-types";
import type { DisplayState } from "../../../lib/originals-types";
import { PRICING } from "../../../lib/pricing";
import { POLL_AFTER_MS, type VerdictAcceptedResponse, type VerdictPollResponse } from "../../../lib/verdict-poll";
import {
  ClarifyResponse,
  FinalVerdict,
  TranslateResponse,
  VerdictResponse,
  VerdictResult as VerdictResultSchema,
  type AppealOutcome,
  type NameMapping,
  type VerdictResult,
} from "../../../lib/types";

/** GET /api/v1/verdicts/{id} (lib/types.ts has it as a type only). */
const StoredVerdictResponseSchema = z.object({
  id: z.string(),
  result: VerdictResultSchema,
  createdAt: z.string(),
});

const OUT_DIR = __dirname;
const REPO_DIR = resolve(__dirname, "../../..");
const LANGS: readonly Lang[] = ["en", "tr"];

const base = (over: Partial<VerdictResult>): VerdictResult => ({
  verdict: "side_a",
  dispute_type: "definitional",
  headline: "Nobody orders a sandwich hoping for a hot dog",
  crux: "Whether 'sandwich' follows shape or everyday use.",
  split_points: null,
  conditional: null,
  argument_map: {
    side_a: [{ claim: "Menus never list hot dogs as sandwiches", kind: "fact" }],
    side_b: [{ claim: "A filling in a split roll is a sandwich", kind: "definition" }],
    bedrock_a: "Words mean what people use them to mean",
    bedrock_b: "Definitions follow form",
  },
  facts_relied_on: ["Major menus list hot dogs separately from sandwiches"],
  losing_side_best_point: "A split roll with a filling does fit most dictionary definitions.",
  confidence: 4,
  runs: ["side_a", "side_a", "side_b"],
  demo: false,
  lang: "en",
  ...over,
});

const NARRATOR_EN: NameMapping[] = [
  { original: "I", replacement: "Party A" },
  { original: "Sam", replacement: "Party B" },
];

/** Sample bodies, one per rendering branch of the verdict card. */
const SAMPLES: Record<string, { response: VerdictResponse }> = {
  win_a_self: {
    response: { id: "abc123DEF0", result: base({ headline: "Party B is stretching the word, and Party A's menu test wins", crux: "Party B goes by shape; Party A goes by how people use the word.", losing_side_best_point: "Party B is right that Party A would struggle to define a sandwich without including it.", crux_trial: { attack: "Dictionaries disagree.", outcome: "survived", reasoning: "Usage wins here." } }), name_map: NARRATOR_EN },
  },
  win_b_named: {
    response: {
      id: "winB000001",
      result: base({ verdict: "side_b", runs: ["side_b", "side_b", "side_b"], confidence: 5 }),
      name_map: [
        { original: "Alex", replacement: "Party A" },
        { original: "Jordan", replacement: "Party B" },
      ],
    },
  },
  lean_b_majority_escalated: {
    response: {
      id: "lean000001",
      result: base({
        verdict: "too_close",
        confidence: 2,
        runs: ["side_a", "side_b", "split", "side_b", "side_b"],
        lean: { party: "b", unanimous: false, reason: "Party B's reading is closer to common use.", tally: { for: 4, against: 1 } },
        escalated: true,
      }),
      name_map: [],
    },
  },
  lean_tie: {
    response: { id: "tie0000001", result: base({ verdict: "too_close", confidence: 1, runs: ["side_a", "side_b"], lean: null }), name_map: [] },
  },
  conditional: {
    response: {
      id: "cond000001",
      result: base({
        verdict: "conditional",
        dispute_type: "values",
        runs: ["conditional", "conditional", "conditional"],
        conditional: [
          { if_value: "If honesty comes first", then: "Party B is right" },
          { if_value: "If kindness comes first", then: "Party A is right" },
        ],
        lean: { party: "a", unanimous: true, reason: "Small kindnesses keep friendships going." },
      }),
      name_map: [],
    },
  },
  split: {
    response: {
      id: "split00001",
      result: base({
        verdict: "split",
        dispute_type: "mixed",
        runs: ["split", "split", "side_a"],
        split_points: [
          { party: "a", point: "Botanically it is a fruit." },
          { party: "b", point: "In the kitchen it is a vegetable." },
        ],
        lean: { party: "a", unanimous: false, reason: "The question asked was botanical." },
      }),
      name_map: [],
    },
  },
  overturned_tr: {
    response: {
      id: "trial0001x",
      result: base({
        lang: "tr",
        dispute_type: "factual",
        headline: "Parmak çıtlatmak artrite yol açmıyor",
        crux: "Taraf B'nin korkusu kanıta dayanıyor mu, yoksa Taraf A haklı mı?",
        losing_side_best_point: "Bazı küçük çalışmalar şişlik bildiriyor.",
        crux_trial: { attack: "Uzun vadeli çalışma az.", outcome: "overturned", reasoning: "İtiraz yerinde." },
        confidence: 2,
      }),
      name_map: [
        { original: "Ben", replacement: "Taraf A" },
        { original: "annem", replacement: "Taraf B" },
      ],
    },
  },
  refused: {
    response: {
      id: "refused001",
      result: base({
        verdict: "too_close",
        dispute_type: "mixed",
        confidence: 1,
        model_refused: true,
        runs: [],
        headline: "The AI wouldn't weigh in on this one",
        argument_map: { side_a: [{ claim: "Skipped", kind: "logic" }], side_b: [{ claim: "Skipped", kind: "logic" }], bedrock_a: "—", bedrock_b: "—" },
        facts_relied_on: [],
      }),
      name_map: [],
    },
  },
  premium_factcheck: {
    response: {
      id: "premium001",
      result: base({
        tier: "premium",
        panel: { models: ["claude-sonnet-x", "claude-sonnet-x", "claude-haiku-x"] },
        fact_check: {
          status: "checked",
          claims: [{ claim: "Menus list hot dogs separately", status: "supported", summary: "Most do.", sources: [{ title: "Example", url: "https://example.com" }] }],
        },
      }),
      name_map: [],
    },
  },
};

/** Name maps for the party-label rules (lib/names.ts partyNames). */
const NAME_CASES: Record<string, { nameMap: NameMapping[]; selfLang: Lang }> = {
  empty: { nameMap: [], selfLang: "en" },
  narrator_en: { nameMap: NARRATOR_EN, selfLang: "en" },
  narrator_my: { nameMap: [{ original: "my", replacement: "Party A" }, { original: "Sam", replacement: "Party B" }], selfLang: "en" },
  narrator_tr_ben: { nameMap: [{ original: "Ben", replacement: "Taraf A" }, { original: "Deniz'in", replacement: "Taraf B'nin" }], selfLang: "tr" },
  ben_is_a_name_in_en: { nameMap: [{ original: "Ben", replacement: "Party A" }, { original: "Sam", replacement: "Party B" }], selfLang: "en" },
  ben_in_slot_b: { nameMap: [{ original: "I", replacement: "Party A" }, { original: "Ben", replacement: "Party B" }], selfLang: "tr" },
  description_then_name: { nameMap: [{ original: "my roommate", replacement: "Party B" }, { original: "Chris", replacement: "Party B" }, { original: "Mark's", replacement: "Party A" }], selfLang: "en" },
  person_c_ignored: { nameMap: [{ original: "Ayşe", replacement: "Kişi C" }], selfLang: "tr" },
};

/**
 * Turkish text for win_a_self, one string per segment the server sends
 * (lib/translate.ts planSegments order: headline, crux, side_a, side_b,
 * bedrock_a, bedrock_b, facts_relied_on, losing_side_best_point,
 * crux_trial attack and reasoning), written the way the translator is told
 * to: faithful, natural, labels as "Taraf A/B" with their suffixes.
 */
const WIN_A_SELF_TR = [
  "Taraf B kelimenin anlamını zorluyor, Taraf A'nın menü testi kazanıyor",
  "Taraf B için ölçüt biçim; Taraf A için ise insanların kelimeyi nasıl kullandığı.",
  "Menüler sosisliyi asla sandviç olarak listelemez",
  "Ortadan kesilmiş ekmeğin arasına konan her şey sandviçtir",
  "Kelimeler, insanların onlara yüklediği anlama gelir",
  "Tanımlar biçime göre yapılır",
  "Büyük zincirlerin menüleri sosisliyi sandviçlerden ayrı listeliyor",
  "Taraf B şu konuda haklı: sosisliyi dışarıda bırakan bir sandviç tanımı yapmak Taraf A için zor olurdu.",
  "Sözlükler aynı fikirde değil.",
  "Burada kullanım ağır basıyor.",
];

/** A translation built the way lib/translate.ts translateResult builds one:
 * the reply passes the server's own checkSegments, then applyText puts it
 * back, so only free text changes and labels are mapped. */
function serverTranslation(result: VerdictResult, target: Lang, texts: string[]): VerdictResult {
  const text = extractText(result);
  const plan = planSegments(text, target);
  const checked = checkSegments(plan.segments, { segments: texts.map((s, i) => ({ i, text: s })) }, target);
  if (!checked.ok) throw new Error(`fixture translation rejected: ${checked.error}`);
  return applyText(result, unflattenText(text, reassemble(plan, checked.texts)), target);
}

const TRANSLATED_WIN_A_SELF = serverTranslation(SAMPLES.win_a_self.response.result, "tr", WIN_A_SELF_TR);

/**
 * Every free-text field personalizeResult rewrites, flattened:
 *   headline, crux, losing_side_best_point, bedrock_a, bedrock_b: string
 *   side_a, side_b, facts_relied_on: string[] (claim texts, in order)
 *   split_points: string[] | null (the points)
 *   conditional_if_value, conditional_then: string[] | null (same length)
 *   lean_reason, crux_trial_attack, crux_trial_reasoning: string | null
 *   fact_check_claims, fact_check_summaries: string[] | null (same length)
 */
function personalizedFields(r: VerdictResult, nameMap: NameMapping[], selfLang: Lang) {
  const p = personalizeResult(r, nameMap, selfLang);
  return {
    headline: p.headline,
    crux: p.crux,
    losing_side_best_point: p.losing_side_best_point,
    side_a: p.argument_map.side_a.map((c) => c.claim),
    side_b: p.argument_map.side_b.map((c) => c.claim),
    bedrock_a: p.argument_map.bedrock_a,
    bedrock_b: p.argument_map.bedrock_b,
    facts_relied_on: p.facts_relied_on,
    split_points: p.split_points?.map((s) => s.point) ?? null,
    conditional_if_value: p.conditional?.map((c) => c.if_value) ?? null,
    conditional_then: p.conditional?.map((c) => c.then) ?? null,
    lean_reason: p.lean?.reason ?? null,
    crux_trial_attack: p.crux_trial?.attack ?? null,
    crux_trial_reasoning: p.crux_trial?.reasoning ?? null,
    fact_check_claims: p.fact_check?.claims.map((c) => c.claim) ?? null,
    fact_check_summaries: p.fact_check?.claims.map((c) => c.summary) ?? null,
  };
}

const nm = (a: string, ra: string, b?: string, rb?: string, ...rest: NameMapping[]): NameMapping[] => [
  { original: a, replacement: ra },
  ...(b && rb ? [{ original: b, replacement: rb }] : []),
  ...rest,
];
const PERSON_C_AYSE: NameMapping = { original: "Ayşe", replacement: "Kişi C" };
const NAMED_EN = nm("Alex", "Party A", "Jordan", "Party B");
const NARRATOR_TR = nm("Ben", "Taraf A", "Deniz'in", "Taraf B'nin");
const BURAK_AYSE = nm("Burak", "Taraf A", "Ayşe", "Taraf B");

/** restoreNames inputs, one or more per branch of lib/names.ts renderEn,
 * enSelf, renderTr, trSelf and trSuffix. */
const RESTORE_CASES: { text: string; nameMap: NameMapping[]; selfLang: Lang; textLang: Lang }[] = [
  // English narrator: agreement after "you".
  { text: "Party A is right about the menus.", nameMap: NARRATOR_EN, selfLang: "en", textLang: "en" },
  { text: "Party B says Party A was late.", nameMap: NARRATOR_EN, selfLang: "en", textLang: "en" },
  { text: "Party A has a point, but Party A doesn't see it.", nameMap: NARRATOR_EN, selfLang: "en", textLang: "en" },
  { text: "Party A isn't wrong, but Party A didn't ask.", nameMap: NARRATOR_EN, selfLang: "en", textLang: "en" },
  { text: "Party A can't prove it, and Party A should apologize.", nameMap: NARRATOR_EN, selfLang: "en", textLang: "en" },
  { text: "Party A ignored the menus.", nameMap: NARRATOR_EN, selfLang: "en", textLang: "en" },
  { text: "Party A wants a sandwich; Party B wants a hot dog.", nameMap: NARRATOR_EN, selfLang: "en", textLang: "en" },
  { text: "This is the thing Party A wants.", nameMap: NARRATOR_EN, selfLang: "en", textLang: "en" },
  { text: "Party B knows that Party A tries hard.", nameMap: NARRATOR_EN, selfLang: "en", textLang: "en" },
  { text: "Party B and Party A are both wrong.", nameMap: NARRATOR_EN, selfLang: "en", textLang: "en" },
  // Possessive, preposition object, end of sentence, quotes.
  { text: "Party A's menu test wins.", nameMap: NARRATOR_EN, selfLang: "en", textLang: "en" },
  { text: "Party B owes an apology to Party A.", nameMap: NARRATOR_EN, selfLang: "en", textLang: "en" },
  { text: "Person C told Party A the truth, and Party B tries harder than Party A.", nameMap: nm("I", "Party A", "Sam", "Party B", PERSON_C_AYSE), selfLang: "en", textLang: "en" },
  { text: "\"Party A is late,\" said Party B.", nameMap: NARRATOR_EN, selfLang: "en", textLang: "en" },
  // Kept labels: nothing settles the sentence shape.
  { text: "Party B gives Party A points.", nameMap: NARRATOR_EN, selfLang: "en", textLang: "en" },
  { text: "Party A, frankly, is wrong.", nameMap: NARRATOR_EN, selfLang: "en", textLang: "en" },
  { text: "Party A was and is stubborn.", nameMap: NARRATOR_EN, selfLang: "en", textLang: "en" },
  { text: "Party A alone decides.", nameMap: NARRATOR_EN, selfLang: "en", textLang: "en" },
  // Named parties, curly apostrophe, a Turkish suffix left in English text.
  { text: "Party A's plan beats Party B's, and Party A knows it.", nameMap: NAMED_EN, selfLang: "en", textLang: "en" },
  { text: "Party B’s point stands.", nameMap: NARRATOR_EN, selfLang: "en", textLang: "en" },
  { text: "Party B'nin point was sent to Party A'ya.", nameMap: NARRATOR_EN, selfLang: "en", textLang: "en" },
  // Not labels: glued, wrong letter for the word, no name for the slot.
  { text: "Party AB and xParty A are not labels, Party C and Person A neither, but Party B is.", nameMap: NARRATOR_EN, selfLang: "en", textLang: "en" },
  { text: "Party A is right and Person C agrees.", nameMap: [], selfLang: "en", textLang: "en" },
  // A Turkish narrator in English text.
  { text: "Party A is right and Party B's idea fails.", nameMap: NARRATOR_TR, selfLang: "tr", textLang: "en" },
  // Turkish narrator: "sen" forms.
  { text: "Taraf A haklı.", nameMap: NARRATOR_TR, selfLang: "tr", textLang: "tr" },
  { text: "Bu konuda Taraf A kesinlikle haklı, Taraf B ise haksız.", nameMap: NARRATOR_TR, selfLang: "tr", textLang: "tr" },
  { text: "Taraf A haklıydı. Taraf A haklı bir noktaya değinmedi.", nameMap: NARRATOR_TR, selfLang: "tr", textLang: "tr" },
  { text: "Taraf B, Taraf A'ya borçlu ve Taraf A'yı suçluyor.", nameMap: NARRATOR_TR, selfLang: "tr", textLang: "tr" },
  { text: "Taraf B, Taraf A'dan özür dilemeli; Taraf A'da da haklılık payı var.", nameMap: NARRATOR_TR, selfLang: "tr", textLang: "tr" },
  { text: "Taraf A'yla konuşmak gerek, Taraf A'daki inat belli.", nameMap: NARRATOR_TR, selfLang: "tr", textLang: "tr" },
  { text: "Bu karar Taraf A için iyi. Taraf A'ya göre menü belirleyici.", nameMap: NARRATOR_TR, selfLang: "tr", textLang: "tr" },
  { text: "Taraf A açısından ölçüt kullanım, Taraf A ile Taraf B ise anlaşamıyor.", nameMap: NARRATOR_TR, selfLang: "tr", textLang: "tr" },
  { text: "Taraf A'nın istediği şey açık: Taraf A'nın gelmesi ve Taraf A'nın yapmasına izin verilmesi.", nameMap: NARRATOR_TR, selfLang: "tr", textLang: "tr" },
  { text: "Taraf A'nınki daha mantıklı.", nameMap: NARRATOR_TR, selfLang: "tr", textLang: "tr" },
  // Turkish narrator: kept labels.
  { text: "Taraf A'nın menü testi kazanıyor, Taraf A'nın çoğu iddiası doğru.", nameMap: NARRATOR_TR, selfLang: "tr", textLang: "tr" },
  { text: "Taraf A şunu söylüyor: haklı olan Taraf A'ydı. Yanılan Taraf B'ydi.", nameMap: NARRATOR_TR, selfLang: "tr", textLang: "tr" },
  // An English narrator in Turkish text; a placeholder with a suffix.
  { text: "Taraf A büyük ölçüde haklı, Taraf B'nin itirazı zayıf.", nameMap: NARRATOR_EN, selfLang: "en", textLang: "tr" },
  { text: "Person C'ye göre Taraf A haklı; Kişi C'nin annesi de öyle düşünüyor.", nameMap: [...NARRATOR_TR, PERSON_C_AYSE], selfLang: "tr", textLang: "tr" },
  // Named Turkish parties: harmony, buffer letters, d -> t after a voiceless consonant.
  { text: "Taraf A'nın görüşü güçlü, Taraf B'nin değil; söz Taraf A'ya ve Taraf B'ye verildi.", nameMap: BURAK_AYSE, selfLang: "tr", textLang: "tr" },
  { text: "Taraf A'da ve Taraf B'de, Taraf A'dan ve Taraf B'den, Taraf A'yı ve Taraf B'yi.", nameMap: BURAK_AYSE, selfLang: "tr", textLang: "tr" },
  { text: "Taraf A'yla Taraf B'yle; Taraf A'dır, Taraf B'dir; Taraf A'yken, Taraf B'ymiş; Taraf A'daki, Taraf B'ninki.", nameMap: BURAK_AYSE, selfLang: "tr", textLang: "tr" },
  { text: "Party B's görüşü zayıf, Taraf B’ye sorulmalı, Taraf A ise haklı.", nameMap: BURAK_AYSE, selfLang: "tr", textLang: "tr" },
  { text: "Taraf A'nın ve Taraf B'nin; Taraf A'da, Taraf B'ye; Taraf A'dan, Taraf B'yi.", nameMap: nm("Umut", "Taraf A", "Gül", "Taraf B"), selfLang: "tr", textLang: "tr" },
  { text: "Taraf A'nın ve Taraf B'nin; Taraf A'ya, Taraf B'de; Taraf A'dır, Taraf B'yle.", nameMap: nm("Kemal", "Taraf A", "Övünç", "Taraf B"), selfLang: "tr", textLang: "tr" },
  { text: "Taraf A'nın ve Taraf B'nin; Taraf A'yı, Taraf B'ye; Taraf A'daydı, Taraf B'ydi.", nameMap: nm("Ömer", "Taraf A", "Derya", "Taraf B"), selfLang: "tr", textLang: "tr" },
  { text: "Taraf B'nin sözü geçmiyor, Taraf B haklı değil.", nameMap: nm("Burak", "Taraf A", "JJ", "Taraf B"), selfLang: "tr", textLang: "tr" },
];

const WAIT_SECONDS = [null, 0, -5, 1, 59, 60, 61, 600, 5340, 5400, 5401, 7200, 86400];

const ERROR_BODIES: { body: unknown; status?: number }[] = [
  { body: { error: "x", code: "too_short" }, status: 400 },
  { body: { error: "x", code: "too_long" }, status: 400 },
  { body: { error: "x", code: "invalid" }, status: 400 },
  { body: { error: "x", code: "rate_limited", retryAfterSec: 420 }, status: 429 },
  { body: { error: "x", code: "daily_cap", retryAfterSec: 30000 }, status: 503 },
  { body: { error: "x", code: "quota" }, status: 502 },
  { body: { error: "x", code: "unavailable" }, status: 503 },
  { body: { error: "x", code: "captcha_failed" }, status: 403 },
  { body: { error: "x", code: "not_found" }, status: 404 },
  { body: { error: "x", code: "fair_use", resetsAt: "2026-11-18T10:00:00.000Z" }, status: 402 },
  { body: { error: "x", code: "fair_use" }, status: 402 },
  { body: null, status: 429 },
  { body: { error: "Some new server message", code: "brand_new_code" }, status: 500 },
  { body: null, status: 500 },
];

// --- Premium, account and case fixtures ------------------------------------------

// This worktree's lib/account-types.ts and lib/api-errors.ts predate the live
// site's, so the two differences the fixtures need are spelled out here.
/** Live AppConfig: the emailed-code sign-in flag and the feature switches. */
type AppConfig = Omit<WebAppConfig, "signIn"> & {
  signIn: AuthProviders & { emailCode: boolean };
  features?: { cases: boolean; evidence: boolean };
};
/** Live lib/api-errors.ts envelope and default statuses for the codes below. */
type AsyncErrorCode =
  | "signin_required" | "premium_required" | "no_credits" | "fair_use" | "in_progress"
  | "appeal_used" | "case_closed" | "removed" | "rate_limited";
type AsyncErrorBody = { error: string; code: AsyncErrorCode; retryAfterSec?: number; resetsAt?: string };
const ASYNC_ERROR_STATUS: Record<AsyncErrorCode, number> = {
  signin_required: 401,
  premium_required: 402,
  no_credits: 402,
  fair_use: 402,
  in_progress: 409,
  appeal_used: 409,
  case_closed: 409,
  removed: 410,
  rate_limited: 429,
};

const T0 = "2026-10-20T09:00:00.000Z";
const PERIOD_START = "2026-10-01T00:00:00.000Z";
const PERIOD_END = "2026-10-31T00:00:00.000Z";
const NO_SUB: Entitlement = { canUsePremium: false, blockedReason: null, credits: 0, subscription: null, resetsAt: null };
const subscription = (used: number): SubscriptionView => ({
  source: "app_store",
  productId: "monthly",
  periodStart: PERIOD_START,
  periodEnd: PERIOD_END,
  willRenew: true,
  used,
  cap: 35,
});

const ENTITLEMENTS: Record<string, Entitlement> = {
  free: { ...NO_SUB, blockedReason: "premium_required" },
  credits7: { ...NO_SUB, canUsePremium: true, credits: 7 },
  no_credits: { ...NO_SUB, blockedReason: "no_credits" },
  subscriber: { canUsePremium: true, blockedReason: null, credits: 0, subscription: subscription(12), resetsAt: null },
  fair_use: { canUsePremium: false, blockedReason: "fair_use", credits: 0, subscription: subscription(35), resetsAt: PERIOD_END },
};

const viewer = (id: string, name: string, email: string): Viewer => ({ id, email, name, image: null });

const ME_BODIES: Record<string, MeResponse> = {
  signed_out: { user: null, entitlement: null },
  free: { user: viewer("usr_sam0001", "Sam", "sam@example.com"), entitlement: ENTITLEMENTS.free },
  credits7: { user: viewer("usr_alex001", "Alex", "alex@example.com"), entitlement: ENTITLEMENTS.credits7 },
  subscriber: { user: viewer("usr_jordan1", "Jordan", "jordan@example.com"), entitlement: ENTITLEMENTS.subscriber },
  fair_use: { user: viewer("usr_deniz01", "Deniz", "deniz@example.com"), entitlement: ENTITLEMENTS.fair_use },
  no_credits: { user: viewer("usr_ayse001", "Ayşe", "ayse@example.com"), entitlement: ENTITLEMENTS.no_credits },
};

const pricing = (): AppConfig["pricing"] => ({
  currency: "USD",
  purchasesEnabled: false,
  packs: PRICING.packs.map((p) => ({ ...p })),
  monthly: { ...PRICING.monthly },
});

const CONFIG_BODIES: Record<string, AppConfig> = {
  full: {
    signIn: { apple: true, google: true, email: true, emailCode: true, dev: false },
    premiumEnabled: true,
    pricing: pricing(),
    features: { cases: true, evidence: true },
  },
  minimal: {
    signIn: { apple: false, google: true, email: false, emailCode: false, dev: false },
    premiumEnabled: false,
    pricing: pricing(),
    features: { cases: false, evidence: false },
  },
};

const CLARIFY_BODIES = {
  two_questions: ClarifyResponse.parse({
    questions: [
      { id: "q1", text: "Did you and Sam ever agree on what counts as a sandwich?" },
      { id: "q2", text: "Is this about the menu wording or about what you were served?" },
    ],
  }),
  none: ClarifyResponse.parse({ questions: [] }),
};

const EVIDENCE_TOKEN = "ev1.eyJhIjoidXNyXzEiLCJrIjoiY2hhdCIsImUiOjE3OTI1NzYwMDB9.q3Zk0pYb7wH2mT9sVxN1cLd8RfUe4JgA6oBiXyKnM5E";
const EVIDENCE_ITEMS: EvidenceItemResult[] = [
  {
    index: 0,
    status: "ok",
    kind: "chat",
    token: EVIDENCE_TOKEN,
    preview: "Sam: it's a hot dog, not a sandwich\nMe: it's a filling in bread, that's a sandwich\nSam: then a taco is a sandwich too?",
    expiresAt: "2026-10-20T10:00:00.000Z",
  },
  { index: 1, status: "unreadable", kind: null, token: null, preview: null, expiresAt: null },
  { index: 2, status: "refused", kind: null, token: null, preview: null, expiresAt: null },
  { index: 3, status: "unsupported", kind: null, token: null, preview: null, expiresAt: null },
  { index: 4, status: "too_large", kind: null, token: null, preview: null, expiresAt: null },
  { index: 5, status: "failed", kind: null, token: null, preview: null, expiresAt: null },
];

const PREMIUM_ID = SAMPLES.premium_factcheck.response.id;
const PREMIUM_ENTITLEMENT: Entitlement = { ...ENTITLEMENTS.subscriber, subscription: subscription(13) };
const PREMIUM_RESPONSE = { ...SAMPLES.premium_factcheck.response, entitlement: PREMIUM_ENTITLEMENT };
const PREMIUM_ACCEPTED: VerdictAcceptedResponse = {
  id: PREMIUM_ID,
  status: "judging",
  pollAfterMs: POLL_AFTER_MS,
  poll: `/api/v1/verdicts/${PREMIUM_ID}`,
  name_map: [],
  suggested_display_a: null,
  entitlement: PREMIUM_ENTITLEMENT,
};
const PREMIUM_POLLS: Record<string, VerdictPollResponse> = {
  judging: { id: PREMIUM_ID, status: "judging", pollAfterMs: POLL_AFTER_MS },
  failed_quota: { id: PREMIUM_ID, status: "failed", code: "quota", error: "The judges are busy right now. Your credit was not used." },
  ready: {
    id: PREMIUM_ID,
    status: "ready",
    result: SAMPLES.premium_factcheck.response.result,
    createdAt: T0,
    owner: { originals_stored: true, display: { namesVisible: true, a: null, b: null, others: {} } },
  },
};

// Cases ----------------------------------------------------------------------------

const CASE_ID = "case0000001";
const INVITE = "https://okjudge.com/r/Xk3pQ9vLm2Rt7YbN4cWd0A";
const CASE_NAMES: NameMapping[] = [
  { original: "I", replacement: "Party A" },
  { original: "Sam", replacement: "Party B" },
];
const RESPONDENT_NAMES: NameMapping[] = [
  { original: "I", replacement: "Party B" },
  { original: "Alex", replacement: "Party A" },
];
const SIDE_A_TEXT = "Party B says a hot dog is a sandwich. I say nobody orders a sandwich hoping for a hot dog, and every menu lists them apart.";
const SIDE_B_TEXT = "Party A is stubborn. A filling inside a split roll is a sandwich by any dictionary, and Party A knows it.";
const JUDGED_AT = "2026-10-20T11:05:00.000Z";

const sideA = (over: Partial<CaseSideView> = {}): CaseSideView => ({ party: "a", text: SIDE_A_TEXT, evidence: [], submittedAt: T0, ...over });
const sideB = (over: Partial<CaseSideView> = {}): CaseSideView => ({
  party: "b",
  text: SIDE_B_TEXT,
  evidence: [{ id: "ev_b1", kind: "chat", transcript: "Party A: it's a sandwich\nParty B: it's a hot dog" }],
  submittedAt: "2026-10-20T11:00:00.000Z",
  ...over,
});

const twoSided = (over: Partial<VerdictResult> = {}): VerdictResult =>
  base({
    two_sided: true,
    tier: "premium",
    headline: "Party A's menu test settles it",
    agreed_facts: ["Both agree a hot dog is meat in a split roll.", "Both agree menus list hot dogs separately."],
    disputed_facts: [
      { fact: "Whether a dictionary definition covers a hot dog", party_a: "No, definitions assume sliced bread.", party_b: "Yes, any filling in bread counts.", finding: "a", decisive: true },
      { fact: "Who started the argument", party_a: "Party B did.", party_b: "Party A did.", finding: "unsettled", decisive: false },
    ],
    would_change: ["A dictionary entry naming hot dogs as sandwiches."],
    evidence_used: { a: 0, b: 1 },
    ...over,
  });

const appealInfo = (outcome: AppealOutcome, confChange: number, summary: string): NonNullable<VerdictResult["appeal"]> => ({
  by: "b",
  outcome,
  previous_id: "caseverd01",
  previous_verdict: "side_a",
  previous_confidence: 4,
  confidence_change: confChange,
  summary,
});

const caseVerdict = (seq: number, id: string, result: VerdictResult, appealId: string | null = null): CaseVerdictView => ({
  seq,
  id,
  result,
  appealId,
  createdAt: seq === 1 ? JUDGED_AT : "2026-10-20T14:00:00.000Z",
});
const FIRST_VERDICT = caseVerdict(1, "caseverd01", twoSided());

const appealRow = (over: Partial<CaseAppealView> = {}): CaseAppealView => ({
  id: "appeal00001",
  party: "b",
  status: "judging",
  error: null,
  text: "The judges ignored the dictionary I attached: it lists any filling in bread as a sandwich.",
  evidence: [],
  outcome: null,
  verdictId: null,
  createdAt: "2026-10-20T13:50:00.000Z",
  ...over,
});

const caseView = (over: Partial<CaseView> = {}): CaseView => ({
  id: CASE_ID,
  role: "owner",
  yourParty: "a",
  status: "awaiting_respondent",
  mode: null,
  tier: "premium",
  lang: "en",
  framework: { preset: "balanced" },
  createdAt: T0,
  expiresAt: "2026-10-27T09:00:00.000Z",
  judgedAt: null,
  respondentAnswered: false,
  inviteUrl: null,
  ownInvite: false,
  sides: [sideA()],
  verdicts: [],
  appeals: [],
  canJudgeNow: false,
  appeal: { allowed: false, blockedBy: "not_judged" },
  lastError: null,
  pollAfterMs: null,
  names: CASE_NAMES,
  display: { namesVisible: true, a: null, b: null },
  removed: null,
  yourOriginal: "stored",
  ...over,
});

const judgedCase = (over: Partial<CaseView> = {}): CaseView =>
  caseView({
    status: "judged",
    mode: "two_sided",
    judgedAt: JUDGED_AT,
    respondentAnswered: true,
    sides: [sideA(), sideB()],
    verdicts: [FIRST_VERDICT],
    appeal: { allowed: true, blockedBy: null },
    display: { namesVisible: true, a: "Alex", b: "Sam" },
    ...over,
  });

const appealedCase = (outcome: AppealOutcome, result: VerdictResult): CaseView =>
  judgedCase({
    verdicts: [FIRST_VERDICT, caseVerdict(2, "caseverd02", result, "appeal00001")],
    appeals: [appealRow({ status: "judged", outcome, verdictId: "caseverd02" })],
    appeal: { allowed: false, blockedBy: "appeal_used" },
  });

const CASE_VIEWS: Record<string, CaseView> = {
  waiting_for_respondent: caseView({ inviteUrl: INVITE, canJudgeNow: true }),
  respondent_answered: caseView({
    role: "respondent",
    yourParty: "b",
    status: "judging",
    mode: "two_sided",
    respondentAnswered: true,
    sides: [sideB({ evidence: [] })],
    pollAfterMs: CASE_POLL_MS,
    names: RESPONDENT_NAMES,
  }),
  judging: caseView({ status: "judging", mode: "two_sided", respondentAnswered: true, pollAfterMs: CASE_POLL_MS }),
  judged: judgedCase(),
  judged_one_sided: caseView({
    status: "judged",
    mode: "one_sided",
    judgedAt: JUDGED_AT,
    verdicts: [caseVerdict(1, "caseverd09", base({ tier: "premium", evidence_used: { a: 0, b: 0 } }))],
    appeal: { allowed: false, blockedBy: "premium_required" },
  }),
  judged_tr: judgedCase({
    lang: "tr",
    sides: [
      sideA({ text: "Taraf B sosisli sandviçin sandviç olduğunu söylüyor. Ben ise kimsenin sosisli bekleyerek sandviç sipariş etmediğini düşünüyorum." }),
      sideB({ text: "Taraf A inatçı. Ortadan kesilmiş ekmeğin içindeki her dolgu sözlüğe göre sandviçtir.", evidence: [] }),
    ],
    verdicts: [
      caseVerdict(
        1,
        "caseverd03",
        twoSided({
          lang: "tr",
          headline: "Taraf A'nın menü testi meseleyi çözüyor",
          crux: "'Sandviç' kelimesi biçimi mi yoksa günlük kullanımı mı izler?",
          agreed_facts: ["İkisi de sosislinin bölünmüş ekmekte et olduğunu kabul ediyor."],
          disputed_facts: [{ fact: "Sözlük tanımının sosisliyi kapsayıp kapsamadığı", party_a: "Hayır.", party_b: "Evet.", finding: "a", decisive: true }],
          would_change: ["Sosisliyi sandviç sayan bir sözlük maddesi."],
          evidence_used: { a: 0, b: 0 },
        }),
      ),
    ],
    display: { namesVisible: true, a: null, b: null },
  }),
  appeal_judging: judgedCase({ appeals: [appealRow()], appeal: { allowed: false, blockedBy: "busy" }, pollAfterMs: CASE_POLL_MS }),
  appeal_upheld: appealedCase(
    "upheld",
    twoSided({ appeal: appealInfo("upheld", 0, "The appeal added no new fact, so the ruling stands with the same confidence.") }),
  ),
  appeal_overturned: appealedCase(
    "overturned",
    twoSided({
      verdict: "side_b",
      runs: ["side_b", "side_b", "side_a"],
      confidence: 3,
      headline: "On appeal, Party B's dictionary wins",
      appeal: appealInfo("overturned", -1, "The dictionary evidence shows hot dogs fit the definition, so the ruling flips to Party B."),
    }),
  ),
  appeal_changed: appealedCase(
    "changed",
    twoSided({
      verdict: "split",
      dispute_type: "mixed",
      runs: ["split", "split", "side_a"],
      confidence: 3,
      headline: "On appeal, both have part of the answer",
      split_points: [
        { party: "a", point: "In everyday use a hot dog is not a sandwich." },
        { party: "b", point: "By the dictionary it is." },
      ],
      appeal: appealInfo("changed", -1, "The new evidence narrows the point at issue, so the verdict becomes split."),
    }),
  ),
  failed: caseView({ status: "failed", mode: "two_sided", respondentAnswered: true, lastError: "quota", canJudgeNow: true }),
  expired: caseView({ status: "expired" }),
  removed: judgedCase({
    sides: [sideA({ text: "", removed: true }), sideB()],
    appeal: { allowed: false, blockedBy: "not_party" },
    removed: { at: "2026-10-21T08:00:00.000Z", parties: ["a"] },
    names: null,
    yourOriginal: "removed",
  }),
  waiting_free: caseView({ tier: "free", inviteUrl: INVITE, canJudgeNow: true }),
  judged_free: judgedCase({
    tier: "free",
    sides: [sideA(), sideB({ evidence: [] })],
    verdicts: [caseVerdict(1, "caseverd04", twoSided({ tier: "free", evidence_used: { a: 0, b: 0 } }))],
  }),
};

const CASE_LIST: CaseListResponse = {
  cases: [
    {
      id: "case0000001",
      status: "awaiting_respondent",
      mode: null,
      createdAt: T0,
      expiresAt: "2026-10-27T09:00:00.000Z",
      respondentAnswered: false,
      verdict: null,
      headline: null,
      excerpt: "Party B says a hot dog is a sandwich. I say nobody orders a sandwich hoping",
      removed: false,
    },
    {
      id: "case0000002",
      status: "judged",
      mode: "two_sided",
      createdAt: "2026-10-18T17:30:00.000Z",
      expiresAt: "2026-10-25T17:30:00.000Z",
      respondentAnswered: true,
      verdict: "side_a",
      headline: "Party A's menu test settles it",
      excerpt: "We split rent unevenly because my room is bigger, and Party B never agreed to",
      removed: false,
    },
    {
      id: "case0000003",
      status: "judged",
      mode: "one_sided",
      createdAt: "2026-10-15T08:10:00.000Z",
      expiresAt: "2026-10-22T08:10:00.000Z",
      respondentAnswered: false,
      verdict: "too_close",
      headline: "Too close to call on the borrowed car",
      excerpt: null,
      removed: true,
    },
  ],
  next: "eyJjIjoiMjAyNi0xMC0xNVQwODoxMDowMC4wMDBaIiwiaSI6ImNhc2UwMDAwMDAzIn0",
};

const CREATE_CASE_RESPONSE: CreateCaseResponse = {
  case: CASE_VIEWS.waiting_for_respondent,
  name_map: CASE_NAMES,
  entitlement: PREMIUM_ENTITLEMENT,
};
const APPEAL_RESPONSE: AppealResponse = {
  case: CASE_VIEWS.appeal_judging,
  name_map: RESPONDENT_NAMES,
  entitlement: { ...ENTITLEMENTS.credits7, credits: 6 },
};

/** Fails the export on a case body that the zod schemas or the view's own rules reject. */
function validateCases(): void {
  const views: [string, CaseView][] = [
    ...Object.entries(CASE_VIEWS),
    ["createResponse", CREATE_CASE_RESPONSE.case],
    ["appealResponse", APPEAL_RESPONSE.case],
  ];
  for (const [name, v] of views) {
    for (const verdict of v.verdicts) {
      const p = VerdictResultSchema.safeParse(verdict.result);
      if (!p.success) throw new Error(`case ${name} verdict ${verdict.id} is not a valid VerdictResult: ${p.error.message}`);
    }
    for (const a of v.appeals) {
      if (a.verdictId && !v.verdicts.some((x) => x.id === a.verdictId)) throw new Error(`case ${name}: appeal ${a.id} points at a missing verdict`);
    }
    const busy = v.status === "judging" || v.appeals.some((a) => a.status === "judging");
    if (busy !== (v.pollAfterMs !== null)) throw new Error(`case ${name}: pollAfterMs must be set exactly while something is judging`);
  }
  for (const c of CASE_LIST.cases) {
    if (c.verdict !== null && !FinalVerdict.safeParse(c.verdict).success) throw new Error(`case list ${c.id}: bad verdict`);
  }
}

const ASYNC_ERRORS = Object.fromEntries(
  (
    [
      ["signin_required", "Sign in to use Premium."],
      ["premium_required", "This needs Premium."],
      ["no_credits", "You are out of credits."],
      ["fair_use", "You have used this period's fair-use allowance.", { resetsAt: PERIOD_END }],
      ["in_progress", "A verdict with this key is already being judged."],
      ["appeal_used", "This side has already appealed."],
      ["case_closed", "This case is closed."],
      ["removed", "This was removed."],
      ["rate_limited", "Too many requests. Try again shortly.", { retryAfterSec: 420 }],
    ] as [AsyncErrorCode, string, Omit<AsyncErrorBody, "code" | "error">?][]
  ).map(([code, msg, extra]) => [code, { status: ASYNC_ERROR_STATUS[code], body: { error: msg, code, ...extra } satisfies AsyncErrorBody }]),
);

/** The new top-level keys of verdicts.json, validated. */
function premiumFixtures() {
  const checked = VerdictResponse.safeParse(PREMIUM_RESPONSE);
  if (!checked.success) throw new Error(`premium verdict is not a valid VerdictResponse: ${checked.error.message}`);
  validateCases();
  return {
    config: CONFIG_BODIES,
    me: ME_BODIES,
    clarifyResponse: CLARIFY_BODIES,
    evidenceResponse: { items: EVIDENCE_ITEMS } satisfies EvidenceUploadResponse,
    premiumVerdictResponse: { response: PREMIUM_RESPONSE, accepted: PREMIUM_ACCEPTED, polls: PREMIUM_POLLS },
    cases: { views: CASE_VIEWS, list: CASE_LIST, createResponse: CREATE_CASE_RESPONSE, appealResponse: APPEAL_RESPONSE },
    asyncErrors: ASYNC_ERRORS,
  };
}

function displayVectors() {
  const verdicts = Object.entries(SAMPLES).flatMap(([name, { response }]) =>
    LANGS.map((lang) => {
      const r = response.result;
      const selfLang = verdictLang(r);
      const p = partyNames(response.name_map, lang, selfLang);
      const lean = r.lean;
      return {
        sample: name,
        lang,
        selfLang,
        ...p,
        label: verdictLabel(r, p.nameA, p.nameB, p.aIsSelf, p.bIsSelf, lang),
        confidence: confidenceLabel(lang, r),
        tugA: tugFinal(r),
        svgRotateDeg: Math.round(svgRotateDeg(tugFinal(r)) * 1000) / 1000,
        cruxStyle: cruxStyle(r.crux),
        leanTally: lean ? leanTally(lean, r.runs.length) : null,
        shareUrl: `https://okjudge.com/v/${response.id}`,
        personalized: personalizedFields(r, response.name_map, selfLang),
      };
    }),
  );
  const names = Object.entries(NAME_CASES).flatMap(([name, c]) =>
    LANGS.map((lang) => ({ case: name, lang, selfLang: c.selfLang, nameMap: c.nameMap, ...partyNames(c.nameMap, lang, c.selfLang) })),
  );
  const waits = WAIT_SECONDS.flatMap((s) => LANGS.map((lang) => ({ seconds: s, lang, text: formatWait(lang, s) })));
  const errors = ERROR_BODIES.flatMap((e) =>
    LANGS.map((lang) => ({ ...e, lang, message: apiErrorMessage(lang, e.body, e.status) })),
  );
  // Constants the apps copy by hand, pinned here so a web change fails their tests.
  const presets = PRESETS.map(({ id, emoji }) => ({ id, emoji }));
  const thinking = {
    steps: THINKING_STEPS.map((s) => ({ ms: s.ms, key: KEY_BY_CAPTION[s.caption] })),
    finishSteps: FINISH_STEPS,
    maxFinishMs: MAX_FINISH_MS,
    finishKey: KEY_BY_CAPTION[FINISH_CAPTION],
    stillJudgingKey: KEY_BY_CAPTION[STILL_JUDGING],
    readyKey: KEY_BY_CAPTION[READY],
  };
  const restore = RESTORE_CASES.map((c) => ({
    ...c,
    expected: restoreNames(c.text, resolveParties(c.nameMap, c.selfLang), c.textLang),
  }));
  // The fixture translation as its author sees it: grammar follows the
  // Turkish text, the narrator follows the language it was judged in.
  const original = SAMPLES.win_a_self.response;
  const personalizedTranslations = [
    {
      sample: "win_a_self",
      lang: verdictLang(TRANSLATED_WIN_A_SELF),
      selfLang: verdictLang(original.result),
      ...personalizedFields(TRANSLATED_WIN_A_SELF, original.name_map, verdictLang(original.result)),
    },
  ];
  return {
    verdicts,
    names,
    restore,
    personalizedTranslations,
    waits,
    errors,
    presets,
    palette: PALETTE,
    paletteAlpha: PALETTE_ALPHA,
    thinking,
  };
}

function main(): void {
  const check = process.argv.includes("--check");
  for (const [name, { response }] of Object.entries(SAMPLES)) {
    const parsed = VerdictResponse.safeParse(response);
    if (!parsed.success) throw new Error(`sample ${name} is not a valid VerdictResponse: ${parsed.error.message}`);
  }
  const translate = TranslateResponse.parse({
    id: SAMPLES.win_a_self.response.id,
    lang: "tr",
    source: "en",
    translated: true,
    result: TRANSLATED_WIN_A_SELF,
  });
  const stored = StoredVerdictResponseSchema.parse({
    id: SAMPLES.win_b_named.response.id,
    result: SAMPLES.win_b_named.response.result,
    createdAt: "2026-10-20T12:00:00.000Z",
  });
  const verdicts = {
    verdictResponses: Object.fromEntries(Object.entries(SAMPLES).map(([k, v]) => [k, v.response])),
    translateResponse: translate,
    storedVerdictResponse: stored,
    errorBodies: ERROR_BODIES,
    ...premiumFixtures(),
  };
  const files: [string, string][] = [
    [join(OUT_DIR, "verdicts.json"), `${JSON.stringify(verdicts, null, 2)}\n`],
    [join(OUT_DIR, "display-vectors.json"), `${JSON.stringify(displayVectors(), null, 2)}\n`],
  ];
  let stale = 0;
  for (const [path, content] of files) {
    const rel = relative(REPO_DIR, path).replace(/\\/g, "/");
    if (check) {
      let current = "";
      try {
        current = readFileSync(path, "utf8");
      } catch {
        // missing counts as stale
      }
      if (current !== content) {
        stale++;
        console.error(`stale: ${rel}`);
      }
    } else {
      writeFileSync(path, content, "utf8");
      console.log(`wrote ${rel}`);
    }
  }
  if (stale) process.exit(1);
}

main();
