/**
 * Admin tool: give or take premium for testing.
 *
 *   npx tsx --env-file=.env scripts/grant.ts <email> --credits 20
 *   npx tsx --env-file=.env scripts/grant.ts <email> --subscription 30d
 *   npx tsx --env-file=.env scripts/grant.ts <email> --revoke
 *   npx tsx --env-file=.env scripts/grant.ts <email> --show
 *
 * Add --create to make the account (email marked verified) if that person
 * has not signed in yet. Always prints the resulting entitlement. Grants are
 * recorded with source "admin" in the same ledger store purchases will use.
 *
 * On the server, from the app directory:
 *   sudo -u verdict npx tsx --env-file=/etc/verdict/verdict.env scripts/grant.ts <email> --credits 20
 */

import { pathToFileURL } from "node:url";
import { nanoid } from "nanoid";
import { authReady, findOrCreateUserByEmail } from "../lib/auth";
import { getEntitlement, grantCredits, grantSubscription, revokeAll } from "../lib/entitlements";
import { PRICING } from "../lib/pricing";

export type GrantAction =
  | { kind: "credits"; credits: number }
  | { kind: "subscription"; days: number }
  | { kind: "revoke" }
  | { kind: "show" };

export type GrantArgs = { email: string; action: GrantAction; create: boolean };

export const USAGE =
  "Usage: npx tsx --env-file=.env scripts/grant.ts <email> (--credits N | --subscription <N>d | --revoke | --show) [--create]";

export function parseGrantArgs(argv: readonly string[]): GrantArgs | { error: string } {
  let email: string | null = null;
  let create = false;
  const actions: GrantAction[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--create") create = true;
    else if (arg === "--revoke") actions.push({ kind: "revoke" });
    else if (arg === "--show") actions.push({ kind: "show" });
    else if (arg === "--credits") {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n <= 0 || n > 100_000) return { error: "--credits needs a whole number from 1 to 100000" };
      actions.push({ kind: "credits", credits: n });
    } else if (arg === "--subscription") {
      const m = /^(\d{1,4})d$/.exec(argv[++i] ?? "");
      const days = m ? Number(m[1]) : 0;
      if (days < 1 || days > 3660) return { error: "--subscription needs a duration like 30d (1d to 3660d)" };
      actions.push({ kind: "subscription", days });
    } else if (arg.startsWith("--")) return { error: `Unknown option ${arg}` };
    else if (email === null) email = arg.trim().toLowerCase();
    else return { error: `Unexpected argument ${arg}` };
  }
  if (!email || !/^[^\s@]+@[^\s@]+$/.test(email)) return { error: "Give the account's email address first" };
  if (actions.length !== 1) return { error: "Pick exactly one of --credits, --subscription, --revoke, --show" };
  return { email, action: actions[0], create };
}

export async function runGrant(args: GrantArgs, now: Date = new Date()): Promise<{ code: number; lines: string[] }> {
  await authReady();
  const found = await findOrCreateUserByEmail(args.email, args.create);
  if (!found) return { code: 1, lines: [`No account for ${args.email}. Sign in once first, or pass --create.`] };
  const { user, created } = found;
  const lines: string[] = [];
  if (created) lines.push(`Created account ${user.email} (${user.id}).`);

  const { action } = args;
  if (action.kind === "credits") {
    await grantCredits({
      userId: user.id,
      credits: action.credits,
      source: "admin",
      externalId: `admin:${nanoid()}`,
      note: "scripts/grant.ts",
    });
    lines.push(`Granted ${action.credits} credits.`);
  } else if (action.kind === "subscription") {
    const periodEnd = new Date(now.getTime() + action.days * 24 * 60 * 60 * 1000);
    await grantSubscription({
      userId: user.id,
      source: "admin",
      externalId: `admin:${nanoid()}`,
      originalTransactionId: `admin:${user.id}`,
      productId: PRICING.monthly.id,
      periodStart: now.toISOString(),
      periodEnd: periodEnd.toISOString(),
      willRenew: false,
    });
    lines.push(`Monthly plan active until ${periodEnd.toISOString()}.`);
  } else if (action.kind === "revoke") {
    await revokeAll(user.id, { externalId: `admin:${nanoid()}`, note: "scripts/grant.ts --revoke" });
    lines.push("Revoked all credits and subscriptions.");
  }

  const entitlement = await getEntitlement(user.id, now);
  lines.push(`Account ${user.email} (${user.id}):`, JSON.stringify(entitlement, null, 2));
  return { code: 0, lines };
}

async function main(): Promise<void> {
  const parsed = parseGrantArgs(process.argv.slice(2));
  if ("error" in parsed) {
    console.error(`${parsed.error}\n${USAGE}`);
    process.exit(2);
  }
  try {
    const { code, lines } = await runGrant(parsed);
    (code === 0 ? console.log : console.error)(lines.join("\n"));
    process.exit(code);
  } catch (e) {
    console.error("grant failed:", e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
