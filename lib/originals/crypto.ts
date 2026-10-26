/**
 * Encryption at rest for originals, name maps and display names, stored
 * Sign in with Apple refresh tokens, and the owner tokens of signed-out
 * writers. Server only.
 *
 * AES-256-GCM with a 32-byte app key from ORIGINALS_KEY (base64 or
 * base64url). ORIGINALS_KEY_PREVIOUS (comma-separated) holds older keys,
 * used only to decrypt. Every sealed value is bound to its row and purpose
 * through the additional authenticated data, so a blob cannot be moved to
 * another row. Envelope: v1.<kid>.<iv>.<ciphertext>.<tag>, base64url parts.
 *
 * Outside production an unset key falls back to a fixed development key
 * (with a warning). In production a missing or invalid key means nothing is
 * sealed: callers skip storing originals and display names, and verdicts go
 * on as before. Logs never carry content.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { OWNER_TOKEN_PATTERN } from "@/lib/originals-types";

type Env = Record<string, string | undefined>;

/** Replaced with a literal by `next build`/`next dev`, so a production build
 * stays production whatever NODE_ENV it is started with (same rule as auth). */
const BUILT_FOR_PRODUCTION = process.env.NODE_ENV === "production";
const isProduction = (env: Env) => BUILT_FOR_PRODUCTION || env.NODE_ENV === "production";

const DEV_KEY = createHash("sha256").update("judge-originals-dev-key:v1").digest();
const IV_BYTES = 12;
const TAG_BYTES = 16;

export type OriginalsKeyState = { ok: true; kid: string; dev: boolean } | { ok: false; reason: "missing" | "invalid" };

export class OriginalsCryptoError extends Error {
  readonly code: "no_key" | "unknown_key" | "corrupt";
  constructor(code: "no_key" | "unknown_key" | "corrupt") {
    super(`originals: ${code}`);
    this.name = "OriginalsCryptoError";
    this.code = code;
  }
}

/** AAD strings. Binding the blob to its row stops a blob being swapped between rows or purposes. */
export const aad = {
  original: (subject: string) => `judge:originals:v1:${subject}`,
  verdictDisplay: (verdictId: string) => `judge:display:v1:verdict:${verdictId}`,
  caseDisplay: (caseId: string, party: "a" | "b") => `judge:display:v1:case:${caseId}:${party}`,
  signInToken: (provider: string, clientId: string, userId: string) =>
    `judge:signin-token:v1:${provider}:${clientId}:${userId}`,
};

/** 32 bytes from base64 or base64url, or null. */
function decodeKey(raw: string | undefined): Buffer | null {
  const s = raw?.trim();
  if (!s || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(s)) return null;
  const buf = Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  return buf.length === 32 ? buf : null;
}

function kidOf(key: Buffer): string {
  return createHash("sha256").update(Buffer.concat([Buffer.from("judge-originals-kid:"), key])).digest("hex").slice(0, 8);
}

type Keys = { current: { key: Buffer; kid: string; dev: boolean } | null; all: Map<string, Buffer>; state: OriginalsKeyState };

function keys(env: Env): Keys {
  const all = new Map<string, Buffer>();
  for (const raw of (env.ORIGINALS_KEY_PREVIOUS ?? "").split(",")) {
    const k = decodeKey(raw);
    if (k) all.set(kidOf(k), k);
  }
  const rawCurrent = env.ORIGINALS_KEY?.trim();
  const decoded = decodeKey(rawCurrent);
  let current: Keys["current"] = null;
  let state: OriginalsKeyState;
  if (decoded) {
    current = { key: decoded, kid: kidOf(decoded), dev: false };
    state = { ok: true, kid: current.kid, dev: false };
  } else if (rawCurrent) {
    state = { ok: false, reason: "invalid" };
  } else if (isProduction(env)) {
    state = { ok: false, reason: "missing" };
  } else {
    current = { key: DEV_KEY, kid: kidOf(DEV_KEY), dev: true };
    state = { ok: true, kid: current.kid, dev: true };
  }
  if (current) all.set(current.kid, current.key);
  return { current, all, state };
}

/** Current key status. Production: ORIGINALS_KEY must decode to exactly 32
 * bytes. Elsewhere, unset gives the development key; set but invalid is
 * refused like in production. */
export function originalsKeyState(env: Env = process.env): OriginalsKeyState {
  return keys(env).state;
}

const logged = globalThis as unknown as { __judgeOriginalsKeyError?: boolean; __judgeOriginalsDevWarn?: boolean };

function logNoKeyOnce(): void {
  if (logged.__judgeOriginalsKeyError) return;
  logged.__judgeOriginalsKeyError = true;
  console.error(
    "[originals] ORIGINALS_KEY is missing or invalid: original texts, name maps and display names are NOT being stored. Set a 32-byte base64 key (openssl rand -base64 32) and restart.",
  );
}

/** Seals JSON for one subject. Null when there is no usable key (the
 * production error is logged once per process). Never throws for a missing key. */
export function sealJson(value: unknown, aadText: string, env: Env = process.env): { sealed: string; kid: string } | null {
  const { current } = keys(env);
  if (!current) {
    logNoKeyOnce();
    return null;
  }
  if (current.dev && !logged.__judgeOriginalsDevWarn) {
    logged.__judgeOriginalsDevWarn = true;
    console.warn("[originals] ORIGINALS_KEY unset: using the development key (never in production)");
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", current.key, iv);
  cipher.setAAD(Buffer.from(aadText, "utf8"));
  const ct = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const b64 = (b: Buffer) => b.toString("base64url");
  return { sealed: `v1.${current.kid}.${b64(iv)}.${b64(ct)}.${b64(tag)}`, kid: current.kid };
}

/** Opens a sealed value for the same AAD, with the current key or a
 * previous one, picked by key id. */
export function openJson<T = unknown>(sealed: string, aadText: string, env: Env = process.env): T {
  const parts = sealed.split(".");
  if (parts.length !== 5 || parts[0] !== "v1") throw new OriginalsCryptoError("corrupt");
  const [, kid, ivB64, ctB64, tagB64] = parts;
  const { all } = keys(env);
  if (all.size === 0) throw new OriginalsCryptoError("no_key");
  const key = all.get(kid);
  if (!key) throw new OriginalsCryptoError("unknown_key");
  const iv = Buffer.from(ivB64, "base64url");
  const tag = Buffer.from(tagB64, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new OriginalsCryptoError("corrupt");
  let plain: string;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(aadText, "utf8"));
    decipher.setAuthTag(tag);
    plain = Buffer.concat([decipher.update(Buffer.from(ctB64, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new OriginalsCryptoError("corrupt");
  }
  try {
    return JSON.parse(plain) as T;
  } catch {
    throw new OriginalsCryptoError("corrupt");
  }
}

/** openJson that logs a failure (subject only) and returns null. */
export function openOrNull<T = unknown>(sealed: string | null, aadText: string, subject: string, env: Env = process.env): T | null {
  if (!sealed) return null;
  try {
    return openJson<T>(sealed, aadText, env);
  } catch (e) {
    const code = e instanceof OriginalsCryptoError ? e.code : "corrupt";
    console.error(`[originals] open failed subject=${subject} code=${code}`);
    return null;
  }
}

export function newOwnerToken(): string {
  return randomBytes(32).toString("base64url");
}

export { OWNER_TOKEN_PATTERN };

export function ownerTokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Format check, then a constant-time comparison of the hashes. */
export function ownerTokenMatches(token: string | null | undefined, hash: string | null | undefined): boolean {
  if (!token || !hash || !OWNER_TOKEN_PATTERN.test(token) || !/^[0-9a-f]{64}$/.test(hash)) return false;
  const a = Buffer.from(ownerTokenHash(token), "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A new key for ORIGINALS_KEY (setup scripts, docs). */
export function generateOriginalsKey(): string {
  return randomBytes(32).toString("base64");
}
