import { premiumEnabled } from "./auth";

type Env = Record<string, string | undefined>;

/** Two-sided cases and appeals: on unless CASES_ENABLED=0, and only with Premium. */
export function casesEnabled(env: Env = process.env): boolean {
  return env.CASES_ENABLED?.trim() !== "0" && premiumEnabled(env);
}

/** Screenshot evidence: on unless EVIDENCE_ENABLED=0, and only with Premium. */
export function evidenceEnabled(env: Env = process.env): boolean {
  return env.EVIDENCE_ENABLED?.trim() !== "0" && premiumEnabled(env);
}
