import { format } from "node:util";

/**
 * Under systemd, console.error and console.warn both reach the journal at
 * info level. Prefixing each line with its syslog level (<3> err, <4> warning)
 * lets journald file it as such, so `journalctl -u verdict -p err` lists the
 * errors and the error spike check (deploy/aws-lightsail/errors.sh) can count
 * them. Only the first line of a multi-line message carries the level.
 */
export function tagJournalLevels(c: Pick<Console, "error" | "warn"> = console): void {
  const error = c.error.bind(c);
  const warn = c.warn.bind(c);
  c.error = (...args: unknown[]) => error(`<3>${format(...args)}`);
  c.warn = (...args: unknown[]) => warn(`<4>${format(...args)}`);
}
