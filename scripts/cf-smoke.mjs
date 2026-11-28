// Smoke test of the Workers build under `wrangler dev` (local workerd, local
// D1, local Durable Objects), with fake Resend and Anthropic servers:
//
//   npm run cf:build && node scripts/cf-smoke.mjs
//
// It signs in with an emailed code, confirms the date of birth, judges a
// verdict through the JobRunner Durable Object, posts RevenueCat webhooks,
// and checks the internal routes, the rate limiter and the cron entry.
// Set SMOKE_BASE to use a wrangler dev that is already running (its
// .dev.vars must point RESEND_API_URL and ANTHROPIC_BASE_URL at SMOKE_FAKE_PORT).
import { spawn, spawnSync } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

const PORT = Number(process.env.SMOKE_PORT ?? 8791);
const FAKE_PORT = Number(process.env.SMOKE_FAKE_PORT ?? 8799);
const BASE = process.env.SMOKE_BASE ?? `http://127.0.0.1:${PORT}`;
const hex = (n) => randomBytes(n).toString("hex");
const secrets = {
  JOB_SECRET: hex(24),
  METRICS_TOKEN: hex(24),
  REVENUECAT_WEBHOOK_SECRET: hex(24),
};

const sent = []; // fake Resend: every email posted
const claude = []; // fake Anthropic: every request body
const devLog = []; // what wrangler dev printed

/** A value that fits a JSON schema, with the answers the judges need to be coherent. */
function instance(schema, key = "", ctx = {}) {
  if (schema.anyOf) return instance(schema.anyOf.find((s) => s.type !== "null") ?? schema.anyOf[0], key, ctx);
  if (schema.enum) return key === "verdict" ? "side_a" : schema.enum[0];
  switch (schema.type) {
    case "string":
      return key === "text"
        ? ctx.user.replace(/(?<![A-Za-z])Sam(?![A-Za-z])/g, "Party B").replace(/(?<![A-Za-z])I(?![A-Za-z])/g, "Party A")
        : key === "headline" ? "Party A has the better case" : "Because it is so.";
    case "integer":
    case "number":
      return key === "confidence" ? 4 : (schema.minimum ?? 1);
    case "boolean":
      return false;
    case "array":
      return key === "replacements"
        ? [
            { original: "I", replacement: "Party A" },
            { original: "Sam", replacement: "Party B" },
          ]
        : Array.from({ length: schema.minItems ?? 1 }, () => instance(schema.items ?? {}, key, ctx));
    case "object":
      return Object.fromEntries(
        Object.entries(schema.properties ?? {})
          .filter(([k]) => (schema.required ?? Object.keys(schema.properties)).includes(k))
          .map(([k, v]) => [k, instance(v, k, ctx)]),
      );
    default:
      return null;
  }
}

function fakeServer() {
  return createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    res.setHeader("content-type", "application/json");
    if (req.url.startsWith("/emails")) {
      sent.push(body);
      res.end(JSON.stringify({ id: `email_${sent.length}` }));
      return;
    }
    if (req.url.startsWith("/v1/messages")) {
      claude.push(body);
      const user = typeof body.messages[0].content === "string" ? body.messages[0].content : body.messages[0].content.at(-1).text;
      const text = JSON.stringify(instance(body.output_config.format.schema, "", { user }));
      res.end(
        JSON.stringify({
          id: "msg_fake",
          type: "message",
          role: "assistant",
          model: body.model,
          content: [{ type: "text", text }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end("{}");
  }).listen(FAKE_PORT, "127.0.0.1");
}

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : `: ${detail}`}`);
  if (!ok) failed += 1;
}

async function api(method, url, { body, token, headers = {} } = {}) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: {
      origin: BASE,
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, headers: res.headers, json, text };
}

async function until(fn, ms = 60_000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return null;
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function run() {
  const health = await api("GET", "/api/health");
  check("health answers", health.status === 200 && health.json?.ok === true);
  check("security headers are set", health.headers.get("x-frame-options") === "DENY");
  for (const page of ["/", "/pricing", "/signin", "/terms", "/privacy"]) {
    const r = await api("GET", page);
    check(`${page} renders`, r.status === 200 && r.text.includes("</html>"), `${r.status}`);
  }
  const card = await fetch(`${BASE}/opengraph-image`);
  check("the link-preview card is drawn", card.status === 200 && card.headers.get("content-type") === "image/png", `${card.status} ${card.headers.get("content-type")}`);

  // The cutover copy: an old SQLite file, one row over D1's 100 KB statement limit, posted through the import route.
  const { createClient } = await import("@libsql/client");
  const { readFileSync } = await import("node:fs");
  const copyDir = mkdtempSync(path.join(tmpdir(), "judge-copy-"));
  const source = path.join(copyDir, "old.db");
  const old = createClient({ url: `file:${source.replaceAll(String.fromCharCode(92), "/")}` });
  await old.executeMultiple(readFileSync(new URL("../migrations/0001_schema.sql", import.meta.url), "utf8"));
  await old.execute({ sql: "INSERT INTO verdicts (id, input, framework, result) VALUES (?, ?, '{}', '{}')", args: ["copy-big", "x".repeat(300_000)] });
  await old.execute({ sql: "INSERT INTO verdicts (id, input, framework, result) VALUES (?, ?, '{}', '{}')", args: ["copy-small", "short"] });
  old.close();
  const closed = await api("POST", "/api/internal/import", { body: { table: "verdicts", columns: ["id"], rows: [] } });
  check("the import route is closed without the secret", closed.status === 404, `${closed.status}`);
  const copied = spawnSync("npx", ["tsx", "scripts/d1-copy.ts", source, BASE], {
    shell: true,
    encoding: "utf8",
    env: { ...process.env, JOB_SECRET: secrets.JOB_SECRET },
  });
  check("the old database copies into the empty D1 and the counts match", copied.status === 0 && copied.stdout.includes("row counts match"), `${copied.stdout}${copied.stderr}`.slice(-300));
  try {
    rmSync(copyDir, { recursive: true, force: true });
  } catch {}

  const config = await api("GET", "/api/v1/config");
  check(
    "Apple and Google sign-in are offered (the Apple secret was signed)",
    config.status === 200 && config.json?.signIn?.apple === true && config.json?.signIn?.google === true,
    config.text.slice(0, 300),
  );

  // Sign in with an emailed code.
  const email = `smoke-${hex(4)}@example.test`;
  const send = await api("POST", "/api/auth/email-otp/send-verification-otp", { body: { email, type: "sign-in" } });
  check("code email requested", send.status === 200, `${send.status} ${send.text.slice(0, 200)}`);
  const mail = await until(async () => sent.find((m) => [m.to].flat().includes(email)));
  const code = /\b(\d{6})\b/.exec(`${mail?.text ?? ""}`)?.[1];
  check("code email reached the fake sender", Boolean(code), JSON.stringify(mail)?.slice(0, 200));
  const signin = await api("POST", "/api/auth/sign-in/email-otp", { body: { email, otp: code } });
  const token = signin.headers.get("set-auth-token") ?? signin.json?.token;
  check("sign-in by code gives a session", signin.status === 200 && Boolean(token), `${signin.status} ${signin.text.slice(0, 200)}`);

  const me = await api("GET", "/api/v1/me", { token });
  check("session reads back the account", me.status === 200 && me.json?.user?.email === email, `${me.status} ${me.text.slice(0, 200)}`);
  const userId = me.json?.user?.id;

  const age = await api("POST", "/api/v1/me/age", { token, body: { dob: "1990-05-05" } });
  check("date of birth accepted", age.status === 200, `${age.status} ${age.text.slice(0, 200)}`);

  const agreed = await api("POST", "/api/v1/me/agreement", { token, body: { lang: "en", platform: "web" } });
  check("private-details agreement recorded", agreed.status === 200, `${agreed.status} ${agreed.text.slice(0, 200)}`);

  // A verdict: judged by the JobRunner Durable Object, which calls back into the app.
  const argument = "I told my brother Sam I would pay half of the rent. He says I never did. I think I was right to wait for the receipt.";
  const started = await api("POST", "/api/v1/verdict", { token, body: { argument, lang: "en", async: true } });
  check("verdict accepted for judging", started.status === 202 || started.status === 200, `${started.status} ${started.text.slice(0, 300)}`);
  if (started.status === 202) {
    const id = started.json.id;
    const done = await until(async () => {
      const r = await api("GET", `/api/v1/verdicts/${id}`, { token });
      return r.json?.status === "ready" || r.json?.status === "failed" ? r : null;
    }, 90_000);
    check("verdict is ready", done?.json?.status === "ready", done ? done.text.slice(0, 300) : "timed out");
    check("the judges were called through the fake endpoint", claude.length >= 2, `${claude.length} calls`);
    check(
      "judging ran in a JobRunner call back into the app",
      Boolean(process.env.SMOKE_BASE) || devLog.join("").includes("[job-runner] premium finished"),
    );
    const page = await api("GET", `/v/${id}`);
    check("the share page of a live verdict renders", page.status === 200, `${page.status}`);
    const removed = await api("POST", `/api/v1/verdicts/${id}/removal`, { token, body: { confirm: "remove" } });
    check("the writer removes the verdict", removed.status === 200, `${removed.status} ${removed.text.slice(0, 200)}`);
    const gone = await api("GET", `/v/${id}`);
    check("its share page answers 410 from the Worker", gone.status === 410 && gone.text.includes("<h1>"), `${gone.status}`);
    const balance = await api("GET", "/api/v1/me", { token });
    check("the free credit was spent", balance.json?.entitlement?.credits === 0, JSON.stringify(balance.json?.entitlement));
  }

  // RevenueCat: bad secret, then a purchase.
  const event = {
    api_version: "1.0",
    event: {
      type: "NON_RENEWING_PURCHASE",
      id: `evt-${hex(6)}`,
      app_user_id: userId,
      original_app_user_id: userId,
      product_id: "pack_10",
      transaction_id: `tx-${hex(6)}`,
      original_transaction_id: `tx-${hex(6)}`,
      store: "APP_STORE",
      environment: "SANDBOX",
      event_timestamp_ms: Date.now(),
      purchased_at_ms: Date.now(),
    },
  };
  const bad = await api("POST", "/api/v1/webhooks/revenuecat", { body: event, headers: { authorization: "Bearer wrong" } });
  check("webhook refuses a wrong secret", bad.status === 401 || bad.status === 403, `${bad.status}`);
  const good = await api("POST", "/api/v1/webhooks/revenuecat", {
    body: event,
    headers: { authorization: `Bearer ${secrets.REVENUECAT_WEBHOOK_SECRET}` },
  });
  check("webhook accepts a purchase", good.status === 200, `${good.status} ${good.text.slice(0, 200)}`);
  const bought = await api("GET", "/api/v1/me", { token });
  check("the purchase added ten credits", bought.json?.entitlement?.credits === 10, JSON.stringify(bought.json?.entitlement));
  const again = await api("POST", "/api/v1/webhooks/revenuecat", {
    body: event,
    headers: { authorization: `Bearer ${secrets.REVENUECAT_WEBHOOK_SECRET}` },
  });
  const twice = await api("GET", "/api/v1/me", { token });
  check("the same event twice changes nothing", again.status === 200 && twice.json?.entitlement?.credits === 10);

  // Internal routes and the rate limiter.
  const job = await api("POST", "/api/internal/job", { body: { name: "premium", args: [] } });
  check("job route is closed without the secret", job.status === 404, `${job.status}`);
  const cron = await api("POST", "/api/internal/cron?task=sweep", { headers: { "x-internal-secret": secrets.JOB_SECRET } });
  check("cron route runs a task with the secret", cron.status === 200, `${cron.status} ${cron.text.slice(0, 100)}`);
  const replay = await api("POST", "/api/internal/cron?task=replay-removals", { headers: { "x-internal-secret": secrets.JOB_SECRET } });
  check("the removal log replays after a restore", replay.status === 200, `${replay.status} ${replay.text.slice(0, 100)}`);
  const backup = await api("POST", "/api/internal/cron?task=backup", { headers: { "x-internal-secret": secrets.JOB_SECRET } });
  check("the backup task dumps the database into R2", backup.status === 200, `${backup.status}`);
  check("the backup wrote an object", Boolean(process.env.SMOKE_BASE) || devLog.join("").includes("[backup] wrote db/judge-"));
  const noMetrics = await api("GET", "/api/internal/metrics");
  check("metrics are closed without the token", noMetrics.status === 404, `${noMetrics.status}`);
  const metrics = await api("GET", "/api/internal/metrics", { headers: { authorization: `Bearer ${secrets.METRICS_TOKEN}` } });
  check("metrics answer with the token", metrics.status === 200, `${metrics.status}`);
  const share = await api("GET", "/v/doesnotexist1");
  check("a share page for an unknown verdict is a plain 404", share.status === 404, `${share.status}`);

  let limited = 0;
  for (let i = 0; i < 40 && !limited; i++) {
    const r = await api("POST", "/api/v1/auth/lookup", { body: { email: `nobody-${i}@example.test` } });
    if (r.status === 429) limited = i + 1;
  }
  check("the Durable Object rate limiter refuses after the limit", limited > 0, "no 429 in 40 tries");

  if (devLog.length) {
    const errors = devLog
      .join("")
      .split("\n")
      .map((l) => l.replace(new RegExp(String.fromCharCode(27) + "[[][0-9;]*m", "g"), ""))
      .filter((l) => l.includes("[ERROR]") && !/\[alert:|\[premium\] anonymize failed/.test(l));
    check("the worker logged no errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  }

  const cronEntry = await fetch(`${BASE}/cdn-cgi/handler/scheduled?cron=${encodeURIComponent("*/5 * * * *")}`);
  check("the scheduled handler runs", cronEntry.status === 200, `${cronEntry.status}`);
}

const fake = fakeServer();
let dev;
let dir;
try {
  if (!process.env.SMOKE_BASE) {
    dir = mkdtempSync(path.join(tmpdir(), "judge-smoke-"));
    const vars = {
      BETTER_AUTH_SECRET: hex(32),
      BETTER_AUTH_URL: BASE,
      NEXT_PUBLIC_SITE_URL: BASE,
      RESEND_API_KEY: "re_fake",
      EMAIL_FROM: "Judge <judge@example.test>",
      RESEND_API_URL: `http://127.0.0.1:${FAKE_PORT}/emails`,
      ANTHROPIC_API_KEY: "sk-fake",
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${FAKE_PORT}`,
      ORIGINALS_KEY: randomBytes(32).toString("base64"),
      RATE_LIMIT_SALT: hex(24),
      ALLOW_SANDBOX_PURCHASES: "1",
      IMPORT_ENABLED: "1",
      BACKUP_PASSPHRASE: hex(16),
      // Sign in with Apple and Google, so the Apple client secret (an ES256 token) is signed at startup.
      APPLE_CLIENT_ID: "test.judge.web",
      APPLE_TEAM_ID: "TEAM123456",
      APPLE_KEY_ID: "KEY1234567",
      APPLE_APP_BUNDLE_ID: "test.judge",
      APPLE_PRIVATE_KEY_BASE64: Buffer.from(
        generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }),
      ).toString("base64"),
      GOOGLE_CLIENT_ID: "google-client.apps.googleusercontent.com",
      GOOGLE_CLIENT_SECRET: "google-secret",
      ...secrets,
    };
    const varsFile = path.join(dir, "dev.vars");
    writeFileSync(varsFile, Object.entries(vars).map(([k, v]) => `${k}=${v}`).join("\n"));
    const persist = path.join(dir, "state");
    const common = ["wrangler", "-e", "smoke"];
    const migrated = spawnSync("npx", [...common.slice(0, 1), "d1", "migrations", "apply", "DB", "--local", "-e", "smoke", "--persist-to", persist], {
      shell: true,
      stdio: "inherit",
    });
    if (migrated.status !== 0) throw new Error("migrations failed");
    dev = spawn(
      "npx",
      ["wrangler", "dev", "-e", "smoke", "--env-file", varsFile, "--persist-to", persist, "--port", String(PORT), "--ip", "127.0.0.1", "--test-scheduled", "--inspector-port", String(PORT + 1000)],
      { shell: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, WRANGLER_SEND_METRICS: "false" } },
    );
    const log = devLog;
    dev.stdout.on("data", (d) => log.push(String(d)));
    dev.stderr.on("data", (d) => log.push(String(d)));
    const ready = await until(async () => {
      try {
        return (await fetch(`${BASE}/api/health`)).status === 200;
      } catch {
        return false;
      }
    }, 120_000);
    if (!ready) throw new Error(`wrangler dev did not start:\n${log.join("").slice(-2000)}`);
    process.on("exit", () => writeFileSync(path.join(dir, "dev.log"), log.join("")));
  } else {
    // An already running dev server: its secrets come from its .dev.vars.
    Object.assign(secrets, JSON.parse(process.env.SMOKE_SECRETS ?? "{}"));
  }
  await run();
} catch (e) {
  console.error(e);
  failed += 1;
} finally {
  fake.close();
  if (dev) {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(dev.pid), "/T", "/F"]);
    else dev.kill();
  }
  if (dir && process.env.SMOKE_KEEP !== "1") {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
}
console.log(failed ? `${failed} check(s) failed` : "all checks passed");
process.exit(failed ? 1 : 0);
