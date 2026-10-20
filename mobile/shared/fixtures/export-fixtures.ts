/**
 * Golden fixtures for the native apps' unit tests, computed by the web's own
 * pure modules so a Kotlin/Swift port of the display logic is checked
 * against the real thing rather than a re-reading of it:
 *
 *   mobile/shared/fixtures/verdicts.json         sample API bodies (validated with lib/types.ts)
 *   mobile/shared/fixtures/display-vectors.json  expected labels, tug, tilt, waits, errors
 *
 * Run from the repo root (needs `npm ci`): npx tsx mobile/shared/fixtures/export-fixtures.ts
 * Add --check to fail when the committed files are stale.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { cruxStyle } from "../../../lib/crux-style";
import { verdictLang } from "../../../lib/content-lang";
import { apiErrorMessage, formatWait, t, type Lang } from "../../../lib/i18n";
import { partyNames, personalizeResult } from "../../../lib/names";
import { svgRotateDeg } from "../../../lib/balance";
import { PRESETS } from "../../../lib/frameworks";
import { PALETTE, PALETTE_ALPHA } from "../../../lib/palette";
import { FINISH_CAPTION, FINISH_STEPS, MAX_FINISH_MS, READY, STILL_JUDGING, THINKING_STEPS } from "../../../lib/thinking";
import { KEY_BY_CAPTION } from "../../../lib/thinking-keys";
import { leanTally, tugFinal, verdictLabel } from "../../../lib/verdict-display";
import { z } from "zod";
import {
  TranslateResponse,
  VerdictResponse,
  VerdictResult as VerdictResultSchema,
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
        tugA: tugFinal(r),
        svgRotateDeg: Math.round(svgRotateDeg(tugFinal(r)) * 1000) / 1000,
        cruxStyle: cruxStyle(r.crux),
        leanTally: lean ? leanTally(lean, r.runs.length) : null,
        shareUrl: `https://okjudge.com/v/${response.id}`,
        personalized: (() => {
          const p2 = personalizeResult(r, response.name_map, selfLang);
          return { headline: p2.headline, crux: p2.crux, losing_side_best_point: p2.losing_side_best_point };
        })(),
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
  const confidence = [1, 2, 3, 4, 5].flatMap((n) =>
    LANGS.map((lang) => ({
      n,
      lang,
      text: t(lang, "confidenceWord", { word: t(lang, `confidence.${n}` as "confidence.1"), n }),
    })),
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
  return { verdicts, names, waits, errors, confidence, presets, palette: PALETTE, paletteAlpha: PALETTE_ALPHA, thinking };
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
    result: { ...SAMPLES.win_a_self.response.result, lang: "tr", headline: "Kimse sandviç isteyip sosisli beklemez" },
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
