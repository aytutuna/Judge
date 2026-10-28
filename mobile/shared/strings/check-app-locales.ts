/**
 * Checks the app-only strings of every language against English.
 *
 *   npm run check:app-locales            every enabled language
 *   npm run check:app-locales -- de fr   just these
 *
 * Exits 1 when a language has a problem. A language without a file yet
 * shows English in the apps; that fails only when it was asked for by name.
 */
import { ENABLED, isLang, LANGS } from "../../../lib/langs";
import { checkAppLocale, loadAppLocale } from "./app-locales";

async function main(): Promise<number> {
  const asked = process.argv.slice(2);
  const codes = asked.length ? asked : ENABLED.filter((l) => l !== "en");
  let failed = 0;
  for (const code of codes) {
    if (!isLang(code) || code === "en") {
      console.log(`${code}: not a registry language besides English (lib/langs.ts)`);
      failed++;
      continue;
    }
    let locale;
    try {
      locale = await loadAppLocale(code);
    } catch (e) {
      console.log(`${code}: cannot load mobile/shared/strings/locales/${code}.ts (${e instanceof Error ? e.message : String(e)})`);
      failed++;
      continue;
    }
    if (!locale) {
      console.log(`${code} (${LANGS[code].name}): no mobile/shared/strings/locales/${code}.ts yet, the apps show English there`);
      if (asked.length) failed++;
      continue;
    }
    const problems = checkAppLocale(code, locale);
    if (problems.length === 0) {
      console.log(`${code} (${LANGS[code].name}): ok`);
    } else {
      failed++;
      console.log(`${code} (${LANGS[code].name}): ${problems.length} problem(s)`);
      for (const p of problems) console.log(`  ${p}`);
    }
  }
  return failed ? 1 : 0;
}

main().then((code) => process.exit(code));
