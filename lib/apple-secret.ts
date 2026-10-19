/**
 * Sign in with Apple's "client secret": an ES256 JWT signed with the team's
 * Sign in with Apple key (AuthKey_<KEYID>.p8), valid for at most ~6 months.
 * Server only (node:crypto). The key never appears in logs or errors.
 */

import { createPrivateKey, sign, type KeyObject } from "node:crypto";

/** Apple accepts at most 15,777,000 seconds (~182 days); 180 days is used. */
export const APPLE_SECRET_TTL_SEC = 180 * 24 * 60 * 60;
/** Rebuild the secret (and the auth instance) once it is this old. */
export const APPLE_SECRET_REFRESH_MS = 150 * 24 * 60 * 60 * 1000;

export type AppleSecretEnv = {
  teamId: string;
  keyId: string;
  clientId: string;
  /** APPLE_PRIVATE_KEY_BASE64: base64 of the whole .p8 file (PKCS#8 PEM). */
  privateKeyBase64: string;
};

/** The four Apple values from the environment, or null when any is missing. */
export function appleEnv(env: Record<string, string | undefined> = process.env): AppleSecretEnv | null {
  const teamId = env.APPLE_TEAM_ID?.trim();
  const keyId = env.APPLE_KEY_ID?.trim();
  const clientId = env.APPLE_CLIENT_ID?.trim();
  const privateKeyBase64 = env.APPLE_PRIVATE_KEY_BASE64?.trim();
  if (!teamId || !keyId || !clientId || !privateKeyBase64) return null;
  return { teamId, keyId, clientId, privateKeyBase64 };
}

/** Parses the key: base64 of the PEM file, or (forgivingly) the PEM itself. */
export function appleKey(privateKeyBase64: string): KeyObject {
  const value = privateKeyBase64.trim();
  const pem = value.includes("-----BEGIN") ? value : Buffer.from(value, "base64").toString("utf8");
  if (!pem.includes("-----BEGIN PRIVATE KEY-----")) {
    throw new Error("APPLE_PRIVATE_KEY_BASE64 is not a base64-encoded PKCS#8 .p8 key");
  }
  try {
    return createPrivateKey({ key: pem, format: "pem" });
  } catch {
    throw new Error("APPLE_PRIVATE_KEY_BASE64 could not be parsed as a private key");
  }
}

const b64url = (data: Buffer | string) => Buffer.from(data).toString("base64url");

/** Signs the client-secret JWT. Returns it with its issue time (ms). */
export function appleClientSecret(cfg: AppleSecretEnv, now: Date = new Date()): { jwt: string; issuedAtMs: number } {
  const key = appleKey(cfg.privateKeyBase64);
  const iat = Math.floor(now.getTime() / 1000);
  const header = { alg: "ES256", kid: cfg.keyId, typ: "JWT" };
  const payload = {
    iss: cfg.teamId,
    iat,
    exp: iat + APPLE_SECRET_TTL_SEC,
    aud: "https://appleid.apple.com",
    sub: cfg.clientId,
  };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  // JOSE wants the raw r||s signature, not DER.
  const signature = sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" });
  return { jwt: `${input}.${b64url(signature)}`, issuedAtMs: iat * 1000 };
}
