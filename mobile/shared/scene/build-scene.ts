/**
 * Bundles scene.ts (the web's three.js balance in card framing) into one
 * self-contained HTML page for the judging card's web view:
 *
 *   Android  mobile/android/app/src/main/assets/scene/index.html
 *   iOS      mobile/ios/Judge/Resources/Scene/index.html
 *
 * Run from the repo root:  npm run scene:build
 * CI / pre-commit check:   npx tsx mobile/shared/scene/build-scene.ts --check
 *
 * Script and style are inlined and nothing is fetched, so the page works from
 * a file:// URL. The output is committed so neither native build needs Node.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { build } from "esbuild";
import { PALETTE } from "../../../lib/palette";
import { balanceSvg } from "./fallback";

const MOBILE_DIR = resolve(__dirname, "../..");
const REPO_DIR = resolve(MOBILE_DIR, "..");
const OUTPUTS = [
  join(MOBILE_DIR, "android/app/src/main/assets/scene/index.html"),
  join(MOBILE_DIR, "ios/Judge/Resources/Scene/index.html"),
];

// Same look as components/scene/JudgingScene.module.css.
const CSS = `html,body{margin:0;height:100%;overflow:hidden}
body{background:radial-gradient(closest-side at 50% 54%,${PALETTE.ivory2},${PALETTE.paper}) ${PALETTE.paper};-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
canvas{position:absolute;inset:0;display:block;width:100%;height:100%;opacity:0;transition:opacity .4s linear}
#fallback{position:absolute;left:50%;top:56%;height:56%;width:auto;max-width:84%;overflow:visible;transform:translate(-50%,-50%);transition:opacity .4s linear}
body[data-status=ready] canvas{opacity:1;transition-delay:.1s}
body[data-status=ready] #fallback{opacity:0;transition-duration:.2s}
body[data-status=fallback] canvas{visibility:hidden}
body[data-reduced=true] canvas,body[data-reduced=true] #fallback{transition:none}`;

async function bundle(): Promise<string> {
  const result = await build({
    entryPoints: [join(__dirname, "scene.ts")],
    tsconfig: join(REPO_DIR, "tsconfig.json"),
    bundle: true,
    minify: true,
    treeShaking: true,
    format: "iife",
    target: "es2020",
    legalComments: "none",
    define: { "process.env.NODE_ENV": '"production"' },
    // lib/balance.ts reaches lib/i18n.ts, whose languages load on demand. The
    // scene never shows text, so leave those imports unresolved rather than
    // inline every language.
    external: ["./locales/*"],
    write: false,
    logLevel: "warning",
  });
  // Keep the inline script from closing itself early.
  return result.outputFiles[0].text.trim().replace(/<\/script/gi, "<\\/script");
}

function page(js: string): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">',
    "<title>Judge</title>",
    `<style>${CSS}</style>`,
    "</head>",
    "<body>",
    balanceSvg(),
    `<script>${js}</script>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const check = process.argv.includes("--check");
  const html = page(await bundle());
  let stale = 0;
  for (const path of OUTPUTS) {
    const rel = relative(REPO_DIR, path).replace(/\\/g, "/");
    if (check) {
      let current = "";
      try {
        current = readFileSync(path, "utf8");
      } catch {
        // missing counts as stale
      }
      if (current !== html) {
        stale++;
        console.error(`stale: ${rel}`);
      }
      continue;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, html, "utf8");
    console.log(`wrote ${rel}`);
  }
  console.log(`${(Buffer.byteLength(html) / 1024).toFixed(1)} KB`);
  if (stale) {
    console.error("Run: npm run scene:build");
    process.exit(1);
  }
}

main();
