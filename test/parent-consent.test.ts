import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Where a teen lives and the parent step, against a real (temporary)
 * database and real sessions: the region rules at the date step, the 403s of
 * a held account, the request and its limits, the approve, decline and
 * withdraw links, the 30-day deletions and the proof record.
 */

const dir = mkdtempSync(path.join(tmpdir(), "verdict-parent-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;
process.env.BETTER_AUTH_SECRET = "test-secret-".padEnd(48, "x");
process.env.BETTER_AUTH_URL = "http://localhost:3600";

const { createDevSession } = await import("../lib/auth");
const { getDb } = await import("../lib/db");
const { runCleanup } = await import("../lib/cleanup");
const { requestParent, decideParent, parentView, MAX_CHANGES, MAX_RESENDS } = await import("../lib/parent-consent");
const ageRoute = await import("../app/api/v1/me/age/route");
const meRoute = await import("../app/api/v1/me/route");
const exportRoute = await import("../app/api/v1/me/export/route");
const historyRoute = await import("../app/api/v1/me/history/route");
const parentRoute = await import("../app/api/v1/me/parent/route");
const resendRoute = await import("../app/api/v1/me/parent/resend/route");
const linkRoute = await import("../app/api/v1/parent/[token]/route");

afterAll(() => {
  const g = globalThis as unknown as { __verdictLibsql?: { close(): void } };
  g.__verdictLibsql?.close();
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Left for the OS temp cleaner.
  }
});

const BASE = "http://localhost:3600";
const DAY = 24 * 60 * 60_000;
const HOUR = 60 * 60_000;

type Sent = { to: string[]; subject: string; text: string; html: string };
let sent: Sent[] = [];
let mailFails = false;

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("EMAIL_FROM", "Judge <signin@verdict.example.org>");
  vi.stubEnv("CLOUDFLARE_PROXY", "1");
  sent = [];
  mailFails = false;
  const realFetch = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "https://api.resend.com/emails") {
        if (mailFails) return new Response("no", { status: 500 });
        sent.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ id: "x" }), { status: 200 });
      }
      return realFetch(input, init);
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

let ip = 0;
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const request = (method: string, p: string, headers: Record<string, string>, body?: unknown) =>
  new Request(`${BASE}${p}`, {
    method,
    headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${++ip % 250}`, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const postAge = (token: string, body: unknown, geo: Record<string, string> = {}) =>
  ageRoute.POST(request("POST", "/api/v1/me/age", { ...bearer(token), ...geo }, body));
const me = async (token: string) => (await meRoute.GET(request("GET", "/api/v1/me", bearer(token)))).json();
const history = (token: string) => historyRoute.GET(request("GET", "/api/v1/me/history", bearer(token)));
const postParent = (token: string, email: string) => parentRoute.POST(request("POST", "/api/v1/me/parent", bearer(token), { email }));
const getParent = (token: string) => parentRoute.GET(request("GET", "/api/v1/me/parent", bearer(token)));
const linkCall = (token: string, body: unknown) =>
  linkRoute.POST(request("POST", `/api/v1/parent/${token}`, { origin: BASE }, body), { params: Promise.resolve({ token }) });
const linkGet = (token: string) => linkRoute.GET(request("GET", `/api/v1/parent/${token}`, {}), { params: Promise.resolve({ token }) });

/** The calendar date `years` years and `days` days before today (UTC). */
function ago(years: number, days = 0): string {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear() - years, n.getUTCMonth(), n.getUTCDate() - days)).toISOString().slice(0, 10);
}

const pe = () => `p${++counter}@example.com`;
const country = (c: string, region?: string) => ({ "cf-ipcountry": c, ...(region ? { "cf-region-code": region } : {}) });
let counter = 0;
const newUser = () => createDevSession(`p${++counter}-${Math.random().toString(36).slice(2, 7)}@verdict.local`);

async function row(userId: string) {
  const db = await getDb();
  return (await db.execute({ sql: "SELECT * FROM parent_consent WHERE user_id = ?", args: [userId] })).rows[0];
}
async function userRow(userId: string) {
  const db = await getDb();
  return (await db.execute({ sql: 'SELECT * FROM "user" WHERE id = ?', args: [userId] })).rows[0];
}

/** The token in the newest mail's first link. */
const lastToken = () => /\/parent\/([A-Za-z0-9_-]{43})/.exec(sent.at(-1)!.text)![1];

async function teenWaitingForParent(headers = country("DE")) {
  const s = await newUser();
  const res = await postAge(s.token, { dob: ago(15) }, headers);
  expect((await res.json()).parent).toBe("pending");
  return s;
}

describe("the places at the date step", () => {
  it("a teen in a country at 13 gets nothing new in the answer", async () => {
    const { token } = await newUser();
    const res = await postAge(token, { dob: ago(15) }, country("US"));
    expect(await res.json()).toEqual({ confirmed: true, blocked: false, teen: true, needsDob: false });
  });

  it("makes a 15 year old in Germany wait for a parent, and a 16 year old not", async () => {
    const young = await newUser();
    expect(await (await postAge(young.token, { dob: ago(15) }, country("DE"))).json()).toMatchObject({ teen: true, parent: "pending" });
    const older = await newUser();
    expect(await (await postAge(older.token, { dob: ago(16, 5) }, country("DE"))).json()).not.toHaveProperty("parent");
  });

  it("follows each country's own age", async () => {
    const cases: [string, number, boolean][] = [
      ["FR", 14, true],
      ["FR", 15, false],
      ["ES", 13, true],
      ["ES", 14, false],
      ["SE", 13, false],
      ["GB", 13, false],
    ];
    for (const [c, years, held] of cases) {
      const { token } = await newUser();
      const age = await (await postAge(token, { dob: ago(years, 3) }, country(c))).json();
      expect(age.parent === "pending", `${c} at ${years}`).toBe(held);
    }
  });

  it("takes the strictest of the IP, the store and the answer, and an answer can only add", async () => {
    const a = await newUser();
    expect((await (await postAge(a.token, { dob: ago(15), country: "DE" }, country("US"))).json()).parent).toBe("pending");
    const b = await newUser();
    expect((await (await postAge(b.token, { dob: ago(15), country: "US" }, country("DE"))).json()).parent).toBe("pending");
    const c = await newUser();
    expect((await (await postAge(c.token, { dob: ago(15), storeCountry: "DE", country: "US" }, country("US"))).json()).parent).toBe("pending");
    const d = await newUser();
    expect(await (await postAge(d.token, { dob: ago(15), storeCountry: "us", country: "US" }, country("US"))).json()).not.toHaveProperty("parent");
  });

  it("asks nothing of the answer for a 16 year old, and reads the IP and the store", async () => {
    const { token } = await newUser();
    expect(await (await postAge(token, { dob: ago(16, 4), storeCountry: "DE" }, country("DE"))).json()).not.toHaveProperty("parent");
  });

  it("makes a 13 year old in Quebec wait: by the IP region, or by the answer", async () => {
    const byIp = await newUser();
    expect((await (await postAge(byIp.token, { dob: ago(13, 3) }, country("CA", "QC"))).json()).parent).toBe("pending");
    const byAnswer = await newUser();
    expect((await (await postAge(byAnswer.token, { dob: ago(13, 3), country: "CA", quebec: true }, country("CA", "ON"))).json()).parent).toBe("pending");
    const no = await newUser();
    expect(await (await postAge(no.token, { dob: ago(13, 3), country: "CA", quebec: false }, country("CA", "ON"))).json()).not.toHaveProperty("parent");
    const noButQc = await newUser();
    expect((await (await postAge(noButQc.token, { dob: ago(13, 3), country: "CA", quebec: false }, country("CA", "QC"))).json()).parent).toBe("pending");
    const fourteen = await newUser();
    expect(await (await postAge(fourteen.token, { dob: ago(14, 3), quebec: true }, country("CA", "QC"))).json()).not.toHaveProperty("parent");
  });

  it("keeps the places only for a teen", async () => {
    const adult = await newUser();
    await postAge(adult.token, { dob: ago(30), storeCountry: "DE" }, country("DE"));
    const r = await userRow(adult.user.id);
    expect(r.age_country).toBeNull();
    const teen = await newUser();
    await postAge(teen.token, { dob: ago(15), storeCountry: "fr" }, country("DE"));
    expect((await userRow(teen.user.id)).age_country).toBe("DE,FR");
  });

  it("shows the IP's places to pre-select the questions", async () => {
    const { token } = await newUser();
    const hint = async (h: Record<string, string>) => (await ageRoute.GET(request("GET", "/api/v1/me/age", { ...bearer(token), ...h }))).json();
    expect(await hint(country("CA", "QC"))).toEqual({ country: "CA", quebec: true });
    expect(await hint(country("CA", "ON"))).toEqual({ country: "CA", quebec: false });
    expect(await hint(country("DE"))).toEqual({ country: "DE", quebec: null });
    expect(await hint({})).toEqual({ country: null, quebec: null });
  });
});

describe("a store country sent later", () => {
  it("only tightens: Germany adds the step, a looser country takes nothing away", async () => {
    const { token, user } = await newUser();
    await postAge(token, { dob: ago(15) }, country("US"));
    expect(await (await postAge(token, { storeCountry: "US" })).json()).not.toHaveProperty("parent");
    expect((await (await postAge(token, { storeCountry: "DE" })).json()).parent).toBe("pending");
    expect((await (await postAge(token, { storeCountry: "US" })).json()).parent).toBe("pending");
    expect((await userRow(user.id)).age_country).toBe("DE,US");
    expect(await row(user.id)).toMatchObject({ status: "pending" });
  });

  it("is ignored for an adult and for an account that has given no date", async () => {
    const adult = await newUser();
    await postAge(adult.token, { dob: ago(30) });
    expect(await (await postAge(adult.token, { storeCountry: "BR" })).json()).not.toHaveProperty("restricted");
    const none = await newUser();
    expect((await (await postAge(none.token, { storeCountry: "BR" })).json()).needsDob).toBe(true);
  });
});

describe("Brazil", () => {
  it("refuses a teen with 403 age_region everywhere but the open routes", async () => {
    const { token } = await newUser();
    const res = await postAge(token, { dob: ago(15) }, country("BR"));
    expect(await res.json()).toMatchObject({ teen: true, restricted: true });
    const refused = await history(token);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: "age_region" });
    expect((await meRoute.GET(request("GET", "/api/v1/me", bearer(token)))).status).toBe(200);
    expect((await exportRoute.GET(request("GET", "/api/v1/me/export", bearer(token)))).status).toBe(200);
    expect((await getParent(token)).status).toBe(403);
  });

  it("refuses a 17 year old by the store country alone", async () => {
    const { token } = await newUser();
    await postAge(token, { dob: ago(17, 3), storeCountry: "BR" }, country("US"));
    expect((await me(token)).age.restricted).toBe(true);
  });

  it("is not final: support lifts it, and the 18th birthday ends it", async () => {
    const { token, user } = await newUser();
    await postAge(token, { dob: ago(15) }, country("BR"));
    expect((await history(token)).status).toBe(403);
    const db = await getDb();
    await db.execute({ sql: 'UPDATE "user" SET age_region_lifted_at = ? WHERE id = ?', args: [new Date().toISOString(), user.id] });
    expect((await me(token)).age).not.toHaveProperty("restricted");
    // A store country of Brazil sent again does not bring it back.
    await postAge(token, { storeCountry: "BR" });
    expect((await me(token)).age).not.toHaveProperty("restricted");

    const second = await newUser();
    await postAge(second.token, { dob: ago(17, 2) }, country("BR"));
    expect((await me(second.token)).age.restricted).toBe(true);
    await db.execute({ sql: 'UPDATE "user" SET age_dob = ? WHERE id = ?', args: [ago(18, 1), second.user.id] });
    expect((await me(second.token)).age).not.toHaveProperty("restricted");
    expect((await history(second.token)).status).not.toBe(403);
  });

  it("does not touch an adult in Brazil", async () => {
    const { token } = await newUser();
    expect(await (await postAge(token, { dob: ago(30) }, country("BR"))).json()).not.toHaveProperty("restricted");
  });
});

describe("while a parent has to say yes", () => {
  it("answers 403 age_parent_pending on everything but the open routes", async () => {
    const { token } = await teenWaitingForParent();
    const refused = await history(token);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: "age_parent_pending", error: "age_parent_pending" });
    expect((await meRoute.GET(request("GET", "/api/v1/me", bearer(token)))).status).toBe(200);
    expect((await exportRoute.GET(request("GET", "/api/v1/me/export", bearer(token)))).status).toBe(200);
    expect((await getParent(token)).status).toBe(200);
  });

  it("puts what was asked of the parent, without the address, in the data download", async () => {
    const { token } = await teenWaitingForParent();
    await postParent(token, "download.parent@example.com");
    const body = await (await exportRoute.GET(request("GET", "/api/v1/me/export", bearer(token)))).text();
    const data = JSON.parse(body);
    expect(data.account).toMatchObject({ ageCountries: "DE", parentConsent: { status: "pending", lastRequestAt: expect.any(String) } });
    expect(body).not.toContain("download.parent");
  });

  it("lets the account delete itself", async () => {
    const { token, user } = await teenWaitingForParent();
    await getParent(token);
    const res = await meRoute.DELETE(request("DELETE", "/api/v1/me", bearer(token), { confirm: "delete" }));
    expect(res.status).toBe(200);
    expect(await userRow(user.id)).toBeUndefined();
  });
});

describe("asking the parent", () => {
  it("mails the request with the teen's name and both links, and shows the address masked", async () => {
    const { token } = await teenWaitingForParent();
    const res = await postParent(token, "Mom.Smith@example.com");
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(["Mom.Smith@example.com"]);
    expect(sent[0].subject).toBe("Test user wants to use Judge");
    expect(sent[0].text).toContain("/parent/");
    expect(sent[0].text).toContain("?decline=1");
    expect(sent[0].text).toContain("Alazy Inc., 99 Earl St");
    const view = await res.json();
    expect(view).toMatchObject({ status: "pending", sent: true, emailHint: "M***@example.com", resendsLeft: MAX_RESENDS, changesLeft: MAX_CHANGES });
    expect(JSON.stringify(view)).not.toContain("Smith");
  });

  it("refuses the account's own address and another Judge account's", async () => {
    const s = await teenWaitingForParent();
    const other = await newUser();
    expect((await postParent(s.token, s.user.email.toUpperCase())).status).toBe(400);
    const res = await postParent(s.token, other.user.email);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("parent_email");
    expect((await postParent(s.token, "not-an-email")).status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it("is refused for an account that needs no parent", async () => {
    const { token } = await newUser();
    await postAge(token, { dob: ago(15) }, country("US"));
    const res = await postParent(token, "parent@example.com");
    expect(res.status).toBe(409);
    expect(sent).toHaveLength(0);
  });

  it("stores the address sealed, with a keyed hash and a hashed link token", async () => {
    const { token, user } = await teenWaitingForParent();
    await postParent(token, "parent@example.com");
    const r = await row(user.id);
    expect(String(r.parent_email_enc)).toMatch(/^v1\./);
    expect(String(r.parent_email_enc)).not.toContain("parent");
    expect(String(r.parent_email_hash)).toMatch(/^[0-9a-f]{64}$/);
    expect(String(r.token_hash)).toMatch(/^[0-9a-f]{64}$/);
    expect(String(r.token_hash)).not.toContain(lastToken());
    expect(new Date(String(r.expires_at)).getTime() - new Date(String(r.requested_at)).getTime()).toBe(14 * DAY);
  });

  it("changes nothing when the mail cannot be sent", async () => {
    const { token, user } = await teenWaitingForParent();
    mailFails = true;
    const res = await postParent(token, "parent@example.com");
    expect(res.status).toBe(503);
    expect((await row(user.id)).parent_email_hash).toBeNull();
    expect((await (await getParent(token)).json()).sent).toBe(false);
  });
});

describe("resending and changing", () => {
  const ask = (s: { user: { id: string; name: string; email: string } }, email: string | null, now: Date) =>
    requestParent({ userId: s.user.id, userName: s.user.name, userEmail: s.user.email, email, lang: "en", now });

  it("waits an hour between sends and allows 3 resends in all", async () => {
    const s = await teenWaitingForParent();
    const t0 = new Date();
    expect((await ask(s, pe(), t0)).ok).toBe(true);
    const early = await ask(s, null, new Date(t0.getTime() + 30 * 60_000));
    expect(early).toMatchObject({ ok: false, code: "parent_wait" });
    expect("retryAfterSec" in early && early.retryAfterSec).toBe(30 * 60);
    for (let i = 1; i <= MAX_RESENDS; i++) {
      const r = await ask(s, null, new Date(t0.getTime() + i * 61 * 60_000));
      expect(r.ok, `resend ${i}`).toBe(true);
    }
    expect(await ask(s, null, new Date(t0.getTime() + 10 * HOUR))).toMatchObject({ ok: false, code: "parent_limit" });
    expect(sent).toHaveLength(1 + MAX_RESENDS);
  });

  it("a resend over the route answers 429 parent_wait inside the hour", async () => {
    const { token } = await teenWaitingForParent();
    await postParent(token, pe());
    const res = await resendRoute.POST(request("POST", "/api/v1/me/parent/resend", bearer(token), {}));
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: "parent_wait" });
  });

  it("mails a new link that replaces the old one", async () => {
    const s = await teenWaitingForParent();
    const t0 = new Date();
    await ask(s, pe(), t0);
    const first = lastToken();
    await ask(s, null, new Date(t0.getTime() + 2 * HOUR));
    expect(lastToken()).not.toBe(first);
    expect(await decideParent(first, "approve", true, new Date(t0.getTime() + 2 * HOUR))).toBe("invalid");
    expect(await decideParent(lastToken(), "approve", true, new Date(t0.getTime() + 2 * HOUR))).toBe("approved");
  });

  it("allows 3 changes of the address, and mails only the new one", async () => {
    const s = await teenWaitingForParent();
    const t0 = new Date();
    await ask(s, "a1@example.com", t0);
    for (let i = 2; i <= 1 + MAX_CHANGES; i++) {
      expect((await ask(s, `a${i}@example.com`, new Date(t0.getTime() + i))).ok, `change ${i}`).toBe(true);
      expect(sent.at(-1)!.to).toEqual([`a${i}@example.com`]);
    }
    expect(await ask(s, "a9@example.com", new Date(t0.getTime() + 99))).toMatchObject({ ok: false, code: "parent_limit" });
    expect((await parentView(s.user.id)).changesLeft).toBe(0);
  });

  it("allows 5 requests a day to one address, whoever asks", async () => {
    const results: string[] = [];
    for (let i = 0; i < 6; i++) {
      const s = await teenWaitingForParent();
      const r = await ask(s, "busy@example.com", new Date());
      results.push(r.ok ? "ok" : r.code);
    }
    expect(results).toEqual(["ok", "ok", "ok", "ok", "ok", "rate_limited"]);
  });
});

describe("the parent's links", () => {
  it("shows what the link is for", async () => {
    const { token } = await teenWaitingForParent();
    await postParent(token, pe());
    const t = lastToken();
    expect(await (await linkGet(t)).json()).toEqual({ kind: "request", name: "Test user", usable: true });
    expect((await linkGet("a".repeat(43))).status).toBe(404);
    expect((await linkGet("short")).status).toBe(404);
  });

  it("needs the tick to approve, then lifts the hold and mails the withdraw link", async () => {
    const { token, user } = await teenWaitingForParent();
    await postParent(token, pe());
    const t = lastToken();
    const noTick = await linkCall(t, { action: "approve" });
    expect(noTick.status).toBe(400);
    expect((await me(token)).age.parent).toBe("pending");

    const ok = await linkCall(t, { action: "approve", guardian: true });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ result: "approved" });
    expect((await me(token)).age).toEqual({ confirmed: true, blocked: false, teen: true, needsDob: false });
    expect((await history(token)).status).not.toBe(403);

    const mail = sent.at(-1)!;
    expect(mail.to).toEqual(sent[0].to);
    expect(mail.subject).toBe("You approved Test user's Judge account");
    const withdrawToken = lastToken();
    expect(withdrawToken).not.toBe(t);
    expect(await (await linkGet(withdrawToken)).json()).toEqual({ kind: "withdraw", name: "Test user", usable: true });

    // The same link works once.
    expect((await linkCall(t, { action: "approve", guardian: true })).status).toBe(404);
    expect((await linkCall(t, { action: "decline" })).status).toBe(404);
    expect((await linkGet(t)).status).toBe(404);
    const r = await row(user.id);
    expect(r).toMatchObject({ status: "approved", parent_email_enc: null, token_hash: null, policy_version: expect.any(String), wording_key: "parent.tick" });
    expect(String(r.parent_email_hash)).toMatch(/^[0-9a-f]{64}$/);
    expect((await userRow(user.id)).age_parent).toBe("approved");
  });

  it("keeps no plain address anywhere after the approval", async () => {
    const { user } = await teenWaitingForParent().then(async (s) => {
      await postParent(s.token, "very.unique.address@example.com");
      await linkCall(lastToken(), { action: "approve", guardian: true });
      return s;
    });
    const db = await getDb();
    const dump = JSON.stringify((await db.execute({ sql: "SELECT * FROM parent_consent WHERE user_id = ?", args: [user.id] })).rows);
    expect(dump).not.toContain("unique");
    expect(dump).not.toContain("example.com");
    const all = JSON.stringify((await db.execute({ sql: 'SELECT * FROM "user" WHERE id = ?', args: [user.id] })).rows);
    expect(all).not.toContain("very.unique");
  });

  it("takes the approval back and keeps the link when the confirmation mail fails", async () => {
    const { token, user } = await teenWaitingForParent();
    await postParent(token, pe());
    const t = lastToken();
    mailFails = true;
    expect((await linkCall(t, { action: "approve", guardian: true })).status).toBe(503);
    expect(await row(user.id)).toMatchObject({ status: "pending", withdraw_hash: null });
    expect((await me(token)).age.parent).toBe("pending");
    mailFails = false;
    expect((await linkCall(t, { action: "approve", guardian: true })).status).toBe(200);
  });

  it("declines: the account stays held, no new request, and it is deleted after 30 days", async () => {
    const { token, user } = await teenWaitingForParent();
    await postParent(token, pe());
    const t = lastToken();
    expect(await (await linkCall(t, { action: "decline" })).json()).toEqual({ result: "declined" });
    expect((await me(token)).age.parent).toBe("declined");
    expect(await row(user.id)).toMatchObject({ status: "declined", parent_email_enc: null, token_hash: null });
    const again = await postParent(token, "other@example.com");
    expect(again.status).toBe(409);
    expect((await again.json()).code).toBe("parent_declined");

    expect((await runCleanup(new Date(Date.now() + 29 * DAY))).parentless).toBe(0);
    expect(await userRow(user.id)).toBeDefined();
    const counts = await runCleanup(new Date(Date.now() + 31 * DAY));
    expect(counts.parentless).toBeGreaterThanOrEqual(1);
    expect(await userRow(user.id)).toBeUndefined();
  });

  it("refuses an expired link, and a resend makes a working one", async () => {
    const s = await teenWaitingForParent();
    const t0 = new Date();
    await requestParent({ userId: s.user.id, userName: "Test user", userEmail: s.user.email, email: pe(), lang: "en", now: t0 });
    const old = lastToken();
    const after = new Date(t0.getTime() + 15 * DAY);
    expect(await decideParent(old, "approve", true, after)).toBe("invalid");
    expect((await parentView(s.user.id, after)).expired).toBe(true);
    expect((await me(s.token)).age.parent).toBe("pending");
    expect((await requestParent({ userId: s.user.id, userName: "Test user", userEmail: s.user.email, email: null, lang: "en", now: after })).ok).toBe(true);
    expect(await decideParent(lastToken(), "approve", true, after)).toBe("approved");
  });

  it("works on the last day of the 14", async () => {
    const s = await teenWaitingForParent();
    const t0 = new Date();
    await requestParent({ userId: s.user.id, userName: "Test user", userEmail: s.user.email, email: pe(), lang: "en", now: t0 });
    expect(await decideParent(lastToken(), "decline", false, new Date(t0.getTime() + 14 * DAY - 1000))).toBe("declined");
  });

  it("refuses another origin on a decision", async () => {
    const { token } = await teenWaitingForParent();
    await postParent(token, pe());
    const t = lastToken();
    const res = await linkRoute.POST(request("POST", `/api/v1/parent/${t}`, { origin: "https://evil.example" }, { action: "decline" }), {
      params: Promise.resolve({ token: t }),
    });
    expect(res.status).toBe(403);
  });
});

describe("withdrawing", () => {
  async function approved() {
    const s = await teenWaitingForParent();
    await postParent(s.token, pe());
    await linkCall(lastToken(), { action: "approve", guardian: true });
    return { ...s, withdraw: lastToken() };
  }

  it("locks the account again, once, and it is deleted after 30 days", async () => {
    const { token, user, withdraw } = await approved();
    expect(await (await linkCall(withdraw, { action: "withdraw" })).json()).toEqual({ result: "withdrawn" });
    expect((await me(token)).age.parent).toBe("revoked");
    expect((await history(token)).status).toBe(403);
    expect((await linkCall(withdraw, { action: "withdraw" })).status).toBe(404);
    expect(await row(user.id)).toMatchObject({ status: "revoked", withdraw_hash: null });

    expect((await runCleanup(new Date(Date.now() + 29 * DAY))).parentless).toBe(0);
    expect((await runCleanup(new Date(Date.now() + 31 * DAY))).parentless).toBeGreaterThanOrEqual(1);
    expect(await userRow(user.id)).toBeUndefined();
  });

  it("does not let a request link withdraw, or a withdraw link approve", async () => {
    const s = await teenWaitingForParent();
    await postParent(s.token, pe());
    const request1 = lastToken();
    expect((await linkCall(request1, { action: "withdraw" })).status).toBe(404);
    await linkCall(request1, { action: "approve", guardian: true });
    expect((await linkCall(lastToken(), { action: "approve", guardian: true })).status).toBe(404);
  });

  it("lets the teen ask again after a withdrawal, with fresh counts", async () => {
    const { token, user, withdraw } = await approved();
    await linkCall(withdraw, { action: "withdraw" });
    const res = await postParent(token, "p2@example.com");
    expect(res.status).toBe(200);
    expect((await me(token)).age.parent).toBe("pending");
    expect(await row(user.id)).toMatchObject({ status: "pending", resend_count: 0, change_count: 0 });
    expect(await decideParent(lastToken(), "approve", true)).toBe("approved");
    expect((await me(token)).age).not.toHaveProperty("parent");
  });
});

describe("waiting without an answer", () => {
  it("deletes an account that waited 30 days, starting from the first request", async () => {
    const { token, user } = await teenWaitingForParent();
    await postParent(token, pe());
    const view = await parentView(user.id);
    expect(new Date(view.deleteAt!).getTime() - Date.now()).toBeGreaterThan(29 * DAY);
    expect((await runCleanup(new Date(Date.now() + 29 * DAY))).parentless).toBe(0);
    expect(await userRow(user.id)).toBeDefined();
    expect((await runCleanup(new Date(Date.now() + 31 * DAY))).parentless).toBeGreaterThanOrEqual(1);
    expect(await userRow(user.id)).toBeUndefined();
  });

  it("does not delete a teen who has since grown past the age, or an approved one", async () => {
    const grown = await teenWaitingForParent();
    const approvedOne = await teenWaitingForParent();
    await postParent(approvedOne.token, pe());
    await linkCall(lastToken(), { action: "approve", guardian: true });
    const db = await getDb();
    await db.execute({ sql: 'UPDATE "user" SET age_dob = ? WHERE id = ?', args: [ago(16, 10), grown.user.id] });
    await runCleanup(new Date(Date.now() + 40 * DAY));
    expect(await userRow(grown.user.id)).toBeDefined();
    expect(await userRow(approvedOne.user.id)).toBeDefined();
    expect((await me(grown.token)).age).not.toHaveProperty("parent");
  });
});

describe("the proof record", () => {
  it("keeps what was asked and decided, without any address, for 12 months after the account goes", async () => {
    const { token, user } = await teenWaitingForParent();
    await postParent(token, pe());
    await linkCall(lastToken(), { action: "approve", guardian: true });
    const before = await row(user.id);
    const id = before.id;
    expect((await meRoute.DELETE(request("DELETE", "/api/v1/me", bearer(token), { confirm: "delete" }))).status).toBe(200);

    const db = await getDb();
    const kept = (await db.execute({ sql: "SELECT * FROM parent_consent WHERE id = ?", args: [id] })).rows[0];
    expect(kept).toMatchObject({
      status: "approved",
      parent_email_hash: null,
      parent_email_enc: null,
      token_hash: null,
      withdraw_hash: null,
      wording_key: "parent.tick",
      country: "DE",
    });
    expect(String(kept.user_id)).not.toBe(user.id);
    expect(kept.user_deleted_at).toEqual(expect.any(String));
    expect(kept.policy_version).toEqual(expect.any(String));

    await runCleanup(new Date(Date.now() + 360 * DAY));
    expect((await db.execute({ sql: "SELECT 1 FROM parent_consent WHERE id = ?", args: [id] })).rows).toHaveLength(1);
    const counts = await runCleanup(new Date(Date.now() + 370 * DAY));
    expect(counts.parentRecords).toBeGreaterThanOrEqual(1);
    expect((await db.execute({ sql: "SELECT 1 FROM parent_consent WHERE id = ?", args: [id] })).rows).toHaveLength(0);
  });

  it("is also kept when the 30-day cleanup deletes the account", async () => {
    const { token, user } = await teenWaitingForParent();
    await postParent(token, pe());
    const id = (await row(user.id)).id;
    await runCleanup(new Date(Date.now() + 31 * DAY));
    const db = await getDb();
    const kept = (await db.execute({ sql: "SELECT * FROM parent_consent WHERE id = ?", args: [id] })).rows[0];
    expect(kept).toMatchObject({ status: "pending", parent_email_hash: null, parent_email_enc: null, token_hash: null });
    expect(kept.user_deleted_at).toEqual(expect.any(String));
    // A link from before the deletion no longer matches anything.
    expect((await linkGet(lastToken())).status).toBe(404);
    void token;
  });
});
