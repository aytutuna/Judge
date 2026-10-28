/**
 * Checks interface translations against English.
 *
 *   npm run check:locales            every file in lib/locales
 *   npm run check:locales -- de fr   just these (enabled or not yet)
 *
 * Exits 1 when any locale has a problem.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Locale } from "../lib/i18n";
import { ENABLED, isLang, LANGS } from "../lib/langs";
import { checkLocale } from "../lib/locales/check";

const dir = join(__dirname, "..", "lib", "locales");

async function main(): Promise<number> {
  const asked = process.argv.slice(2);
  const codes = asked.length
    ? asked
    : readdirSync(dir)
        .map((f) => f.replace(/\.ts$/, ""))
        .filter(isLang);
  let failed = 0;
  for (const code of codes) {
    if (!isLang(code)) {
      console.log(`${code}: not a registry language (lib/langs.ts)`);
      failed++;
      continue;
    }
    let locale: Locale;
    try {
      const mod = (await import(pathToFileURL(join(dir, `${code}.ts`)).href)) as { default: Locale | { default: Locale } };
      // tsx hands a CommonJS default back one level deeper.
      locale = "default" in mod.default ? mod.default.default : mod.default;
    } catch (e) {
      console.log(`${code}: cannot load lib/locales/${code}.ts (${e instanceof Error ? e.message : String(e)})`);
      failed++;
      continue;
    }
    const problems = checkLocale(code, locale);
    const state = ENABLED.includes(code) ? "enabled" : "not enabled yet";
    if (problems.length === 0) {
      console.log(`${code} (${LANGS[code].name}, ${state}): ok`);
    } else {
      failed++;
      console.log(`${code} (${LANGS[code].name}, ${state}): ${problems.length} problem(s)`);
      for (const p of problems) console.log(`  ${p}`);
    }
  }
  return failed ? 1 : 0;
}

main().then((code) => process.exit(code));
