/**
 * Accounts and sessions (server only), on Better Auth with the main libSQL
 * database. One session works two ways:
 * - browsers: the HttpOnly cookie `verdict.session_token` (`__Secure-` on https);
 * - the native app: the same session token as `Authorization: Bearer <token>`.
 *
 * Sign-in methods: Apple and Google (web redirect and native ID token), email
 * magic link (website) or one-time email code (apps), both through Resend,
 * and a dev-only test login. A method without credentials is simply not
 * offered (authProviders). Without BETTER_AUTH_SECRET in production, auth is
 * off and the free site runs as before.
 */

import { createHash, createHmac } from "node:crypto";
import { LibsqlDialect } from "@libsql/kysely-libsql";
import { betterAuth, type Auth, type BetterAuthOptions, type BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { makeSignature } from "better-auth/crypto";
import { getMigrations } from "better-auth/db/migration";
import { bearer, captcha, emailOTP, magicLink } from "better-auth/plugins";
import type { AuthProviders, Viewer } from "./account-types";
import { APPLE_SECRET_REFRESH_MS, appleClientSecret, appleEnv } from "./apple-secret";
import { getDb } from "./db";
import {
  emailConfigured,
  langFromMagicLink,
  langFromRequestUrl,
  sendSignInCodeEmail,
  sendSignInEmail,
} from "./email";
import { ensureEntitlementTables } from "./entitlements";
import { captureAppleRefreshToken, deleteSignInTokens, keepCapturedAppleRefreshToken } from "./signin-tokens";

type Env = Record<string, string | undefined>;
type AuthInstance = Auth<BetterAuthOptions>;

export type ViewerSession = { user: Viewer; sessionId: string; via: "cookie" | "bearer" };

const SESSION_DAYS = 30;
/** Email sign-in links and codes live this long. */
const EMAIL_SIGNIN_SECONDS = 600;
/** Wrong guesses allowed per emailed code before it is burned. */
const EMAIL_CODE_ATTEMPTS = 3;
/** Sign-in requests per IP and endpoint per minute (production only). */
const EMAIL_SIGNIN_RATE = { window: 60, max: 3 };
const SEND_CODE_PATH = "/email-otp/send-verification-otp";
const MIN_SECRET_LENGTH = 32;
/** Used only outside production (never in a production build) when
 * BETTER_AUTH_SECRET is unset or too short. */
const DEV_SECRET = "verdict-local-development-secret-do-not-use-in-production";
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i;
const LOOPBACK_LISTEN = new Set(["127.0.0.1", "[::1]"]);

/**
 * `next build` and `next dev` replace this literal at build time ("production"
 * and "development"), so a production build stays production whatever
 * NODE_ENV the process is later started with (`next start` keeps an existing
 * NODE_ENV). Outside Next (tests, scripts) it is the runtime value.
 */
const BUILT_FOR_PRODUCTION = process.env.NODE_ENV === "production";

const isProduction = (env: Env) => BUILT_FOR_PRODUCTION || env.NODE_ENV === "production";

function authSecret(env: Env): string | null {
  const secret = env.BETTER_AUTH_SECRET?.trim();
  if (secret && secret.length >= MIN_SECRET_LENGTH) return secret;
  if (isProduction(env)) return null;
  return DEV_SECRET;
}

export type SecretPurpose = "evidence-token" | "case-invite" | "case-names" | "respondent-claim";

/** A 32-byte key for one purpose, derived from the auth secret, or null when
 * accounts are not configured. Rotating BETTER_AUTH_SECRET rotates every key. */
export function derivedSecret(purpose: SecretPurpose, env: Env = process.env): Buffer | null {
  const secret = authSecret(env);
  return secret ? createHmac("sha256", secret).update(`settle:${purpose}:v1`).digest() : null;
}

/** True when accounts can work: a real secret, or any non-production run. */
export function authConfigured(env: Env = process.env): boolean {
  return authSecret(env) !== null;
}

/** Premium is offered when not switched off, auth works and a model key is set. */
export function premiumEnabled(env: Env = process.env): boolean {
  return env.PREMIUM_ENABLED?.trim() !== "0" && authConfigured(env) && Boolean(env.ANTHROPIC_API_KEY);
}

/**
 * The store-review account: one address whose emailed sign-in code is always
 * REVIEW_ACCOUNT_CODE, and to which no email is sent (App Review has no inbox
 * of ours). Needs REVIEW_ACCOUNT_EMAIL, a 6-digit code that is not a trivial
 * run of digits, and email sign-in configured (the code plugin is only loaded
 * then). It is an ordinary account otherwise: same limits, nothing granted.
 */
export function reviewAccount(env: Env = process.env): { email: string; code: string } | null {
  const email = env.REVIEW_ACCOUNT_EMAIL?.trim().toLowerCase() ?? "";
  const code = env.REVIEW_ACCOUNT_CODE?.trim() ?? "";
  if (!email || !code) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  if (!/^\d{6}$/.test(code)) return null;
  if (/^(\d)\1{5}$/.test(code) || code === "123456" || code === "654321") return null;
  return { email, code };
}

/** Code requests for the review address per hour, process-wide. Each request
 * resets the per-code guess count, so without this a guess-and-resend search
 * of the fixed code would be bounded only by the per-IP rate limit; with it,
 * REVIEW_SENDS_PER_HOUR * EMAIL_CODE_ATTEMPTS guesses an hour. Past the cap
 * the address gets a random code that is never sent: locked until the window
 * moves on. */
const REVIEW_SENDS_PER_HOUR = 10;
const reviewSends: number[] = [];
function reviewSendAllowed(now = Date.now()): boolean {
  while (reviewSends.length && now - reviewSends[0] > 3_600_000) reviewSends.shift();
  if (reviewSends.length >= REVIEW_SENDS_PER_HOUR) return false;
  reviewSends.push(now);
  return true;
}

function originOf(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  try {
    const url = new URL(raw.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

/** The public origin: BETTER_AUTH_URL, else NEXT_PUBLIC_SITE_URL. */
function configuredOrigin(env: Env): string | null {
  return originOf(env.BETTER_AUTH_URL) ?? originOf(env.NEXT_PUBLIC_SITE_URL);
}

function googleClientIds(env: Env): string[] | null {
  const web = env.GOOGLE_CLIENT_ID?.trim();
  if (!web || !env.GOOGLE_CLIENT_SECRET?.trim()) return null;
  // The web client first: it is the one used for the redirect flow.
  return [web, env.GOOGLE_IOS_CLIENT_ID?.trim(), env.GOOGLE_ANDROID_CLIENT_ID?.trim()].filter(
    (id): id is string => Boolean(id),
  );
}

/** The Apple client secret, or null when Apple is unconfigured or its key is
 * unusable (logged without the key). */
function appleSecret(env: Env): { jwt: string; issuedAtMs: number } | null {
  const cfg = appleEnv(env);
  if (!cfg) return null;
  try {
    return appleClientSecret(cfg);
  } catch (e) {
    console.error("[auth] Apple sign-in disabled:", e instanceof Error ? e.message : "bad key");
    return null;
  }
}

const appleUsable = new Map<string, boolean>();

function appleConfigured(env: Env): boolean {
  const cfg = appleEnv(env);
  if (!cfg) return false;
  const key = createHash("sha256").update(JSON.stringify(cfg)).digest("hex");
  let ok = appleUsable.get(key);
  if (ok === undefined) {
    ok = appleSecret(env) !== null;
    appleUsable.set(key, ok);
  }
  return ok;
}

/** Strips anything but Error messages from library log arguments, so no user
 * object (email address) reaches the logs. */
function authLog(level: "debug" | "info" | "warn" | "error", message: string, ...args: unknown[]): void {
  const details = args.filter((a): a is Error => a instanceof Error).map((e) => e.message);
  const line = `[auth] ${message}${details.length ? `: ${details.join("; ")}` : ""}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
}

const withoutProviderTokens = <T extends Record<string, unknown>>(account: T) => ({
  ...account,
  accessToken: null,
  refreshToken: null,
  idToken: null,
});

function buildOptions(env: Env, secret: string, client: Awaited<ReturnType<typeof getDb>>) {
  const origin = configuredOrigin(env);
  const production = isProduction(env);
  const apple = appleSecret(env);
  const appleCfg = appleEnv(env);
  const googleIds = googleClientIds(env);
  const bundleId = env.APPLE_APP_BUNDLE_ID?.trim();

  const plugins: BetterAuthPlugin[] = [bearer()];
  if (emailConfigured(env)) {
    plugins.push(
      magicLink({
        expiresIn: EMAIL_SIGNIN_SECONDS,
        storeToken: "hashed",
        sendMagicLink: async ({ email, url }) => {
          await sendSignInEmail({ to: email, url, lang: langFromMagicLink(url) });
        },
      }),
      // The apps: POST /email-otp/send-verification-otp?lang=tr
      // {email, type:"sign-in"}, then POST /sign-in/email-otp {email, otp}.
      emailOTP({
        expiresIn: EMAIL_SIGNIN_SECONDS,
        otpLength: 6,
        allowedAttempts: EMAIL_CODE_ATTEMPTS,
        storeOTP: "hashed",
        rateLimit: EMAIL_SIGNIN_RATE,
        // The review account gets its fixed code (see reviewAccount); anyone
        // else a random one.
        generateOTP: ({ email, type }) => {
          const review = reviewAccount(env);
          if (type !== "sign-in" || !review || email.toLowerCase() !== review.email) return undefined;
          return reviewSendAllowed() ? review.code : undefined;
        },
        sendVerificationOTP: async ({ email, otp, type }, ctx) => {
          if (type !== "sign-in") return; // refused earlier by hooks.before
          if (reviewAccount(env)?.email === email.trim().toLowerCase()) return; // the reviewer knows the code
          await sendSignInCodeEmail({ to: email, code: otp, lang: langFromRequestUrl(ctx?.request?.url) });
        },
      }),
    );
    if (env.TURNSTILE_SECRET_KEY?.trim()) {
      plugins.push(
        captcha({
          provider: "cloudflare-turnstile",
          secretKey: env.TURNSTILE_SECRET_KEY.trim(),
          // Magic link only: the apps cannot show the widget, so the code
          // endpoints rely on the rate limits and the per-code attempt cap.
          endpoints: ["/sign-in/magic-link"],
        }),
      );
    }
  }

  const options: BetterAuthOptions = {
    appName: "Judge",
    basePath: "/api/auth",
    secret,
    // Outside production without a configured origin, follow the local host
    // (any port), so `next dev -p 36xx` works without extra setup.
    baseURL:
      origin ??
      (production
        ? undefined
        : {
            allowedHosts: ["localhost", "localhost:*", "127.0.0.1", "127.0.0.1:*", "[::1]", "[::1]:*"],
            protocol: "http",
            fallback: "http://localhost:3000",
          }),
    trustedOrigins: production
      ? origin
        ? [origin]
        : []
      : [...(origin ? [origin] : []), "http://localhost:*", "http://127.0.0.1:*", "http://[::1]:*"],
    database: { dialect: new LibsqlDialect({ client }), type: "sqlite" },
    session: { expiresIn: SESSION_DAYS * 24 * 60 * 60, updateAge: 24 * 60 * 60 },
    user: { deleteUser: { enabled: false } },
    account: {
      // On: a returning website Apple sign-in passes its fresh refresh token
      // through the account update hooks below (the tokens are still stripped
      // before the row is written).
      updateAccountOnSignIn: true,
      accountLinking: { enabled: true, trustedProviders: ["apple", "google"] },
    },
    socialProviders: {
      ...(googleIds && {
        google: { clientId: googleIds, clientSecret: env.GOOGLE_CLIENT_SECRET!.trim() },
      }),
      ...(apple &&
        appleCfg && {
          apple: {
            clientId: appleCfg.clientId,
            clientSecret: apple.jwt,
            ...(bundleId && { appBundleIdentifier: bundleId }),
            audience: bundleId ? [appleCfg.clientId, bundleId] : appleCfg.clientId,
          },
        }),
    },
    plugins,
    // Built-in endpoints we never use (no passwords; profile and email are
    // set by the sign-in provider). Fewer open endpoints, less to defend.
    disabledPaths: [
      "/sign-up/email",
      "/sign-in/email",
      "/request-password-reset",
      "/reset-password",
      "/change-password",
      "/send-verification-email",
      "/verify-email",
      "/update-user",
      "/change-email",
      "/get-access-token",
      "/refresh-token",
      "/account-info",
      // Linking happens through the sign-in itself (trusted providers); this
      // endpoint would also take provider tokens from the request body.
      "/link-social",
      // Email code plugin: only send-verification-otp and sign-in/email-otp
      // are used.
      "/email-otp/check-verification-otp",
      "/email-otp/verify-email",
      "/email-otp/request-password-reset",
      "/forget-password/email-otp",
      "/email-otp/reset-password",
      "/email-otp/request-email-change",
      "/email-otp/change-email",
    ],
    rateLimit: {
      enabled: production,
      storage: "memory",
      customRules: {
        "/sign-in/magic-link": EMAIL_SIGNIN_RATE,
        [SEND_CODE_PATH]: EMAIL_SIGNIN_RATE,
        "/sign-in/email-otp": EMAIL_SIGNIN_RATE,
        "/sign-in/social": { window: 60, max: 10 },
      },
    },
    hooks: {
      // Codes are for signing in only (no email verification, password or
      // email-change codes).
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === SEND_CODE_PATH && (ctx.body as { type?: unknown } | undefined)?.type !== "sign-in") {
          throw new APIError("BAD_REQUEST", { message: "Only sign-in codes are supported" });
        }
      }),
    },
    advanced: {
      cookiePrefix: "verdict",
      // Caddy (and Vercel) overwrite this header with the real peer address.
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
    },
    databaseHooks: {
      // Privacy: no IP address or device string is stored with a session.
      session: {
        create: {
          before: async (session) => ({ data: { ...session, ipAddress: null, userAgent: null } }),
        },
      },
      // Provider access/refresh/ID tokens are never written to the account
      // row. A website Apple refresh token is kept apart, sealed, only to be
      // revoked when the account is deleted (lib/signin-tokens.ts).
      account: {
        create: {
          before: async (account, context) => {
            captureAppleRefreshToken(account, context);
            return { data: withoutProviderTokens(account) };
          },
          after: async (account, context) => {
            if (appleCfg) await keepCapturedAppleRefreshToken(account, context, appleCfg.clientId);
          },
        },
        update: {
          before: async (account, context) => {
            captureAppleRefreshToken(account, context);
            return { data: withoutProviderTokens(account) };
          },
          after: async (account, context) => {
            if (appleCfg) await keepCapturedAppleRefreshToken(account, context, appleCfg.clientId);
          },
        },
      },
    },
    logger: { level: "warn", log: authLog },
    telemetry: { enabled: false },
  };
  return { options, appleIssuedAtMs: apple?.issuedAtMs ?? null };
}

type Built = {
  key: string;
  auth: AuthInstance;
  appleIssuedAtMs: number | null;
};

const globalForAuth = globalThis as unknown as {
  __verdictAuth?: { key: string; built: Promise<Built> };
  __verdictAuthDevWarned?: boolean;
};

const CONFIG_KEYS = [
  "NODE_ENV",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "NEXT_PUBLIC_SITE_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_IOS_CLIENT_ID",
  "GOOGLE_ANDROID_CLIENT_ID",
  "APPLE_CLIENT_ID",
  "APPLE_TEAM_ID",
  "APPLE_KEY_ID",
  "APPLE_PRIVATE_KEY_BASE64",
  "APPLE_APP_BUNDLE_ID",
  "RESEND_API_KEY",
  "REVIEW_ACCOUNT_EMAIL",
  "REVIEW_ACCOUNT_CODE",
  "EMAIL_FROM",
  "TURNSTILE_SECRET_KEY",
];

/** A hash of the settings the instance is built from: a changed setting
 * (tests, dev reloads) rebuilds it. */
function configKey(env: Env): string {
  const values = CONFIG_KEYS.map((k) => env[k] ?? "");
  return createHash("sha256").update(JSON.stringify(values)).digest("hex");
}

async function build(env: Env, key: string): Promise<Built> {
  const secret = authSecret(env);
  if (!secret) throw new Error("auth is not configured (BETTER_AUTH_SECRET missing)");
  if (secret === DEV_SECRET && !globalForAuth.__verdictAuthDevWarned) {
    globalForAuth.__verdictAuthDevWarned = true;
    console.warn("[auth] BETTER_AUTH_SECRET is not set: using the local development secret.");
  }
  const client = await getDb();
  const { options, appleIssuedAtMs } = buildOptions(env, secret, client);
  // Tables first, so the instance never starts against a missing schema.
  const { runMigrations } = await getMigrations(options);
  await runMigrations();
  await ensureEntitlementTables();
  return { key, auth: betterAuth(options), appleIssuedAtMs };
}

/** The instance for the current settings, built (and migrated) once per
 * process; rebuilt when a setting changes or the Apple secret ages out. */
async function current(env: Env = process.env): Promise<Built> {
  const key = configKey(env);
  const cached = globalForAuth.__verdictAuth;
  if (cached?.key === key) {
    const built = await cached.built;
    const stale = built.appleIssuedAtMs !== null && Date.now() - built.appleIssuedAtMs > APPLE_SECRET_REFRESH_MS;
    if (!stale) return built;
  }
  const entry: { key: string; built: Promise<Built> } = { key, built: build(env, key) };
  globalForAuth.__verdictAuth = entry;
  entry.built.catch(() => {
    // Let the next call retry instead of caching the failure.
    if (globalForAuth.__verdictAuth === entry) globalForAuth.__verdictAuth = undefined;
  });
  return entry.built;
}

/** Better Auth migrations (user, session, account, verification) and the
 * entitlement tables, once per process. */
export async function authReady(): Promise<void> {
  await current();
}

/** The ready Better Auth instance. Throws when auth is not configured. */
export async function getAuth(): Promise<AuthInstance> {
  return (await current()).auth;
}

function bearerToken(headers: Headers): string | null {
  const header = headers.get("authorization");
  if (!header || header.slice(0, 7).toLowerCase() !== "bearer ") return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  let decoded = token;
  try {
    decoded = decodeURIComponent(token);
  } catch {
    // keep as is
  }
  // A signed token is "<token>.<signature>"; the session token is the first part.
  return decoded.split(".")[0] || null;
}

export function toViewer(user: { id: string; email: string; name?: string | null; image?: string | null }): Viewer {
  return { id: user.id, email: user.email, name: user.name ?? "", image: user.image ?? null };
}

export type ViewerLookup = {
  viewer: ViewerSession | null;
  /** The request carried `Authorization: Bearer <token>` and the token
   * matches no live session (unknown, expired or signed out). */
  deadBearer: boolean;
};

/**
 * The signed-in account behind this request, and whether a bearer token was
 * sent that no longer works. A request with a bearer token is judged by that
 * token alone (a cookie next to it is ignored); without one, by the session
 * cookie. Never throws: a lookup failure is logged and treated as signed out
 * with deadBearer false (the token itself may be fine). With auth off there
 * are no sessions, so nothing counts as a dead token either.
 */
export async function resolveViewer(req: Request): Promise<ViewerLookup> {
  if (!authConfigured()) return { viewer: null, deadBearer: false };
  const bearer = bearerToken(req.headers);
  try {
    const auth = await getAuth();
    const res = await auth.api.getSession({ headers: req.headers });
    if (bearer !== null && res?.session.token !== bearer) return { viewer: null, deadBearer: true };
    if (!res) return { viewer: null, deadBearer: false };
    return {
      viewer: { user: toViewer(res.user), sessionId: res.session.id, via: bearer !== null ? "bearer" : "cookie" },
      deadBearer: false,
    };
  } catch (e) {
    console.error("[auth] session lookup failed:", e instanceof Error ? e.message : String(e));
    return { viewer: null, deadBearer: false };
  }
}

/** The signed-in account behind this request (cookie or bearer), or null.
 * A dead bearer token gives null too; see resolveViewer to tell them apart. */
export async function getViewer(req: Request): Promise<ViewerSession | null> {
  return (await resolveViewer(req)).viewer;
}

/** True when the request has an `Authorization: Bearer` token that matches
 * no live session. No session lookup without such a header. */
export async function hasDeadBearer(req: Request): Promise<boolean> {
  if (bearerToken(req.headers) === null) return false;
  return (await resolveViewer(req)).deadBearer;
}

/** CSRF check for cookie-authenticated writes: the Origin (else Referer)
 * must be the configured public origin or this request's own host. */
export function isSameOrigin(req: Request): boolean {
  let origin = req.headers.get("origin");
  if (!origin || origin === "null") {
    const referer = req.headers.get("referer");
    if (!referer) return false;
    origin = referer;
  }
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.origin === configuredOrigin(process.env)) return true;
  const host = req.headers.get("host");
  return Boolean(host) && url.host.toLowerCase() === host!.trim().toLowerCase();
}

/** True when the Next server listens on a loopback address only. Next records
 * the address it was started with (`-H`) in __NEXT_PRIVATE_ORIGIN; without
 * `-H` it listens on every interface and records "localhost", which is
 * therefore not accepted. Unknown or missing = not loopback (fails closed). */
function listensOnLoopbackOnly(env: Env): boolean {
  const raw = env.__NEXT_PRIVATE_ORIGIN?.trim();
  if (!raw) return false;
  try {
    return LOOPBACK_LISTEN.has(new URL(raw).hostname);
  } catch {
    return false;
  }
}

/**
 * The dev-only test login is allowed only when ALL hold:
 * 1. not a production build or run (see isProduction);
 * 2. DEV_LOGIN is exactly "1";
 * 3. the server listens on 127.0.0.1 or ::1 only (`next dev -H 127.0.0.1`,
 *    as `npm run dev:login` does), so nobody else on the network can reach it;
 * 4. the Host header is localhost, 127.0.0.1 or [::1] (any port).
 * X-Forwarded-Host is deliberately ignored.
 */
export function devLoginAllowed(req: Request, env: Env = process.env): boolean {
  if (isProduction(env)) return false;
  if (env.DEV_LOGIN !== "1") return false;
  if (!listensOnLoopbackOnly(env)) return false;
  const host = req.headers.get("host")?.trim() ?? "";
  return LOCAL_HOST.test(host);
}

/** Which sign-in methods this deployment offers right now. */
export function authProviders(req: Request, env: Env = process.env): AuthProviders {
  if (!authConfigured(env)) return { apple: false, google: false, email: false, emailCode: false, dev: false };
  return {
    apple: appleConfigured(env),
    google: googleClientIds(env) !== null,
    email: emailConfigured(env),
    emailCode: emailConfigured(env),
    dev: devLoginAllowed(req, env),
  };
}

function serializeCookie(
  name: string,
  value: string,
  a: { maxAge?: number; path?: string; domain?: string; secure?: boolean; httpOnly?: boolean; sameSite?: string },
): string {
  const parts = [`${name}=${value}`, `Path=${a.path ?? "/"}`];
  if (a.maxAge !== undefined) parts.push(`Max-Age=${a.maxAge}`);
  if (a.maxAge === 0) parts.push("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  if (a.domain) parts.push(`Domain=${a.domain}`);
  if (a.httpOnly !== false) parts.push("HttpOnly");
  if (a.secure) parts.push("Secure");
  const sameSite = a.sameSite ?? "lax";
  parts.push(`SameSite=${sameSite.charAt(0).toUpperCase()}${sameSite.slice(1).toLowerCase()}`);
  return parts.join("; ");
}

/** A Set-Cookie value carrying this session token, signed exactly as Better
 * Auth signs its own session cookie (same name and attributes). */
export async function sessionCookieHeader(token: string): Promise<string> {
  const ctx = await (await getAuth()).$context;
  const { name, attributes } = ctx.authCookies.sessionToken;
  const value = encodeURIComponent(`${token}.${await makeSignature(token, ctx.secret)}`);
  return serializeCookie(name, value, { ...attributes, maxAge: ctx.sessionConfig.expiresIn });
}

/** Set-Cookie values that clear every Better Auth session cookie. */
export async function clearSessionCookieHeaders(): Promise<string[]> {
  const ctx = await (await getAuth()).$context;
  const c = ctx.authCookies;
  return [c.sessionToken, c.sessionData, c.dontRememberToken].map(({ name, attributes }) =>
    serializeCookie(name, "", { ...attributes, maxAge: 0 }),
  );
}

/** Removes the user's sessions, sign-in accounts, any stored sign-in
 * provider tokens and the user row (the caller revokes the tokens and
 * deletes the entitlements first). */
export async function deleteAuthUser(userId: string): Promise<void> {
  const ctx = await (await getAuth()).$context;
  await deleteSignInTokens(userId);
  await ctx.internalAdapter.deleteUserSessions(userId);
  await ctx.internalAdapter.deleteAccounts(userId);
  await ctx.internalAdapter.deleteUser(userId);
}

/** The first of these ids that is an existing account, else null (store
 * webhooks name the buyer by our user id). */
export async function findExistingUserId(ids: readonly string[]): Promise<string | null> {
  const ctx = await (await getAuth()).$context;
  for (const id of ids) {
    const user = await ctx.internalAdapter.findUserById(id);
    if (user) return user.id;
  }
  return null;
}

export const DEV_LOGIN_DEFAULT_EMAIL = "test@verdict.local";
const DEV_EMAIL = /^[a-z0-9][a-z0-9._+-]{0,63}@verdict\.local$/;

export function isDevLoginEmail(email: string): boolean {
  return DEV_EMAIL.test(email);
}

/** Finds or creates a verified test user and opens a session for it. Only
 * call after devLoginAllowed(). */
export async function createDevSession(email: string): Promise<{ token: string; user: Viewer }> {
  if (!isDevLoginEmail(email)) throw new Error("dev login emails must end in @verdict.local");
  const ctx = await (await getAuth()).$context;
  const found = await ctx.internalAdapter.findUserByEmail(email);
  const user =
    found?.user ??
    (await ctx.internalAdapter.createUser({ email, name: "Test user", emailVerified: true }, { method: "dev-login" }));
  const session = await ctx.internalAdapter.createSession(user.id);
  return { token: session.token, user: toViewer(user) };
}

/** Finds a user by email, optionally creating it (verified). For the admin
 * grant script. */
export async function findOrCreateUserByEmail(
  email: string,
  create: boolean,
): Promise<{ user: Viewer; created: boolean } | null> {
  const ctx = await (await getAuth()).$context;
  const normalized = email.trim().toLowerCase();
  const found = await ctx.internalAdapter.findUserByEmail(normalized);
  if (found) return { user: toViewer(found.user), created: false };
  if (!create) return null;
  const user = await ctx.internalAdapter.createUser(
    { email: normalized, name: normalized.split("@")[0] ?? "", emailVerified: true },
    { method: "admin" },
  );
  return { user: toViewer(user), created: true };
}
