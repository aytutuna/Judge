/**
 * Sign in with Apple refresh tokens, kept for one purpose: revoking them when
 * the account is deleted (App Store guideline 5.1.1(v)). Server only.
 *
 * Where they come from:
 * - website (Services ID, APPLE_CLIENT_ID): Better Auth exchanges the
 *   callback code itself; the account hooks in lib/auth.ts hand the refresh
 *   token over here (captureAppleRefreshToken / keepCapturedAppleRefreshToken)
 *   before it is stripped from the account row. Only tokens from that
 *   callback are taken: anything a client sends in a request body is not;
 * - the iOS app (APPLE_APP_BUNDLE_ID): the app posts Apple's authorization
 *   code to POST /api/v1/auth/apple/code right after signing in, and
 *   keepNativeAppleToken exchanges it here.
 *
 * Each token is sealed with the originals key (AES-256-GCM, bound to user,
 * provider and client id) and stored per (user, provider, client id), so it
 * is revoked with the client id it was issued to. Without a usable originals
 * key nothing is stored (logged). Tokens never appear in logs or errors.
 *
 * Google sign-in uses ID tokens (and the redirect flow's tokens are
 * stripped), so there is no Google token to keep or revoke.
 */

import type { Client } from "@libsql/client";
import { appleClientSecret, appleEnv } from "./apple-secret";
import { getDb } from "./db";
import { entitlementWriteBatch } from "./entitlements";
import { aad, openJson, originalsKeyState, sealJson } from "./originals/crypto";

type Env = Record<string, string | undefined>;

export type SignInTokenProvider = "apple";

/** What happened to the account's Apple tokens on deletion. "none": no token
 * was stored; "partial": some were revoked and some were not. */
export type RevocationOutcome = "revoked" | "partial" | "failed" | "none";
export type SignInRevocation = { apple: RevocationOutcome };

const APPLE_ISSUER = "https://appleid.apple.com";
export const APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token";
export const APPLE_REVOKE_URL = "https://appleid.apple.com/auth/revoke";
const APPLE_TIMEOUT_MS = 8_000;
/** Apple authorization codes are short opaque strings. */
const APPLE_CODE = /^[A-Za-z0-9._-]{1,1024}$/;

const SCHEMA = `CREATE TABLE IF NOT EXISTS signin_tokens (
  user_id     TEXT NOT NULL,
  provider    TEXT NOT NULL,
  client_id   TEXT NOT NULL,
  sealed      TEXT NOT NULL,
  key_id      TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, provider, client_id)
)`;

const globalForTokens = globalThis as unknown as {
  __verdictSignInTokensReady?: { client: Client; ready: Promise<void> };
};

/** Creates the token table once per process (per database client). */
export async function ensureSignInTokenTables(): Promise<Client> {
  const client = await getDb();
  const cached = globalForTokens.__verdictSignInTokensReady;
  if (cached?.client !== client) {
    const ready = client.execute(SCHEMA).then(
      () => undefined,
      (e: unknown) => {
        globalForTokens.__verdictSignInTokensReady = undefined;
        throw e;
      },
    );
    globalForTokens.__verdictSignInTokensReady = { client, ready };
  }
  await globalForTokens.__verdictSignInTokensReady!.ready;
  return client;
}

/** True when a token could be sealed right now (a usable originals key). */
export function canStoreSignInTokens(env: Env = process.env): boolean {
  return originalsKeyState(env).ok;
}

export function isAppleAuthorizationCode(value: unknown): value is string {
  return typeof value === "string" && APPLE_CODE.test(value);
}

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Seals and stores (or replaces) one refresh token. False when there is no
 * usable originals key, so nothing could be stored. */
export async function storeSignInToken(
  t: { userId: string; provider: SignInTokenProvider; clientId: string; refreshToken: string },
  env: Env = process.env,
): Promise<boolean> {
  const sealed = sealJson(t.refreshToken, aad.signInToken(t.provider, t.clientId, t.userId), env);
  if (!sealed) {
    console.error(`[signin-tokens] no originals key: the ${t.provider} token was not stored`);
    return false;
  }
  await ensureSignInTokenTables();
  const now = new Date().toISOString();
  await entitlementWriteBatch([
    {
      sql: `INSERT INTO signin_tokens (user_id, provider, client_id, sealed, key_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (user_id, provider, client_id)
            DO UPDATE SET sealed = excluded.sealed, key_id = excluded.key_id, updated_at = excluded.updated_at`,
      args: [t.userId, t.provider, t.clientId, sealed.sealed, sealed.kid, now, now],
    },
  ]);
  return true;
}

/** Removes every stored token of the user. */
export async function deleteSignInTokens(userId: string): Promise<void> {
  await ensureSignInTokenTables();
  await entitlementWriteBatch([{ sql: "DELETE FROM signin_tokens WHERE user_id = ?", args: [userId] }]);
}

/** The client secret JWT for one Apple client id (Services ID or bundle id),
 * or null when Apple is unconfigured or the key is unusable. */
function appleSecretFor(clientId: string, env: Env): string | null {
  const cfg = appleEnv(env);
  if (!cfg) return null;
  try {
    return appleClientSecret({ ...cfg, clientId }).jwt;
  } catch (e) {
    console.error("[signin-tokens] Apple client secret unavailable:", errorMessage(e));
    return null;
  }
}

/** Apple's `error` field, only when it looks like an OAuth error code. */
async function appleErrorCode(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    return typeof body.error === "string" && /^[a-z_]{1,40}$/.test(body.error) ? body.error : "unknown";
  } catch {
    return "unknown";
  }
}

function postForm(url: string, params: Record<string, string>): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(APPLE_TIMEOUT_MS),
  });
}

/** The claims of an ID token Apple just returned over TLS (not re-verified:
 * it comes straight from the token endpoint), or null. */
function idTokenClaims(idToken: unknown): { sub?: unknown; aud?: unknown; iss?: unknown } | null {
  if (typeof idToken !== "string") return null;
  const payload = idToken.split(".")[1];
  if (!payload) return null;
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof claims === "object" && claims !== null ? (claims as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export type AppleExchange =
  | { ok: true; refreshToken: string; sub: string | null }
  | { ok: false; reason: "not_configured" | "invalid_code" | "unavailable" };

/** Exchanges an authorization code at Apple's token endpoint for the given
 * client id. Native codes carry no redirect_uri. */
export async function exchangeAppleCode(code: string, clientId: string, env: Env = process.env): Promise<AppleExchange> {
  const secret = appleSecretFor(clientId, env);
  if (!secret) return { ok: false, reason: "not_configured" };
  let res: Response;
  try {
    res = await postForm(APPLE_TOKEN_URL, {
      client_id: clientId,
      client_secret: secret,
      code,
      grant_type: "authorization_code",
    });
  } catch (e) {
    console.error("[signin-tokens] Apple code exchange failed:", errorMessage(e));
    return { ok: false, reason: "unavailable" };
  }
  if (!res.ok) {
    const error = await appleErrorCode(res);
    console.warn(`[signin-tokens] Apple refused the code: status=${res.status} error=${error}`);
    return { ok: false, reason: res.status === 400 && error !== "invalid_client" ? "invalid_code" : "unavailable" };
  }
  let body: { refresh_token?: unknown; id_token?: unknown };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    console.error("[signin-tokens] Apple code exchange: unreadable response");
    return { ok: false, reason: "unavailable" };
  }
  if (typeof body.refresh_token !== "string" || !body.refresh_token) {
    console.error("[signin-tokens] Apple code exchange: no refresh token in the response");
    return { ok: false, reason: "unavailable" };
  }
  const claims = idTokenClaims(body.id_token);
  const sub =
    claims && claims.iss === APPLE_ISSUER && claims.aud === clientId && typeof claims.sub === "string" ? claims.sub : null;
  return { ok: true, refreshToken: body.refresh_token, sub };
}

/** Revokes one refresh token. True when Apple accepted the revocation. */
async function revokeAppleToken(token: string, clientId: string, env: Env): Promise<boolean> {
  const secret = appleSecretFor(clientId, env);
  if (!secret) return false;
  try {
    const res = await postForm(APPLE_REVOKE_URL, {
      client_id: clientId,
      client_secret: secret,
      token,
      token_type_hint: "refresh_token",
    });
    if (res.ok) return true;
    console.warn(`[signin-tokens] Apple refused a revocation: status=${res.status} error=${await appleErrorCode(res)}`);
    return false;
  } catch (e) {
    console.error("[signin-tokens] Apple revocation failed:", errorMessage(e));
    return false;
  }
}

export type NativeAppleResult =
  | { ok: true }
  | { ok: false; reason: "not_configured" | "no_apple_account" | "invalid_code" | "mismatch" | "no_key" | "unavailable" };

/**
 * The app's half: exchanges the authorization code from a native Sign in
 * with Apple (client id APPLE_APP_BUNDLE_ID) and keeps the refresh token for
 * this user. The code must belong to an Apple ID already linked to the user.
 */
export async function keepNativeAppleToken(userId: string, code: string, env: Env = process.env): Promise<NativeAppleResult> {
  const bundleId = env.APPLE_APP_BUNDLE_ID?.trim();
  if (!bundleId || !appleEnv(env)) return { ok: false, reason: "not_configured" };
  const db = await getDb();
  const linked = await db.execute({
    sql: "SELECT accountId FROM account WHERE userId = ? AND providerId = 'apple'",
    args: [userId],
  });
  const appleIds = new Set(linked.rows.map((r) => String(r.accountId)));
  if (appleIds.size === 0) return { ok: false, reason: "no_apple_account" };
  // Checked before the exchange: a code spent on a token that cannot be kept
  // is lost (codes are single-use).
  if (!canStoreSignInTokens(env)) {
    console.error("[signin-tokens] no originals key: Apple codes are not exchanged");
    return { ok: false, reason: "no_key" };
  }

  const exchange = await exchangeAppleCode(code, bundleId, env);
  if (!exchange.ok) return exchange;
  if (!exchange.sub || !appleIds.has(exchange.sub)) {
    console.warn("[signin-tokens] Apple code belongs to another Apple ID: revoking it, not stored");
    await revokeAppleToken(exchange.refreshToken, bundleId, env);
    return { ok: false, reason: "mismatch" };
  }
  const stored = await storeSignInToken({ userId, provider: "apple", clientId: bundleId, refreshToken: exchange.refreshToken }, env);
  return stored ? { ok: true } : { ok: false, reason: "no_key" };
}

/**
 * Account deletion: revokes every stored Apple token with the client id it
 * was issued to and deletes the ones Apple accepted. A token Apple did not
 * revoke stays until deleteAuthUser removes every row, so a retried deletion
 * (after a later step failed) tries it again; Apple's revocation is
 * idempotent. Never throws: an Apple or database failure is logged (without
 * the token) and reported in the outcome, and the deletion goes on.
 */
export async function revokeSignInTokens(userId: string, env: Env = process.env): Promise<SignInRevocation> {
  let rows: { provider: string; clientId: string; sealed: string }[];
  try {
    const db = await ensureSignInTokenTables();
    const res = await db.execute({
      sql: "SELECT provider, client_id, sealed FROM signin_tokens WHERE user_id = ?",
      args: [userId],
    });
    rows = res.rows.map((r) => ({ provider: String(r.provider), clientId: String(r.client_id), sealed: String(r.sealed) }));
  } catch (e) {
    console.error("[signin-tokens] reading the stored tokens failed:", errorMessage(e));
    return { apple: "failed" };
  }
  const apple = rows.filter((row) => row.provider === "apple");
  const results = await Promise.all(
    apple.map(async (row) => {
      let token: string | null = null;
      try {
        const opened = openJson<unknown>(row.sealed, aad.signInToken("apple", row.clientId, userId), env);
        token = typeof opened === "string" ? opened : null;
      } catch (e) {
        console.error("[signin-tokens] a stored Apple token could not be opened:", errorMessage(e));
      }
      return token !== null && (await revokeAppleToken(token, row.clientId, env));
    }),
  );
  const done = apple.filter((_, i) => results[i]);
  if (done.length > 0) {
    try {
      await entitlementWriteBatch(
        done.map((row) => ({
          sql: "DELETE FROM signin_tokens WHERE user_id = ? AND provider = ? AND client_id = ? AND sealed = ?",
          args: [userId, row.provider, row.clientId, row.sealed],
        })),
      );
    } catch (e) {
      // deleteAuthUser deletes them again; a failure there fails the deletion.
      console.error("[signin-tokens] deleting the revoked tokens failed:", errorMessage(e));
    }
  }
  const revoked = done.length;
  const failed = apple.length - revoked;
  const outcome: RevocationOutcome =
    revoked + failed === 0 ? "none" : failed === 0 ? "revoked" : revoked === 0 ? "failed" : "partial";
  return { apple: outcome };
}

// --- Website sign-in (Better Auth account hooks) -----------------------------

type AccountLike = { providerId?: unknown; refreshToken?: unknown; userId?: unknown } | null | undefined;
type EndpointContextLike = { path?: unknown } | null;

/** Better Auth's OAuth callback, where it exchanges Apple's code itself. Any
 * other endpoint (e.g. link-social with a client-supplied idToken) carries
 * tokens from the request body, which are never kept. */
const OAUTH_CALLBACK_PATH = "/callback/:id";

/** Refresh tokens seen by an account `before` hook, keyed by the endpoint
 * context, until the matching `after` hook knows the user. */
const captured = new WeakMap<object, string>();

/** account create/update `before` hook: notes an Apple refresh token from
 * Better Auth's own code exchange (the OAuth callback) before it is stripped. */
export function captureAppleRefreshToken(account: AccountLike, context: EndpointContextLike): void {
  if (!context || context.path !== OAUTH_CALLBACK_PATH) return;
  if (!account || account.providerId !== "apple") return;
  if (typeof account.refreshToken === "string" && account.refreshToken) captured.set(context, account.refreshToken);
}

/** account create/update `after` hook: stores the noted token for the
 * account's user, issued to the website client id. Never throws, so a
 * storage failure cannot break the sign-in. */
export async function keepCapturedAppleRefreshToken(
  account: AccountLike,
  context: EndpointContextLike,
  webClientId: string,
): Promise<void> {
  if (!context) return;
  const token = captured.get(context);
  if (!token) return;
  captured.delete(context);
  if (!account || account.providerId !== "apple" || typeof account.userId !== "string") return;
  try {
    await storeSignInToken({ userId: account.userId, provider: "apple", clientId: webClientId, refreshToken: token });
  } catch (e) {
    console.error("[signin-tokens] storing the Apple token failed:", errorMessage(e));
  }
}
