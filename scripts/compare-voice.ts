/**
 * Voice check for the judge prompt: runs judgeOnce on a few hand-picked
 * cases in English and Turkish, saves the free text, and compares two saved
 * runs side by side with simple "machine-written" tell metrics.
 * Costs real API calls (one judge run per case and language) in run mode;
 * report mode is free.
 *
 * Run:    npx tsx --env-file=.env scripts/compare-voice.ts run <out.json> [judge-module.ts]
 * Report: npx tsx scripts/compare-voice.ts report <before.json> <after.json>
 *
 * The optional judge module (default lib/judge.ts) lets a saved copy of an
 * older prompt be measured against the current one.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import cases from "../test/arguments.json";
import type { Lang } from "../lib/i18n";
import type { JudgeRunOutput } from "../lib/types";

const CASE_IDS = [
  "fact-goldfish",
  "logic-natural",
  "values-whitelie",
  "values-cameras",
  "def-hotdog",
  "mixed-dishwasher",
];
const LANGS: Lang[] = ["en", "tr"];
const SHOWN = ["headline", "crux", "losing_side_best_point", "leaning_reason"] as const;

type Sample = { id: string; lang: Lang; fields: Record<string, string>; allText: string[] };

/** Every user-visible free-text string in a judge run. */
function freeText(d: JudgeRunOutput): string[] {
  return [
    d.headline,
    d.crux,
    d.losing_side_best_point,
    d.leaning_reason,
    d.argument_map.bedrock_a,
    d.argument_map.bedrock_b,
    ...d.argument_map.side_a.map((c) => c.claim),
    ...d.argument_map.side_b.map((c) => c.claim),
    ...(d.split_points ?? []).map((p) => p.point),
    ...(d.conditional ?? []).flatMap((c) => [c.if_value, c.then]),
  ];
}

async function run(outPath: string, judgePath?: string) {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY not set — run mode needs a live key.");
    process.exit(1);
  }
  const mod = (await import(
    judgePath ? pathToFileURL(resolve(judgePath)).href : "../lib/judge"
  )) as typeof import("../lib/judge");
  const jobs = CASE_IDS.flatMap((id) => LANGS.map((lang) => ({ id, lang })));
  const samples = await Promise.all(
    jobs.map(async ({ id, lang }): Promise<Sample | null> => {
      const c = cases.find((x) => x.id === id);
      if (!c) throw new Error(`unknown case ${id}`);
      const res = await mod.judgeOnce(c.argument, { lang });
      if (!res.ok) {
        console.warn(`${id}/${lang}: run failed (${res.error})`);
        return null;
      }
      const fields = Object.fromEntries(SHOWN.map((k) => [k, res.data[k]]));
      fields.verdict = res.data.verdict;
      return { id, lang, fields, allText: freeText(res.data) };
    }),
  );
  writeFileSync(outPath, JSON.stringify(samples.filter(Boolean), null, 2));
  console.log(`saved ${samples.filter(Boolean).length}/${jobs.length} samples to ${outPath}`);
}

/** Stock phrasing that reads as machine-written. Matched case-insensitively
 * as substrings (Turkish lowercased with the tr locale). */
const TELLS: Record<Lang, string[]> = {
  en: [
    "it's important to note", "it is important to note", "worth noting", "delve",
    "ultimately", "in conclusion", "nuanced", "multifaceted", "navigate", "landscape",
    "crucial", "foster", "a testament to", "at the end of the day", "both sides",
    "valid point", "it's not just", "not just about", "in essence", "overall,",
    "complex", "underscore", "highlight", "key factor", "plays a role",
    // Leaked process jargon from the judge's method.
    "framework", "standard", "weighting", "preponderance", "burden of proof", "like a court",
  ],
  tr: [
    "bu bağlamda", "önemli bir husus", "söz konusu", "sonuç olarak", "değerlendirildiğinde",
    "maktadır", "mektedir", "nitelendiril", "her iki taraf", "günün sonunda",
    "önemle belirtmek", "dikkat çekmek gerekir", "açısından bakıldığında", "kapsamında",
    "itibariyle", "olarak değerlendir", "bir kanıtıdır", "karmaşık", "nihayetinde",
    "asıl mesele", "asıl tartışma", "lehine",
    // Leaked process jargon from the judge's method.
    "çerçeve", "standart", "olgusal", "ispat yükü", "mahkeme",
  ],
};

function lower(s: string, lang: Lang) {
  return lang === "tr" ? s.toLocaleLowerCase("tr") : s.toLowerCase();
}

function metrics(samples: Sample[], lang: Lang) {
  const texts = samples.filter((s) => s.lang === lang).flatMap((s) => s.allText);
  const joined = texts.join("\n");
  const words = joined.split(/\s+/).filter(Boolean).length || 1;
  const hits: Record<string, number> = {};
  for (const t of TELLS[lang]) {
    const n = lower(joined, lang).split(t).length - 1;
    if (n) hits[t] = n;
  }
  const sentences = texts
    .flatMap((t) => t.split(/(?<=[.!?])\s+/))
    .map((s) => s.split(/\s+/).filter(Boolean).length)
    .filter((n) => n > 0);
  const mean = sentences.reduce((a, b) => a + b, 0) / (sentences.length || 1);
  const sd = Math.sqrt(
    sentences.reduce((a, b) => a + (b - mean) ** 2, 0) / (sentences.length || 1),
  );
  const per100 = (re: RegExp) => ((joined.match(re)?.length ?? 0) * 100) / words;
  return {
    words,
    tellHits: Object.values(hits).reduce((a, b) => a + b, 0),
    tells: hits,
    emDashPer100: per100(/—|\s–\s/g).toFixed(2),
    colonPer100: per100(/:/g).toFixed(2),
    semicolonPer100: per100(/;/g).toFixed(2),
    whetherOpeners: texts.filter((t) => /^whether|yoksa/i.test(t)).length,
    sentenceMean: mean.toFixed(1),
    sentenceSd: sd.toFixed(1),
  };
}

function report(beforePath: string, afterPath: string) {
  const before = JSON.parse(readFileSync(beforePath, "utf8")) as Sample[];
  const after = JSON.parse(readFileSync(afterPath, "utf8")) as Sample[];
  for (const lang of LANGS) {
    for (const id of CASE_IDS) {
      const b = before.find((s) => s.id === id && s.lang === lang);
      const a = after.find((s) => s.id === id && s.lang === lang);
      console.log(`\n=== ${id} [${lang}] ${b?.fields.verdict ?? "-"} -> ${a?.fields.verdict ?? "-"}`);
      for (const k of SHOWN) {
        console.log(`  ${k}`);
        console.log(`    before: ${b?.fields[k] ?? "(missing)"}`);
        console.log(`    after:  ${a?.fields[k] ?? "(missing)"}`);
      }
    }
  }
  console.log("\n=== TELL METRICS (all free text) ===");
  for (const lang of LANGS) {
    console.log(`[${lang}] before:`, JSON.stringify(metrics(before, lang)));
    console.log(`[${lang}] after: `, JSON.stringify(metrics(after, lang)));
  }
}

const [mode, a, b] = process.argv.slice(2);
if (mode === "run" && a) {
  run(a, b);
} else if (mode === "report" && a && b) {
  report(a, b);
} else {
  console.error("usage: compare-voice.ts run <out.json> [judge-module.ts] | report <before.json> <after.json>");
  process.exit(1);
}
