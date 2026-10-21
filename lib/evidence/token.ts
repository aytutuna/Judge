/**
 * Signed evidence tokens. An upload returns, per readable image, a token
 * holding the raw rendered transcript; submissions send the token back. The
 * server keeps nothing between the two: the HMAC proves the transcript is
 * the machine transcript this server made, for this audience, recently.
 *
 * Format: v1.<base64url(JSON payload)>.<base64url(HMAC-SHA256(key, "v1." + payload))>
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { derivedSecret } from "@/lib/auth";
import { EvidenceKind } from "@/lib/types";
import type { EvidenceAudience, VerifiedEvidence } from "./types";

export const EVIDENCE_TOKEN_TTL_MS = 6 * 60 * 60 * 1000;
export const MAX_TOKEN_LENGTH = 16_000;
const PREFIX = "v1.";

type Payload = {
  v: 1;
  aud: string;
  /** Issued / expires, epoch seconds. */
  iat: number;
  exp: number;
  kind: EvidenceKind;
  transcript: string;
  /** First 16 hex chars of sha256(image bytes): spots the same image twice. */
  sha: string;
};

export function audienceString(audience: EvidenceAudience): string {
  return audience.type === "user" ? `u:${audience.userId}` : `r:${audience.caseId}`;
}

function mac(key: Buffer, signed: string): Buffer {
  return createHmac("sha256", key).update(signed).digest();
}

export type SignedEvidence = { token: string; expiresAt: string };

/**
 * Signs a transcript. A transcript too long for the token cap (only possible
 * with unusual scripts, where one character takes several bytes) is cut
 * further until the token fits. Null when accounts are not configured.
 */
export function signEvidenceToken(
  input: { audience: EvidenceAudience; kind: EvidenceKind; transcript: string; sha: string },
  now: Date = new Date(),
  env?: Record<string, string | undefined>,
): SignedEvidence | null {
  const key = derivedSecret("evidence-token", env);
  if (!key) return null;
  const iat = Math.floor(now.getTime() / 1000);
  const exp = iat + EVIDENCE_TOKEN_TTL_MS / 1000;
  let transcript = input.transcript;
  for (;;) {
    const payload: Payload = {
      v: 1,
      aud: audienceString(input.audience),
      iat,
      exp,
      kind: input.kind,
      transcript,
      sha: input.sha,
    };
    const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const signed = `${PREFIX}${body}`;
    const token = `${signed}.${mac(key, signed).toString("base64url")}`;
    if (token.length <= MAX_TOKEN_LENGTH || transcript.length < 100) {
      return { token, expiresAt: new Date(exp * 1000).toISOString() };
    }
    transcript = `${transcript.slice(0, Math.floor(transcript.length * 0.8)).trimEnd()}\n[... more not shown]`;
  }
}

/** The verified transcript (plus the image hash), or null for anything
 * malformed, tampered, expired, from the future or for another audience. */
export function verifyEvidenceToken(
  token: string,
  audience: EvidenceAudience,
  now: Date = new Date(),
  env?: Record<string, string | undefined>,
): (VerifiedEvidence & { sha: string }) | null {
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH || !token.startsWith(PREFIX)) return null;
  const key = derivedSecret("evidence-token", env);
  if (!key) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(parts[1]) || !/^[A-Za-z0-9_-]+$/.test(parts[2])) return null;
  const expected = mac(key, `${PREFIX}${parts[1]}`);
  const given = Buffer.from(parts[2], "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  let payload: Partial<Payload>;
  try {
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Partial<Payload>;
  } catch {
    return null;
  }
  const nowSec = Math.floor(now.getTime() / 1000);
  if (
    payload.v !== 1 ||
    payload.aud !== audienceString(audience) ||
    typeof payload.iat !== "number" ||
    typeof payload.exp !== "number" ||
    payload.exp <= nowSec ||
    payload.iat > nowSec + 300 ||
    typeof payload.transcript !== "string" ||
    !payload.transcript.trim() ||
    typeof payload.sha !== "string"
  ) {
    return null;
  }
  const kind = EvidenceKind.safeParse(payload.kind);
  if (!kind.success) return null;
  return { kind: kind.data, transcript: payload.transcript, sha: payload.sha };
}

/**
 * Verifies the tokens of one submission. More than `max` tokens is
 * "too_many_files"; any bad token is "evidence_invalid" (the client removes
 * and re-adds that image). The same image sent twice counts once.
 */
export function verifyEvidenceTokens(
  tokens: readonly string[] | undefined,
  audience: EvidenceAudience,
  max: number,
  now: Date = new Date(),
): { ok: true; items: VerifiedEvidence[] } | { ok: false; code: "evidence_invalid" | "too_many_files" } {
  if (!tokens || tokens.length === 0) return { ok: true, items: [] };
  if (tokens.length > max) return { ok: false, code: "too_many_files" };
  const items: VerifiedEvidence[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    const verified = verifyEvidenceToken(token, audience, now);
    if (!verified) return { ok: false, code: "evidence_invalid" };
    if (seen.has(verified.sha)) continue;
    seen.add(verified.sha);
    items.push({ kind: verified.kind, transcript: verified.transcript });
  }
  return { ok: true, items };
}
