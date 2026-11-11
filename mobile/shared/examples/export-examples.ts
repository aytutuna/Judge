/**
 * Copies the "Try an example" data (lib/examples/<lang>.json, one file per
 * language keyed by id) into the native apps as one JSON array per language,
 * in the order of the English file, so the apps keep the same order the web
 * picks from:
 *
 *   Android  mobile/android/app/src/main/assets/examples/<lang>.json
 *   iOS      mobile/ios/Judge/Resources/Examples/<lang>.json
 *
 * Each file is [{"id","title","aName","a","bName","b"}, ...]. An app loads only
 * the file of its current language, at the moment the example button is used.
 *
 * Run from the repo root:  npx tsx mobile/shared/examples/export-examples.ts
 * CI / pre-commit check:   npx tsx mobile/shared/examples/export-examples.ts --check
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { ENABLED } from "../../../lib/langs";
import type { Example } from "../../../lib/examples";

const MOBILE_DIR = resolve(__dirname, "../..");
const REPO_DIR = resolve(MOBILE_DIR, "..");
const SOURCE = join(REPO_DIR, "lib/examples");
const TARGETS = [join(MOBILE_DIR, "android/app/src/main/assets/examples"), join(MOBILE_DIR, "ios/Judge/Resources/Examples")];

const rel = (path: string) => relative(REPO_DIR, path).replace(/\\/g, "/");

function main(): void {
  const check = process.argv.includes("--check");
  const english: Record<string, Example> = JSON.parse(readFileSync(join(SOURCE, "en.json"), "utf8"));
  const ids = Object.keys(english);
  let stale = 0;
  for (const dir of TARGETS) {
    const expected = new Set<string>();
    for (const lang of ENABLED) {
      const data: Record<string, Example> = JSON.parse(readFileSync(join(SOURCE, `${lang}.json`), "utf8"));
      const missing = ids.filter((id) => !data[id]);
      if (missing.length) throw new Error(`${lang}: no translation for ${missing.join(", ")}`);
      const path = join(dir, `${lang}.json`);
      expected.add(path);
      const content = `${JSON.stringify(ids.map((id) => ({ id, ...data[id] })))}\n`;
      if (existsSync(path) && readFileSync(path, "utf8") === content) continue;
      if (check) {
        stale++;
        console.error(`stale: ${rel(path)}`);
        continue;
      }
      mkdirSync(dir, { recursive: true });
      writeFileSync(path, content, "utf8");
      console.log(`wrote ${rel(path)}`);
    }
    const leftover = existsSync(dir) ? readdirSync(dir).map((f) => join(dir, f)).filter((p) => !expected.has(p)) : [];
    for (const path of leftover) {
      if (check) {
        stale++;
        console.error(`stale: ${rel(path)} (language no longer exported)`);
      } else {
        rmSync(path);
        console.log(`removed ${rel(path)}`);
      }
    }
  }
  console.log(`${ids.length} examples in ${ENABLED.length} languages`);
  if (stale) {
    console.error("Run: npx tsx mobile/shared/examples/export-examples.ts");
    process.exit(1);
  }
}

main();
