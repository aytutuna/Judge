/**
 * Invite links. token = first 16 bytes (128 bits) of
 * HMAC-SHA256(derivedSecret("case-invite"), "invite:<caseId>:<nonce>"),
 * base64url (22 characters). The database keeps the nonce and sha256(token),
 * never the token: a database leak alone cannot produce a working link, and
 * the owner can still copy the link later (it is re-derived). A new nonce
 * turns the old link off. Rotating BETTER_AUTH_SECRET turns every link off
 * (and every respondent claim secret).
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { derivedSecret } from "@/lib/auth";
import { INVITE_TOKEN_PATTERN } from "@/lib/case-types";

export function newInviteNonce(): string {
  return randomBytes(16).toString("base64url");
}

/** The invite token for (case, nonce), or null when accounts are not configured. */
export function inviteToken(caseId: string, nonce: string): string | null {
  const key = derivedSecret("case-invite");
  if (!key) return null;
  return createHmac("sha256", key).update(`invite:${caseId}:${nonce}`).digest().subarray(0, 16).toString("base64url");
}

export function inviteHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isInviteToken(token: string): boolean {
  return INVITE_TOKEN_PATTERN.test(token);
}

/**
 * The respondent's claim secret: proof of having written side B, for a
 * respondent who answered signed out. Built like the invite token, from its
 * own derived key and a nonce stored when side B is submitted, so the
 * database alone cannot produce it and a retried submission can return the
 * same secret. Null when accounts are not configured.
 */
export function respondentClaim(caseId: string, nonce: string): string | null {
  const key = derivedSecret("respondent-claim");
  if (!key) return null;
  return createHmac("sha256", key).update(`claim:${caseId}:${nonce}`).digest().subarray(0, 16).toString("base64url");
}

/** Whether `claim` is this case's respondent claim secret. */
export function claimMatches(row: { id: string; respondentClaimNonce: string | null }, claim: string | null | undefined): boolean {
  if (!claim || !row.respondentClaimNonce || !INVITE_TOKEN_PATTERN.test(claim)) return false;
  const expected = respondentClaim(row.id, row.respondentClaimNonce);
  if (!expected) return false;
  const a = Buffer.from(claim);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
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

/** The public origin for links: BETTER_AUTH_URL, else NEXT_PUBLIC_SITE_URL,
 * else the request's own origin. */
export function publicOrigin(req: Request, env: Record<string, string | undefined> = process.env): string {
  return originOf(env.BETTER_AUTH_URL) ?? originOf(env.NEXT_PUBLIC_SITE_URL) ?? new URL(req.url).origin;
}

export function inviteUrl(origin: string, token: string): string {
  return `${origin}/r/${token}`;
}
