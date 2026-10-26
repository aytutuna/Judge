/**
 * Visual and interaction checks in headless Microsoft Edge (playwright-core
 * with channel "msedge": no browser download, no Docker).
 *
 *   npx next build && npx next start -p 3400
 *   npx tsx scripts/shots.mts --base http://localhost:3400 --out <dir outside the repo>
 *   npx tsx scripts/shots.mts --only judging-side_a,story,fold
 *
 * Screenshots go to --out (default: <tmp>/verdict-shots). POST /api/verdict
 * is intercepted with fixtures delayed by 3, 12 and 28 s, so no API key or
 * network is needed; the Turnstile script is stubbed with an instant token.
 * Real anchors and real scrolling only: the app has no screenshot params.
 * Prints PASS/FAIL per check and exits 1 on any failure.
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import type { JudgeVerdict, VerdictResponse, VerdictResult } from "../lib/types";

const args = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const BASE = arg("base", "http://localhost:3400");
const OUT = arg("out", join(tmpdir(), "verdict-shots"));
const ONLY = arg("only", "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const wanted = (name: string) => ONLY.length === 0 || ONLY.some((o) => name.startsWith(o));
mkdirSync(OUT, { recursive: true });

const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
}

/* ---------- fixtures ---------- */

function fixture(name: string, over: Partial<VerdictResult>): VerdictResponse {
  const result: VerdictResult = {
    verdict: "side_a",
    dispute_type: "definitional",
    headline: "A hot dog is its own thing in everyday speech.",
    crux: "Is a sandwich defined by its structure or by how people use the word?",
    split_points: null,
    conditional: null,
    argument_map: {
      side_a: [
        { claim: "It is filling inside sliced bread.", kind: "definition" },
        { claim: "Structure decides the category.", kind: "logic" },
      ],
      side_b: [
        { claim: "No menu lists it as a sandwich.", kind: "fact" },
        { claim: "Words mean what people use them for.", kind: "value" },
      ],
      bedrock_a: "Categories follow structure.",
      bedrock_b: "Categories follow use.",
    },
    facts_relied_on: ["Menus list hot dogs separately."],
    losing_side_best_point: "A split roll with a filling fits most dictionary definitions.",
    confidence: 4,
    runs: ["side_a", "side_a", "side_a"],
    demo: false,
    lang: "en",
    ...over,
  };
  return { id: `shot-${name}`, result, name_map: [] };
}

const runs = (...r: JudgeVerdict[]) => r;
const FIXTURES: { name: string; delayMs: number; body: VerdictResponse }[] = [
  { name: "side_a", delayMs: 3000, body: fixture("side_a", {}) },
  {
    name: "side_b",
    delayMs: 12000,
    body: fixture("side_b", { verdict: "side_b", runs: runs("side_b", "side_b", "split") }),
  },
  {
    name: "lean_a",
    delayMs: 3000,
    body: fixture("lean_a", {
      verdict: "split",
      confidence: 2,
      runs: runs("split", "side_a", "split"),
      lean: { party: "a", unanimous: false, reason: "Slightly stronger on use." },
    }),
  },
  {
    name: "too_close",
    delayMs: 12000,
    body: fixture("too_close", { verdict: "too_close", confidence: 1, runs: runs("side_a", "side_b", "dissolved") }),
  },
  {
    name: "escalated",
    delayMs: 28000,
    body: fixture("escalated", {
      verdict: "side_b",
      confidence: 3,
      escalated: true,
      runs: runs("side_b", "side_a", "side_b", "side_b", "conditional"),
    }),
  },
];

/* ---------- helpers ---------- */

const TURNSTILE_STUB = `window.turnstile = {
  render(el, o) { setTimeout(() => o.callback && o.callback("shots-token"), 30); return "shots"; },
  remove() {},
};`;

async function newPage(
  browser: Browser,
  opts: { viewport: { width: number; height: number }; lang?: "en" | "tr"; reduced?: boolean },
): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({
    viewport: opts.viewport,
    deviceScaleFactor: opts.viewport.width < 600 ? 2 : 1,
    reducedMotion: opts.reduced ? "reduce" : "no-preference",
    isMobile: opts.viewport.width < 600,
    hasTouch: opts.viewport.width < 600,
  });
  const lang = opts.lang ?? "en";
  await ctx.addInitScript((l) => {
    try {
      localStorage.setItem("verdict-lang", l);
    } catch {}
  }, lang);
  await ctx.route("https://challenges.cloudflare.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/javascript", body: TURNSTILE_STUB }),
  );
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`  pageerror: ${e.message}`));
  return { ctx, page };
}

async function waitForScene(page: Page, timeout = 15000): Promise<string> {
  try {
    await page.waitForFunction(
      () => {
        const s = document.querySelector("[data-scene-wrap]")?.getAttribute("data-scene-status");
        return s === "ready" || s === "fallback";
      },
      undefined,
      { timeout },
    );
  } catch {}
  return (await page.getAttribute("[data-scene-wrap]", "data-scene-status")) ?? "missing";
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log(`  saved ${name}.png`);
}

/** Scroll so the story is at progress q (step i active at round(q) === i). */
async function scrollStory(page: Page, q: number): Promise<void> {
  await page.evaluate((qq) => {
    const track = document.querySelector("#how ol") as HTMLElement | null;
    if (!track) return;
    const stepH = (track.firstElementChild as HTMLElement | null)?.offsetHeight ?? innerHeight;
    const top = track.getBoundingClientRect().top + scrollY;
    window.scrollTo({ top: top + qq * stepH, behavior: "instant" as ScrollBehavior });
  }, q);
  await page.waitForTimeout(900);
}

/* ---------- scenarios ---------- */

async function staticPages(browser: Browser): Promise<void> {
  const routes: { name: string; path: string }[] = [
    { name: "home", path: "/" },
    { name: "how", path: "/about#how" },
    { name: "sample", path: "/about#sample" },
    { name: "faq", path: "/about#faq" },
    { name: "about", path: "/about" },
    { name: "privacy", path: "/privacy" },
    { name: "verdicts", path: "/verdicts" },
    { name: "404", path: "/no-such-page" },
  ];
  for (const vp of [
    { tag: "m", viewport: MOBILE },
    { tag: "d", viewport: DESKTOP },
  ]) {
    for (const r of routes) {
      const name = `static-${r.name}-${vp.tag}`;
      if (!wanted(name)) continue;
      const { ctx, page } = await newPage(browser, { viewport: vp.viewport });
      await page.goto(BASE + r.path, { waitUntil: "load" });
      if (r.path.startsWith("/about")) await waitForScene(page);
      else await page.waitForTimeout(1200);
      await shot(page, name);
      await ctx.close();
    }
  }
}

async function story(browser: Browser): Promise<void> {
  for (const vp of [
    { tag: "m", viewport: MOBILE },
    { tag: "d", viewport: DESKTOP },
  ]) {
    for (const reduced of [false, true]) {
      const base = `story-${vp.tag}${reduced ? "-reduced" : ""}`;
      if (!wanted(base)) continue;
      const { ctx, page } = await newPage(browser, { viewport: vp.viewport, reduced });
      await page.goto(BASE + "/about", { waitUntil: "load" });
      const status = await waitForScene(page);
      check(`${base}: scene loads`, status === "ready", `status ${status}`);
      for (let step = 0; step < 5; step++) {
        await scrollStory(page, step === 3 ? 3.3 : step);
        const active = await page.evaluate(() => {
          const steps = [...document.querySelectorAll("#how ol > li")];
          return steps.findIndex((s) => s.hasAttribute("data-active"));
        });
        check(`${base}: step ${step + 1} active`, active === step, `active ${active}`);
        if (vp.tag === "m" && step > 0 && step !== 3) {
          // The previous card has scrolled off, not left cut off under the nav.
          const prevBottom = await page.evaluate((i) => {
            const card = document.querySelectorAll("#how ol > li")[i - 1]?.firstElementChild;
            return card ? Math.round(card.getBoundingClientRect().bottom) : 0;
          }, step);
          check(`${base}: step ${step} card gone at step ${step + 1}`, prevBottom <= 0, `bottom ${prevBottom}`);
        }
        await shot(page, `${base}-step${step + 1}`);
      }
      await ctx.close();
    }
  }
}

/** First screen: the CTA on laptops, the textarea on phones (EN and TR),
 * and the about page's #sample deep link clear of the last story card. */
async function fold(browser: Browser): Promise<void> {
  if (!wanted("fold")) return;
  for (const lang of ["en", "tr"] as const) {
    for (const viewport of [DESKTOP, { width: 1366, height: 768 }, { width: 1280, height: 800 }]) {
      const { ctx, page } = await newPage(browser, { viewport, lang });
      await page.goto(BASE + "/", { waitUntil: "load" });
      await page.waitForTimeout(1200); // past the CSS rise-in
      const bottom = await page.evaluate(() =>
        Math.round(document.querySelector('#main form button[type="submit"]')?.getBoundingClientRect().bottom ?? 1e9),
      );
      check(`fold ${lang} ${viewport.width}x${viewport.height}: CTA above the fold`, bottom <= viewport.height, `bottom ${bottom}`);
      await ctx.close();
    }
    for (const viewport of [MOBILE, { width: 360, height: 740 }, { width: 430, height: 932 }]) {
      const { ctx, page } = await newPage(browser, { viewport, lang });
      await page.goto(BASE + "/", { waitUntil: "load" });
      await page.waitForTimeout(1200);
      const lines = await page.evaluate(() => {
        const ta = document.querySelector("#argument") as HTMLElement;
        const lh = parseFloat(getComputedStyle(ta).lineHeight);
        return (innerHeight - ta.getBoundingClientRect().top - parseFloat(getComputedStyle(ta).paddingTop)) / lh;
      });
      check(`fold ${lang} ${viewport.width}x${viewport.height}: 3+ textarea lines on the first screen`, lines >= 3, `${lines.toFixed(1)} lines`);
      await ctx.close();
    }
    const { ctx, page } = await newPage(browser, { viewport: MOBILE, lang });
    await page.goto(BASE + "/about#sample", { waitUntil: "load" });
    await page.waitForTimeout(2000);
    const res = await page.evaluate(() => {
      const last = document.querySelector("#how ol > li:last-child")?.firstElementChild?.getBoundingClientRect();
      return { lastBottom: Math.round(last?.bottom ?? 0), sampleTop: Math.round(document.querySelector("#sample")?.getBoundingClientRect().top ?? 0) };
    });
    check(`fold ${lang}: #sample opens clear of the last story card`, res.lastBottom <= 0, JSON.stringify(res));
    await ctx.close();
  }
}

async function composerLayout(browser: Browser): Promise<void> {
  if (!wanted("composer-layout")) return;
  for (const lang of ["en", "tr"] as const) {
    const { ctx, page } = await newPage(browser, { viewport: MOBILE, lang });
    await page.goto(BASE + "/", { waitUntil: "load" });
    const res = await page.evaluate(() => {
      const tops = [...document.querySelectorAll('[role="group"][aria-labelledby="composer-examples"] button')].map(
        (el) => el.getBoundingClientRect().top,
      );
      const bar = document.querySelector("#main form button[aria-expanded]")?.parentElement ?? null;
      return {
        chipsRow:
          tops.length > 0 &&
          Math.max(...tops) - Math.min(...tops) <= 1 &&
          document.documentElement.scrollWidth <= window.innerWidth,
        barFits: bar ? bar.scrollWidth <= bar.clientWidth + 1 : false,
      };
    });
    check(`composer-layout ${lang}: chips on one row, page does not widen`, res.chipsRow);
    check(`composer-layout ${lang}: toolbar fits on one row`, res.barFits);
    await ctx.close();
  }
}

/** The bottom tabs on phones: shown on an empty home page, gone while the
 * composer is docked for a running argument, back under the "New argument"
 * bar after the verdict without the two overlapping. Desktop has the
 * header link instead. */
async function tabs(browser: Browser): Promise<void> {
  if (!wanted("tabs")) return;
  const f = FIXTURES[0];
  const { ctx, page } = await newPage(browser, { viewport: MOBILE });
  await page.route("**/api/verdict", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await new Promise((r) => setTimeout(r, f.delayMs));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(f.body) });
  });
  const bar = () =>
    page.evaluate(() => {
      const nav = document.querySelector("nav[aria-label] a[href='/verdicts']")?.closest("nav") ?? null;
      return nav && getComputedStyle(nav).display !== "none" ? nav.getBoundingClientRect().top : null;
    });
  await page.goto(BASE + "/", { waitUntil: "load" });
  await page.waitForTimeout(800);
  check("tabs: shown on the empty home page", (await bar()) !== null);
  await shot(page, "tabs-empty-m");
  await page.click('[role="group"][aria-labelledby="composer-examples"] button');
  await page.waitForFunction(() => {
    const b = document.querySelector('#main form button[type="submit"]') as HTMLButtonElement | null;
    return b && !b.disabled;
  });
  await page.click('#main form button[type="submit"]');
  await page.waitForTimeout(800);
  check("tabs: hidden while the composer is docked", (await bar()) === null);
  await shot(page, "tabs-judging-m");
  await page.waitForSelector('[data-part="verdict"]', { timeout: f.delayMs + 15000 });
  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" as ScrollBehavior }));
  await page.waitForTimeout(600);
  const top = await bar();
  const dock = await page.evaluate(() => {
    const next = [...document.querySelectorAll("#main button, #main a")].find((el) =>
      /New argument/.test(el.textContent ?? ""),
    );
    return next ? next.getBoundingClientRect().bottom : null;
  });
  check("tabs: back after the verdict", top !== null);
  const clear = top !== null && dock !== null && dock <= top;
  check("tabs: New argument bar sits above the tabs", clear, `dock ${dock}, tabs ${top}`);
  await shot(page, "tabs-verdict-m");
  await page.goto(BASE + "/verdicts", { waitUntil: "load" });
  await page.waitForTimeout(800);
  const current = await page.locator("nav a[aria-current='page'][href='/verdicts']").count();
  check("tabs: My verdicts tab is current on /verdicts", current === 1);
  check("tabs: the verdict just written is listed", (await page.locator(`a[href="/v/${f.body.id}"]`).count()) > 0);
  await shot(page, "tabs-verdicts-m");
  await ctx.close();

  const desk = await newPage(browser, { viewport: DESKTOP });
  await desk.page.goto(BASE + "/", { waitUntil: "load" });
  await desk.page.waitForTimeout(800);
  const res = await desk.page.evaluate(() => {
    const link = document.querySelector("header a[href='/verdicts']");
    const nav = document.querySelector("nav a[href='/verdicts']")?.closest("nav");
    return {
      header: link ? getComputedStyle(link).display !== "none" : false,
      tabs: nav ? getComputedStyle(nav).display !== "none" : false,
    };
  });
  check("tabs: desktop has the header link and no tab bar", res.header && !res.tabs, JSON.stringify(res));
  await desk.ctx.close();
}

async function judging(browser: Browser): Promise<void> {
  for (const f of FIXTURES) {
    for (const vp of [
      { tag: "m", viewport: MOBILE },
      { tag: "d", viewport: DESKTOP },
    ]) {
      const name = `judging-${f.name}-${vp.tag}`;
      if (!wanted(name)) continue;
      // The long fixture only runs once, on mobile.
      if (f.delayMs > 20000 && vp.tag === "d") continue;
      const { ctx, page } = await newPage(browser, { viewport: vp.viewport });
      await page.route("**/api/verdict", async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        await new Promise((r) => setTimeout(r, f.delayMs));
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(f.body) });
      });
      await page.goto(BASE + "/", { waitUntil: "load" });
      await page.click('[role="group"][aria-labelledby="composer-examples"] button');
      await page.waitForFunction(() => {
        const b = document.querySelector('#main form button[type="submit"]') as HTMLButtonElement | null;
        return b && !b.disabled;
      });
      const t0 = Date.now();
      await page.click('#main form button[type="submit"]');
      await page.waitForTimeout(1500);
      const live = await page.evaluate(
        () => document.querySelector('[data-part="judging"] [role="status"]')?.textContent ?? "",
      );
      check(`${name}: judging turn in the thread while pending`, live.length > 0, live);
      await shot(page, `${name}-pending`);

      if (f.delayMs > 20000) {
        // Second loop cycle: the overlay must say the judges are still out.
        await page.waitForTimeout(Math.max(0, 19000 - (Date.now() - t0)));
        const still = await page.evaluate(
          () => document.querySelector('[data-part="judging"] [role="status"]')?.textContent ?? "",
        );
        check(`${name}: loops gracefully (still judging)`, /still|hâlâ/i.test(still), still);
        await shot(page, `${name}-deliberate`);
      }

      const card = await page
        .waitForSelector('[data-part="verdict"]', { timeout: f.delayMs + 15000 })
        .then(() => true)
        .catch(() => false);
      const kept = await page.evaluate(() => {
        const judging = document.querySelector('[data-part="judging"]');
        const verdict = document.querySelector('[data-part="verdict"]');
        return !!judging && !!verdict && !!judging.querySelector('[data-scene-mode="verdict"]') &&
          !!(judging.compareDocumentPosition(verdict) & Node.DOCUMENT_POSITION_FOLLOWING);
      });
      check(`${name}: scene stays above the verdict`, card && kept);
      await shot(page, `${name}-verdict`);
      await ctx.close();
    }
  }
}

async function noWebGL(): Promise<void> {
  if (!wanted("nowebgl")) return;
  const browser = await chromium.launch({ channel: "msedge", args: ["--disable-3d-apis"] });
  try {
    const { ctx, page } = await newPage(browser, { viewport: MOBILE });
    await page.goto(BASE + "/about", { waitUntil: "load" });
    const status = await waitForScene(page, 6000);
    // BalanceScene (and with it the three.js chunk) is only imported once mounted.
    const canvas = await page.evaluate(() => !!document.querySelector("[data-scene-wrap] canvas"));
    check("nowebgl: falls back to the SVG", status === "fallback", `status ${status}`);
    check("nowebgl: never mounts the 3D canvas", !canvas);
    await shot(page, "nowebgl-m");
    await ctx.close();
  } finally {
    await browser.close();
  }
}

const browser = await chromium.launch({
  channel: "msedge",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--hide-scrollbars"],
});
try {
  await staticPages(browser);
  await story(browser);
  await fold(browser);
  await composerLayout(browser);
  await tabs(browser);
  await judging(browser);
} finally {
  await browser.close();
}
await noWebGL();

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
