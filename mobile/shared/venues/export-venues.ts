/**
 * Copies the list of court scenes (lib/venues.ts) into the native apps as a
 * JSON array of ids, in the order the apps pick from:
 *
 *   Android  mobile/android/app/src/main/assets/venues.json
 *   iOS      mobile/ios/Judge/Resources/Court/venues.json
 *
 * Run from the repo root:  npx tsx mobile/shared/venues/export-venues.ts
 * CI / pre-commit check:   npx tsx mobile/shared/venues/export-venues.ts --check
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { VENUES } from "../../../lib/venues";

const MOBILE_DIR = resolve(__dirname, "../..");
const REPO_DIR = resolve(MOBILE_DIR, "..");
const TARGETS = [join(MOBILE_DIR, "android/app/src/main/assets/venues.json"), join(MOBILE_DIR, "ios/Judge/Resources/Court/venues.json")];

function main(): void {
  const check = process.argv.includes("--check");
  const content = `${JSON.stringify(VENUES)}\n`;
  let stale = 0;
  for (const path of TARGETS) {
    const rel = relative(REPO_DIR, path).replace(/\\/g, "/");
    if (existsSync(path) && readFileSync(path, "utf8") === content) continue;
    if (check) {
      stale++;
      console.error(`stale: ${rel}`);
      continue;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf8");
    console.log(`wrote ${rel}`);
  }
  if (stale) {
    console.error("Run: npx tsx mobile/shared/venues/export-venues.ts");
    process.exit(1);
  }
}

main();
