/**
 * Setting the account password (server only), with Better Auth's own hasher
 * and credential account, so POST /api/auth/sign-in/email can use it. There
 * is no sign-up and no reset link: the person got here by signing in, with
 * a provider or an emailed code.
 */

import { getAuth } from "./auth";

/** A session this young counts as proof of the inbox or provider account, so
 * it may replace the password without knowing the old one (forgot password:
 * code sign-in, then a new password). */
export const FRESH_SIGNIN_MS = 5 * 60_000;

export async function hasPassword(userId: string): Promise<boolean> {
  const ctx = await (await getAuth()).$context;
  return Boolean((await ctx.internalAdapter.findCredentialAccount(userId))?.password);
}

export type PasswordResult = "ok" | "current_required" | "current_wrong";

/** Sets the password, or replaces it when the account has one: that needs
 * `current`, or a session created within FRESH_SIGNIN_MS. Every other session
 * of the account is signed out afterwards. */
export async function setPassword(
  userId: string,
  sessionId: string,
  password: string,
  current: string | undefined,
  now = Date.now(),
): Promise<PasswordResult> {
  const ctx = await (await getAuth()).$context;
  const account = await ctx.internalAdapter.findCredentialAccount(userId);
  const sessions = await ctx.internalAdapter.listSessions(userId);
  if (account?.password) {
    if (current !== undefined) {
      if (!(await ctx.password.verify({ hash: account.password, password: current }))) return "current_wrong";
    } else {
      const mine = sessions.find((s) => s.id === sessionId);
      if (!mine || now - new Date(mine.createdAt).getTime() > FRESH_SIGNIN_MS) return "current_required";
    }
  }
  const hash = await ctx.password.hash(password);
  if (account) await ctx.internalAdapter.updateAccount(account.id, { password: hash });
  else await ctx.internalAdapter.linkAccount({ userId, providerId: "credential", accountId: userId, password: hash });
  const others = sessions.filter((s) => s.id !== sessionId).map((s) => s.token);
  if (others.length) await ctx.internalAdapter.deleteSessions(others);
  return "ok";
}
