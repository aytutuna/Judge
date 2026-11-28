import { createHash, timingSafeEqual } from "node:crypto";

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest();

/** Constant-time comparison; a secret under 32 characters never matches. */
export function sameSecret(given: string, secret: string): boolean {
  return secret.length >= 32 && timingSafeEqual(sha256(given), sha256(secret));
}

/** The shared secret between the Worker's own Durable Objects and cron
 * triggers and the /api/internal routes they call (JOB_SECRET). */
export function internalAuthorized(req: Request, env: Record<string, string | undefined> = process.env): boolean {
  return sameSecret(req.headers.get("x-internal-secret")?.trim() ?? "", env.JOB_SECRET?.trim() ?? "");
}
