import { generateKeyPairSync, randomBytes, sign, verify, type KeyObject } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Sign in with Apple token revocation on account deletion: the refresh token
 * is kept (sealed) from the website callback and from the app's code
 * exchange, revoked at Apple with the right client id when the account is
 * deleted, and removed. Real auth and database; Apple is a mocked fetch.
 */

const dir = mkdtempSync(path.join(tmpdir(), "verdict-signin-tokens-"));
const removalLog = path.join(dir, "removals.log");
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const WEB_ID = "com.okjudge.web";
const APP_ID = "com.okjudge.app";

process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;
process.env.BETTER_AUTH_SECRET = "test-secret-".padEnd(48, "x");
process.env.BETTER_AUTH_URL = "http://localhost:3600";
process.env.REMOVAL_LOG = removalLog;
process.env.ORIGINALS_KEY = randomBytes(32).toString("base64");
process.env.APPLE_CLIENT_ID = WEB_ID;
process.env.APPLE_TEAM_ID = "TEAM123456";
process.env.APPLE_KEY_ID = "KEY1234567";
process.env.APPLE_PRIVATE_KEY_BASE64 = Buffer.from(
  privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
).toString("base64");
process.env.APPLE_APP_BUNDLE_ID = APP_ID;
process.env.GOOGLE_CLIENT_ID = "google-web-client";
process.env.GOOGLE_CLIENT_SECRET = "google-secret";

const { createDevSession, getAuth } = await import("../lib/auth");
const { getDb } = await import("../lib/db");
const { aad, openJson } = await import("../lib/originals/crypto");
const signinTokens = await import("../lib/signin-tokens");
const { APPLE_REVOKE_URL, APPLE_TOKEN_URL } = signinTokens;
const removal = await import("../lib/originals/removal");
const ratelimit = await import("../lib/ratelimit");
const { POST: postCode } = await import("../app/api/v1/auth/apple/code/route");
const { DELETE: deleteMe } = await import("../app/api/v1/me/route");

const ORIGIN = "http://localhost:3600";

type AppleCall = { url: string; params: URLSearchParams };
let appleCalls: AppleCall[] = [];
let appleReply: (call: AppleCall) => Response | Promise<Response> = () => new Response("{}", { status: 500 });
let logged: string[] = [];

beforeEach(() => {
  appleCalls = [];
  logged = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const call = { url, params: new URLSearchParams(String(init?.body ?? "")) };
      appleCalls.push(call);
      return appleReply(call);
    }),
  );
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map((a) => (a instanceof Error ? a.message : typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    });
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

afterAll(() => {
  const g = globalThis as unknown as { __verdictLibsql?: { close(): void } };
  g.__verdictLibsql?.close();
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Left for the OS temp cleaner.
  }
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const b64url = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
const fakeIdToken = (claims: Record<string, unknown>) =>
  `${b64url({ alg: "RS256", kid: "k" })}.${b64url({ iss: "https://appleid.apple.com", iat: 1, exp: 9_999_999_999, ...claims })}.sig`;

/** A provider ID-token signer whose public key the mocked JWKS endpoints serve. */
const idKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const JWKS = { keys: [{ ...idKeys.publicKey.export({ format: "jwk" }), kid: "test-kid", alg: "RS256", use: "sig" }] };
const JWKS_URLS = ["https://appleid.apple.com/auth/keys", "https://www.googleapis.com/oauth2/v3/certs"];
function signedIdToken(claims: Record<string, unknown>): string {
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64url({ alg: "RS256", kid: "test-kid", typ: "JWT" })}.${b64url({ iat: now, exp: now + 600, ...claims })}`;
  return `${input}.${sign("sha256", Buffer.from(input), idKeys.privateKey).toString("base64url")}`;
}

async function idTokenSignIn(provider: "apple" | "google", idToken: Record<string, unknown>) {
  const auth = await getAuth();
  return auth.handler(
    new Request(`${ORIGIN}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ provider, idToken }),
    }),
  );
}

async function accountTokens(userId: string, providerId: string) {
  const db = await getDb();
  const res = await db.execute({
    sql: "SELECT accessToken, refreshToken, idToken FROM account WHERE userId = ? AND providerId = ?",
    args: [userId, providerId],
  });
  return res.rows.map((r) => ({ accessToken: r.accessToken, refreshToken: r.refreshToken, idToken: r.idToken }));
}

function tokenReply(refreshToken: string, claims: Record<string, unknown>) {
  return json({
    access_token: `access-${refreshToken}`,
    token_type: "Bearer",
    expires_in: 3600,
    refresh_token: refreshToken,
    id_token: fakeIdToken(claims),
  });
}

/** The client secret JWT Apple was sent: signed with our key, for this client id. */
function expectClientSecret(jwt: string | null, clientId: string, key: KeyObject = publicKey) {
  expect(jwt).toBeTruthy();
  const [h, p, s] = jwt!.split(".");
  expect(JSON.parse(Buffer.from(p, "base64url").toString())).toMatchObject({
    iss: "TEAM123456",
    sub: clientId,
    aud: "https://appleid.apple.com",
  });
  const ok = verify("sha256", Buffer.from(`${h}.${p}`), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url"));
  expect(ok).toBe(true);
}

async function storedTokens(userId: string) {
  const db = await getDb();
  const res = await db.execute({
    sql: "SELECT provider, client_id, sealed FROM signin_tokens WHERE user_id = ? ORDER BY client_id",
    args: [userId],
  });
  return res.rows.map((r) => ({ provider: String(r.provider), clientId: String(r.client_id), sealed: String(r.sealed) }));
}

async function linkApple(userId: string, sub: string) {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO account (id, accountId, providerId, userId, createdAt, updatedAt)
          VALUES (?, ?, 'apple', ?, ?, ?)`,
    args: [`acc-${sub}`, sub, userId, now, now],
  });
}

const postAppleCode = (headers: Record<string, string>, body: unknown) =>
  postCode(
    new Request(`${ORIGIN}/api/v1/auth/apple/code`, {
      method: "POST",
      headers: { "content-type": "application/json", host: "localhost:3600", ...headers },
      body: JSON.stringify(body),
    }),
  );

const deleteAccount = (token: string) =>
  deleteMe(
    new Request(`${ORIGIN}/api/v1/me`, {
      method: "DELETE",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ confirm: "delete" }),
    }),
  );

/** A full website Sign in with Apple: start, then Apple's callback with a code. */
async function webAppleSignIn(code: string) {
  const auth = await getAuth();
  const start = await auth.handler(
    new Request(`${ORIGIN}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ provider: "apple", callbackURL: `${ORIGIN}/` }),
    }),
  );
  expect(start.status).toBe(200);
  const { url } = (await start.json()) as { url: string };
  const state = new URL(url).searchParams.get("state")!;
  const cookie = start.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const callback = await auth.handler(
    new Request(`${ORIGIN}/api/auth/callback/apple?${new URLSearchParams({ code, state })}`, { headers: { cookie } }),
  );
  return callback;
}

function removalEntries(): Record<string, unknown>[] {
  try {
    return readFileSync(removalLog, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  } catch {
    return [];
  }
}

describe("website Sign in with Apple keeps the refresh token", () => {
  it("stores it sealed for the Services ID on first and returning sign-in, never on the account row", async () => {
    const claims = { sub: "apple-web-1", aud: WEB_ID, email: "web1@verdict.local", email_verified: true };
    appleReply = (call) => (call.url === APPLE_TOKEN_URL ? tokenReply("rt-web-first-SECRET", claims) : json({}, 404));

    const first = await webAppleSignIn("web-code-1");
    expect(first.status).toBe(302);
    expect(first.headers.get("location")).toBe(`${ORIGIN}/`);
    expect(appleCalls).toHaveLength(1);
    expect(appleCalls[0].params.get("client_id")).toBe(WEB_ID);
    expect(appleCalls[0].params.get("code")).toBe("web-code-1");

    const db = await getDb();
    const user = (await db.execute({ sql: 'SELECT id FROM "user" WHERE email = ?', args: ["web1@verdict.local"] })).rows[0];
    const userId = String(user.id);
    const account = (
      await db.execute({ sql: "SELECT accessToken, refreshToken, idToken FROM account WHERE userId = ?", args: [userId] })
    ).rows[0];
    expect(account).toMatchObject({ accessToken: null, refreshToken: null, idToken: null });

    let rows = await storedTokens(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: "apple", clientId: WEB_ID });
    expect(rows[0].sealed).not.toContain("rt-web-first-SECRET");
    expect(openJson(rows[0].sealed, aad.signInToken("apple", WEB_ID, userId))).toBe("rt-web-first-SECRET");

    // A returning sign-in replaces it with the fresh token.
    appleReply = (call) => (call.url === APPLE_TOKEN_URL ? tokenReply("rt-web-second-SECRET", claims) : json({}, 404));
    expect((await webAppleSignIn("web-code-2")).status).toBe(302);
    rows = await storedTokens(userId);
    expect(rows).toHaveLength(1);
    expect(openJson(rows[0].sealed, aad.signInToken("apple", WEB_ID, userId))).toBe("rt-web-second-SECRET");
    // The account update on a returning sign-in still writes no token to the row.
    expect(await accountTokens(userId, "apple")).toEqual([{ accessToken: null, refreshToken: null, idToken: null }]);

    expect(logged.join("\n")).not.toMatch(/rt-web-(first|second)-SECRET/);
  });

  it("stores it for an existing account that links Apple on the website", async () => {
    const { user } = await createDevSession("link1@verdict.local");
    const claims = { sub: "apple-link-1", aud: WEB_ID, email: "link1@verdict.local", email_verified: true };
    appleReply = (call) => (call.url === APPLE_TOKEN_URL ? tokenReply("rt-link-SECRET", claims) : json({}, 404));
    expect((await webAppleSignIn("web-link-1")).status).toBe(302);
    const rows = await storedTokens(user.id);
    expect(rows).toHaveLength(1);
    expect(openJson(rows[0].sealed, aad.signInToken("apple", WEB_ID, user.id))).toBe("rt-link-SECRET");
  });

  it("keeps tokens only from Better Auth's OAuth callback, never from another endpoint", async () => {
    const { user } = await createDevSession("guard1@verdict.local");
    const account = { providerId: "apple", refreshToken: "rt-body-SECRET", userId: user.id };
    for (const context of [{ path: "/link-social" }, { path: "/sign-in/social" }, null]) {
      signinTokens.captureAppleRefreshToken(account, context);
      await signinTokens.keepCapturedAppleRefreshToken(account, context, WEB_ID);
    }
    expect(await storedTokens(user.id)).toHaveLength(0);

    const callback = { path: "/callback/:id" };
    signinTokens.captureAppleRefreshToken({ ...account, refreshToken: "rt-callback-SECRET" }, callback);
    await signinTokens.keepCapturedAppleRefreshToken(account, callback, WEB_ID);
    const rows = await storedTokens(user.id);
    expect(rows).toHaveLength(1);
    expect(openJson(rows[0].sealed, aad.signInToken("apple", WEB_ID, user.id))).toBe("rt-callback-SECRET");
  });

  it("link-social is off, so a client-supplied refresh token cannot replace the stored one", async () => {
    const claims = { sub: "apple-web-ls", aud: WEB_ID, email: "ls1@verdict.local", email_verified: true };
    appleReply = (call) => (call.url === APPLE_TOKEN_URL ? tokenReply("rt-real-SECRET", claims) : json({}, 404));
    expect((await webAppleSignIn("web-ls")).status).toBe(302);
    const { token, user } = await createDevSession("ls1@verdict.local");

    appleReply = (call) => (JWKS_URLS.includes(call.url) ? json(JWKS) : json({}, 404));
    const auth = await getAuth();
    const res = await auth.handler(
      new Request(`${ORIGIN}/api/auth/link-social`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN, authorization: `Bearer ${token}` },
        body: JSON.stringify({
          provider: "apple",
          idToken: {
            token: signedIdToken({ iss: "https://appleid.apple.com", aud: APP_ID, sub: "apple-web-ls" }),
            refreshToken: "rt-forged",
          },
        }),
      }),
    );
    expect(res.status).toBe(404);
    const rows = await storedTokens(user.id);
    expect(rows).toHaveLength(1);
    expect(openJson(rows[0].sealed, aad.signInToken("apple", WEB_ID, user.id))).toBe("rt-real-SECRET");
  });
});

describe("native ID-token sign-in with updateAccountOnSignIn on", () => {
  beforeEach(() => {
    appleReply = (call) => (JWKS_URLS.includes(call.url) ? json(JWKS) : json({}, 404));
  });

  it("a returning Apple ID-token sign-in succeeds, keeps no token and ignores a refresh token in the body", async () => {
    const idToken = () =>
      signedIdToken({
        iss: "https://appleid.apple.com",
        aud: APP_ID,
        sub: "apple-idt-1",
        email: "idt1@verdict.local",
        email_verified: true,
      });
    const first = await idTokenSignIn("apple", { token: idToken(), refreshToken: "rt-forged-1" });
    expect(first.status).toBe(200);
    const { user } = (await first.json()) as { user: { id: string } };
    const again = await idTokenSignIn("apple", { token: idToken(), refreshToken: "rt-forged-2" });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { user: { id: string } }).user.id).toBe(user.id);
    expect(await accountTokens(user.id, "apple")).toEqual([{ accessToken: null, refreshToken: null, idToken: null }]);
    expect(await storedTokens(user.id)).toHaveLength(0);
  });

  it("a returning Google ID-token sign-in succeeds and keeps no token", async () => {
    const idToken = () =>
      signedIdToken({
        iss: "https://accounts.google.com",
        aud: "google-web-client",
        sub: "google-idt-1",
        email: "gidt1@verdict.local",
        email_verified: true,
      });
    const first = await idTokenSignIn("google", { token: idToken(), accessToken: "ga-1" });
    expect(first.status).toBe(200);
    const { user } = (await first.json()) as { user: { id: string } };
    const again = await idTokenSignIn("google", { token: idToken(), accessToken: "ga-2" });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { user: { id: string } }).user.id).toBe(user.id);
    expect(await accountTokens(user.id, "google")).toEqual([{ accessToken: null, refreshToken: null, idToken: null }]);
    expect(await storedTokens(user.id)).toHaveLength(0);
  });
});

describe("POST /api/v1/auth/apple/code", () => {
  it("exchanges the app's code with the bundle id and stores the refresh token sealed", async () => {
    const { token, user } = await createDevSession("native1@verdict.local");
    await linkApple(user.id, "apple-native-1");
    appleReply = () => tokenReply("rt-native-SECRET", { sub: "apple-native-1", aud: APP_ID });

    const res = await postAppleCode({ authorization: `Bearer ${token}` }, { code: "c0de.native-1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stored: true });

    expect(appleCalls).toHaveLength(1);
    const { url, params } = appleCalls[0];
    expect(url).toBe(APPLE_TOKEN_URL);
    expect(params.get("client_id")).toBe(APP_ID);
    expect(params.get("grant_type")).toBe("authorization_code");
    expect(params.get("code")).toBe("c0de.native-1");
    expect(params.has("redirect_uri")).toBe(false);
    expectClientSecret(params.get("client_secret"), APP_ID);

    const rows = await storedTokens(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: "apple", clientId: APP_ID });
    expect(rows[0].sealed).not.toContain("rt-native-SECRET");
    expect(openJson(rows[0].sealed, aad.signInToken("apple", APP_ID, user.id))).toBe("rt-native-SECRET");
    // Bound to its row: another user's AAD does not open it.
    expect(() => openJson(rows[0].sealed, aad.signInToken("apple", APP_ID, "someone-else"))).toThrow();
    expect(logged.join("\n")).not.toContain("rt-native-SECRET");
  });

  it("refuses a code for another Apple ID, an account without Apple, and a code Apple rejects", async () => {
    const { token, user } = await createDevSession("native2@verdict.local");
    const auth = { authorization: `Bearer ${token}` };

    const noApple = await postAppleCode(auth, { code: "c1" });
    expect(noApple.status).toBe(400);
    expect(await noApple.json()).toMatchObject({ code: "invalid" });
    expect(appleCalls).toHaveLength(0);

    await linkApple(user.id, "apple-native-2");
    appleReply = () => tokenReply("rt-other-SECRET", { sub: "apple-someone-else", aud: APP_ID });
    const mismatch = await postAppleCode(auth, { code: "c2" });
    expect(mismatch.status).toBe(400);
    // The other Apple ID's token is revoked, not kept.
    const revoke = appleCalls.find((c) => c.url === APPLE_REVOKE_URL);
    expect(revoke?.params.get("token")).toBe("rt-other-SECRET");
    expect(revoke?.params.get("client_id")).toBe(APP_ID);
    expectClientSecret(revoke!.params.get("client_secret"), APP_ID);
    appleReply = () => tokenReply("rt-wrongaud-SECRET", { sub: "apple-native-2", aud: WEB_ID });
    expect((await postAppleCode(auth, { code: "c2b" })).status).toBe(400);

    appleReply = () => json({ error: "invalid_grant" }, 400);
    const rejected = await postAppleCode(auth, { code: "c3" });
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({ code: "invalid" });

    appleReply = () => {
      throw new Error("network down");
    };
    const down = await postAppleCode(auth, { code: "c4" });
    expect(down.status).toBe(503);
    expect(await down.json()).toMatchObject({ code: "unavailable" });

    expect(await storedTokens(user.id)).toHaveLength(0);
    expect(logged.join("\n")).not.toMatch(/rt-(other|wrongaud)-SECRET/);
  });

  it("401 signed out, 400 without a code, 503 when the app's bundle id is not configured", async () => {
    expect((await postAppleCode({}, { code: "c" })).status).toBe(401);
    expect((await postAppleCode({ authorization: "Bearer not-a-session" }, { code: "c" })).status).toBe(401);
    const { token, user } = await createDevSession("native3@verdict.local");
    await linkApple(user.id, "apple-native-3");
    const auth = { authorization: `Bearer ${token}` };
    for (const body of [{}, { code: "" }, { code: 5 }, { code: "has spaces" }]) {
      const res = await postAppleCode(auth, body);
      expect(res.status).toBe(400);
    }
    vi.stubEnv("APPLE_APP_BUNDLE_ID", "");
    const res = await postAppleCode(auth, { code: "c" });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "not_configured" });
    expect(appleCalls).toHaveLength(0);
  });

  it("does not spend the code when the token could not be sealed", async () => {
    const { token, user } = await createDevSession("native4@verdict.local");
    await linkApple(user.id, "apple-native-4");
    vi.stubEnv("ORIGINALS_KEY", "not-a-key");
    const res = await postAppleCode({ authorization: `Bearer ${token}` }, { code: "c-nokey" });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "not_configured" });
    expect(appleCalls).toHaveLength(0);
  });

  it("is rate limited per account (10 per 10 minutes), with Retry-After", async () => {
    const { token, user } = await createDevSession("native5@verdict.local");
    await linkApple(user.id, "apple-native-5");
    appleReply = () => json({ error: "invalid_grant" }, 400);
    const auth = { authorization: `Bearer ${token}` };
    for (let i = 0; i < 10; i++) expect((await postAppleCode(auth, { code: `rl-${i}` })).status).toBe(400);
    const limited = await postAppleCode(auth, { code: "rl-10" });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ code: "rate_limited" });
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(appleCalls).toHaveLength(10);
  });

  it("503 when the limiter is unavailable", async () => {
    const { token, user } = await createDevSession("native6@verdict.local");
    await linkApple(user.id, "apple-native-6");
    vi.spyOn(ratelimit, "checkUserLimits").mockResolvedValueOnce({ ok: false, code: "unavailable", error: "down" });
    const res = await postAppleCode({ authorization: `Bearer ${token}` }, { code: "c-limiter" });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "unavailable" });
    expect(appleCalls).toHaveLength(0);
  });
});

describe("DELETE /api/v1/me revokes Apple tokens", () => {
  async function userWithBothTokens(email: string, sub: string) {
    const claims = { sub, aud: WEB_ID, email, email_verified: true };
    appleReply = (call) => (call.url === APPLE_TOKEN_URL ? tokenReply(`rt-web-${sub}`, claims) : json({}, 404));
    expect((await webAppleSignIn(`web-${sub}`)).status).toBe(302);
    // createDevSession finds the user the Apple sign-in created.
    const { token, user } = await createDevSession(email);
    appleReply = () => tokenReply(`rt-app-${sub}`, { sub, aud: APP_ID });
    expect((await postAppleCode({ authorization: `Bearer ${token}` }, { code: `app-${sub}` })).status).toBe(200);
    expect(await storedTokens(user.id)).toHaveLength(2);
    appleCalls = [];
    return { token, user };
  }

  it("revokes each token with its own client id and secret, then deletes the tokens and the account", async () => {
    const { token, user } = await userWithBothTokens("del1@verdict.local", "apple-del-1");
    appleReply = () => new Response(null, { status: 200 });

    const res = await deleteAccount(token);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });

    expect(appleCalls).toHaveLength(2);
    const byClient = new Map(appleCalls.map((c) => [c.params.get("client_id"), c]));
    for (const [clientId, refresh] of [
      [WEB_ID, "rt-web-apple-del-1"],
      [APP_ID, "rt-app-apple-del-1"],
    ] as const) {
      const call = byClient.get(clientId)!;
      expect(call.url).toBe(APPLE_REVOKE_URL);
      expect(call.params.get("token")).toBe(refresh);
      expect(call.params.get("token_type_hint")).toBe("refresh_token");
      expectClientSecret(call.params.get("client_secret"), clientId);
    }

    expect(await storedTokens(user.id)).toHaveLength(0);
    const db = await getDb();
    expect((await db.execute({ sql: 'SELECT count(*) AS n FROM "user" WHERE id = ?', args: [user.id] })).rows[0].n).toBe(0);
    const entry = removalEntries().find((e) => e.kind === "account" && e.id === user.id);
    expect(entry).toMatchObject({ signInTokens: { apple: "revoked" } });

    const output = logged.join("\n") + readFileSync(removalLog, "utf8");
    expect(output).not.toContain("rt-web-apple-del-1");
    expect(output).not.toContain("rt-app-apple-del-1");
  });

  it("still deletes the account when Apple fails, records the failure, and logs no token", async () => {
    const { token, user } = await userWithBothTokens("del2@verdict.local", "apple-del-2");
    appleReply = (call) => {
      if (call.params.get("client_id") === WEB_ID) throw new Error("connect ETIMEDOUT");
      return json({ error: "invalid_client" }, 400);
    };

    const res = await deleteAccount(token);
    expect(res.status).toBe(200);
    expect(appleCalls).toHaveLength(2);
    expect(await storedTokens(user.id)).toHaveLength(0);
    const db = await getDb();
    expect((await db.execute({ sql: 'SELECT count(*) AS n FROM "user" WHERE id = ?', args: [user.id] })).rows[0].n).toBe(0);
    expect((await db.execute({ sql: "SELECT count(*) AS n FROM account WHERE userId = ?", args: [user.id] })).rows[0].n).toBe(0);
    const entry = removalEntries().find((e) => e.kind === "account" && e.id === user.id);
    expect(entry).toMatchObject({ signInTokens: { apple: "failed" } });

    const output = logged.join("\n");
    expect(output).toMatch(/Apple (revocation failed|refused a revocation)/);
    expect(output + readFileSync(removalLog, "utf8")).not.toMatch(/rt-(web|app)-apple-del-2/);
  });

  it("keeps tokens Apple did not revoke for a retried deletion, which logs the real outcome", async () => {
    const { token, user } = await userWithBothTokens("del6@verdict.local", "apple-del-6");
    appleReply = () => json({ error: "server_error" }, 500);
    vi.spyOn(removal, "removeUserData").mockRejectedValueOnce(new Error("db busy"));
    const failed = await deleteAccount(token);
    expect(failed.status).toBe(503);
    expect(await storedTokens(user.id)).toHaveLength(2);
    expect(removalEntries().some((e) => e.id === user.id)).toBe(false);

    appleCalls = [];
    appleReply = () => new Response(null, { status: 200 });
    const retried = await deleteAccount(token);
    expect(retried.status).toBe(200);
    expect(appleCalls.map((c) => c.params.get("token")).sort()).toEqual(["rt-app-apple-del-6", "rt-web-apple-del-6"]);
    expect(await storedTokens(user.id)).toHaveLength(0);
    const entry = removalEntries().find((e) => e.kind === "account" && e.id === user.id);
    expect(entry).toMatchObject({ signInTokens: { apple: "revoked" } });
  });

  it("records a partial revocation when only some tokens were revoked", async () => {
    const { token, user } = await userWithBothTokens("del4@verdict.local", "apple-del-4");
    appleReply = (call) =>
      call.params.get("client_id") === APP_ID ? new Response(null, { status: 200 }) : json({ error: "invalid_request" }, 400);
    expect((await deleteAccount(token)).status).toBe(200);
    expect(await storedTokens(user.id)).toHaveLength(0);
    const entry = removalEntries().find((e) => e.kind === "account" && e.id === user.id);
    expect(entry).toMatchObject({ signInTokens: { apple: "partial" } });
  });

  it("a stored token that cannot be opened counts as failed and the account is still deleted", async () => {
    const { token, user } = await createDevSession("del5@verdict.local");
    const db = await getDb();
    const now = new Date().toISOString();
    await db.execute({
      sql: `INSERT INTO signin_tokens (user_id, provider, client_id, sealed, key_id, created_at, updated_at)
            VALUES (?, 'apple', ?, 'v1.deadbeef.AAAA.AAAA.AAAA', 'deadbeef', ?, ?)`,
      args: [user.id, APP_ID, now, now],
    });
    expect((await deleteAccount(token)).status).toBe(200);
    expect(appleCalls).toHaveLength(0);
    expect(await storedTokens(user.id)).toHaveLength(0);
    const entry = removalEntries().find((e) => e.kind === "account" && e.id === user.id);
    expect(entry).toMatchObject({ signInTokens: { apple: "failed" } });
  });

  it("an account without stored tokens is deleted without calling Apple", async () => {
    const { token, user } = await createDevSession("del3@verdict.local");
    const res = await deleteAccount(token);
    expect(res.status).toBe(200);
    expect(appleCalls).toHaveLength(0);
    const entry = removalEntries().find((e) => e.kind === "account" && e.id === user.id);
    expect(entry).toMatchObject({ signInTokens: { apple: "none" } });
  });
});
