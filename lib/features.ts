import { authConfigured, premiumEnabled } from "./auth";

type Env = Record<string, string | undefined>;

/** Two-sided cases: on unless CASES_ENABLED=0, with accounts and a model key.
 * Free cases need no Premium; appeals and premium cases still do. */
export function casesEnabled(env: Env = process.env): boolean {
  return env.CASES_ENABLED?.trim() !== "0" && authConfigured(env) && Boolean(env.ANTHROPIC_API_KEY);
}

/** Screenshot evidence: on unless EVIDENCE_ENABLED=0, and only with Premium. */
export function evidenceEnabled(env: Env = process.env): boolean {
  return env.EVIDENCE_ENABLED?.trim() !== "0" && premiumEnabled(env);
}

/** Store purchases are live: PURCHASES_ENABLED=1 (off by default). Reported as
 * `pricing.purchasesEnabled` by GET /api/v1/config. */
export function purchasesEnabled(env: Env = process.env): boolean {
  return env.PURCHASES_ENABLED?.trim() === "1";
}
