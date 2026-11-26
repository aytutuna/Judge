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

/** Request header of an app build that can ask for the password or a fresh
 * sign-in ("Judge-Reauth: 1"). Builds shipped before it cannot, and Apple and
 * Google require deletion to keep working in them, so only website sessions
 * and builds that send it are held to the re-auth rule. */
export const REAUTH_HEADER = "Judge-Reauth";

/** Deleting the account needs a sign-in this young, or the password. */
export const DELETE_FRESH_MS = 10 * 60_000;

export async function hasPassword(userId: string): Promise<boolean> {
  const ctx = await (await getAuth()).$context;
  return Boolean((await ctx.internalAdapter.findCredentialAccount(userId))?.password);
}

export type SignInMethod = "password" | "code" | "new";

/** Which way an address signs in: with its password, by emailed code (an
 * account with no password), or as a new account. */
export async function signInMethod(email: string): Promise<SignInMethod> {
  const ctx = await (await getAuth()).$context;
  const found = await ctx.internalAdapter.findUserByEmail(email.trim().toLowerCase());
  if (!found) return "new";
  return (await hasPassword(found.user.id)) ? "password" : "code";
}

export type PasswordResult = "ok" | "current_required" | "current_wrong" | "unverified";

/** Writes for one account run one at a time, so two first-password requests
 * cannot both create a credential row. */
const chains = new Map<string, Promise<unknown>>();

function serial<T>(userId: string, work: () => Promise<T>): Promise<T> {
  const run = (chains.get(userId) ?? Promise.resolve()).then(work, work);
  const tail = run.catch(() => {});
  chains.set(userId, tail);
  void tail.then(() => {
    if (chains.get(userId) === tail) chains.delete(userId);
  });
  return run;
}

/** Sets the password, or replaces it when the account has one. Either needs a
 * session created within FRESH_SIGNIN_MS; a replacement may give `current`
 * instead. An address that was
 * never verified gets none. When a password is replaced, every other session
 * of the account is signed out first, so a failure part way leaves the old
 * password and fewer sessions. The first password revokes nothing: the code
 * sign-in that led to it may be one of several devices. */
export function setPassword(
  userId: string,
  sessionId: string,
  password: string,
  current: string | undefined,
  now = Date.now(),
): Promise<PasswordResult> {
  return serial(userId, async () => {
    const ctx = await (await getAuth()).$context;
    const user = await ctx.internalAdapter.findUserById(userId);
    if (!user?.emailVerified) return "unverified";
    const account = await ctx.internalAdapter.findCredentialAccount(userId);
    const sessions = await ctx.internalAdapter.listSessions(userId);
    if (account?.password && current !== undefined) {
      if (!(await ctx.password.verify({ hash: account.password, password: current }))) return "current_wrong";
    } else {
      const mine = sessions.find((s) => s.id === sessionId);
      if (!mine || now - new Date(mine.createdAt).getTime() > FRESH_SIGNIN_MS) return "current_required";
    }
    const hash = await ctx.password.hash(password);
    const others = account?.password ? sessions.filter((s) => s.id !== sessionId).map((s) => s.token) : [];
    if (others.length) await ctx.internalAdapter.deleteSessions(others);
    if (account) await ctx.internalAdapter.updateAccount(account.id, { password: hash });
    else await ctx.internalAdapter.linkAccount({ userId, providerId: "credential", accountId: userId, password: hash });
    return "ok";
  });
}

export type ReauthResult = "ok" | "reauth_required" | "password_wrong";

/** Whether the person at this session may delete the account: they gave the
 * password, or the session itself was created within DELETE_FRESH_MS. A
 * password is only checked when the account has one. */
export async function reauthForDelete(
  userId: string,
  sessionId: string,
  password: string | undefined,
  now = Date.now(),
): Promise<ReauthResult> {
  const ctx = await (await getAuth()).$context;
  const account = await ctx.internalAdapter.findCredentialAccount(userId);
  if (password !== undefined && account?.password) {
    return (await ctx.password.verify({ hash: account.password, password })) ? "ok" : "password_wrong";
  }
  const mine = (await ctx.internalAdapter.listSessions(userId)).find((s) => s.id === sessionId);
  return mine && now - new Date(mine.createdAt).getTime() <= DELETE_FRESH_MS ? "ok" : "reauth_required";
}
