/** Calendar-date arithmetic for the age check. Pure, so the website can use it too. */

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const AHEAD_MS = 14 * 60 * 60_000;

/** The calendar date `years` before `now` (UTC), as YYYY-MM-DD. On 29 February
 * the day becomes the 28th, so someone born on 1 March is not a year older a
 * day early (teenSql in lib/age.ts does the same in SQL). */
export function yearsBefore(now: Date, years: number): string {
  const leapDay = now.getUTCMonth() === 1 && now.getUTCDate() === 29;
  return new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), leapDay ? 28 : now.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

/** A real calendar date as YYYY-MM-DD, not in the future, not before 1900. */
export function validDob(value: unknown, now = new Date()): value is string {
  const m = typeof value === "string" ? DAY.exec(value) : null;
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  // A date that is still tomorrow in UTC may be today in the first time zone.
  const latest = new Date(now.getTime() + AHEAD_MS).toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10) === value && value >= "1900-01-01" && value <= latest;
}

/** Under 13 on the latest calendar date anywhere on Earth (UTC+14). The block
 * is permanent, so someone whose 13th birthday it already is in their own
 * time zone is never closed out. */
export function underThirteen(dob: string, now = new Date()): boolean {
  return dob > yearsBefore(new Date(now.getTime() + AHEAD_MS), 13);
}

export function underEighteen(dob: string, now = new Date()): boolean {
  return dob > yearsBefore(now, 18);
}
