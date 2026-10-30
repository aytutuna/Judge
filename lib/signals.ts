/**
 * One warning line per event the server's watcher counts
 * (deploy/aws-lightsail/watch.sh), e.g. `[signal:rate_limited] bucket=ip:verdict_poll`.
 * It alerts when one kind piles up within 5 minutes. Never put user text or
 * addresses in `detail`.
 */
export type Signal =
  | "rate_limited"
  | "turnstile_fail"
  | "bad_origin"
  | "bearer_401"
  | "webhook_bad_secret"
  | "webhook_apply_failed"
  | "entitlement_refused"
  | "provider_rate"
  | "provider_down"
  | "many_accounts_per_device"
  | "events_cap"
  | "age_blocked";

export function signal(name: Signal, detail?: string): void {
  console.warn(detail ? `[signal:${name}] ${detail}` : `[signal:${name}]`);
}
