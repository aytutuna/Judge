/**
 * The parent step (design in .scratch/plan/parent-consent-design.md). Where
 * a teen lives can require a parent's yes before the account does anything
 * (lib/age-region.ts); the teen gives a parent's address, the parent gets a
 * mail with an Approve and a Decline link, and an approval is confirmed by a
 * second mail with a Withdraw link.
 *
 * parent_consent keeps one row per account. The parent's address is stored
 * sealed (like the originals) only while a request is open, so a resend
 * works; after an approval or a decline it is gone and only a keyed hash of
 * it stays, which backs the per-address limit. Link tokens are random and
 * stored as SHA-256 hashes. user.age_parent mirrors a decided status so the
 * session lookup needs no join. When the account is deleted the row loses
 * every address, hash and token and stays 12 months as proof of what was
 * asked and decided (closeParentRecord, pruneParentRecords).
 *
 * Rules: a link works for 14 days; 3 resends in all and not within an hour
 * of the last mail; 3 changes of the address; a pending, declined or revoked
 * account is deleted 30 days after it started waiting or was decided
 * (dueParentAccounts, lib/minor-deletion.ts). Server only.
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { InStatement } from "@libsql/client";
import { ageStateOf } from "@/lib/age";
import { canonicalEmail, parentEmailHash } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { entitlementWriteBatch } from "@/lib/entitlements";
import { sendParentApprovedEmail, sendParentRequestEmail } from "@/lib/email";
import type { Lang } from "@/lib/langs";
import { aad, openJson, sealJson } from "@/lib/originals/crypto";
import { POLICY_VERSION } from "@/lib/policy";
import { checkUserLimits } from "@/lib/ratelimit";

export const LINK_DAYS = 14;
export const DELETE_DAYS = 30;
export const MAX_RESENDS = 3;
export const MAX_CHANGES = 3;
export const RESEND_WAIT_MS = 60 * 60_000;
const PROOF_MONTHS = 12;
const DAY_MS = 24 * 60 * 60_000;

export type ParentStatus = "pending" | "approved" | "declined" | "revoked";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS parent_consent (
    id                TEXT PRIMARY KEY,
    user_id           TEXT NOT NULL UNIQUE,
    status            TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'declined', 'revoked')),
    parent_email_hash TEXT,
    parent_email_enc  TEXT,
    token_hash        TEXT,
    withdraw_hash     TEXT,
    lang              TEXT,
    created_at        TEXT NOT NULL,
    requested_at      TEXT,
    expires_at        TEXT,
    resend_count      INTEGER NOT NULL DEFAULT 0,
    change_count      INTEGER NOT NULL DEFAULT 0,
    decided_at        TEXT,
    policy_version    TEXT,
    wording_key       TEXT,
    country           TEXT,
    user_deleted_at   TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS parent_consent_email ON parent_consent (parent_email_hash)",
  "CREATE INDEX IF NOT EXISTS parent_consent_token ON parent_consent (token_hash)",
  "CREATE INDEX IF NOT EXISTS parent_consent_withdraw ON parent_consent (withdraw_hash)",
];

const globalForParent = globalThis as unknown as { __judgeParentReady?: { client: unknown; ready: Promise<void> } };

/** Creates the table once per process. Idempotent. */
export async function ensureParentTables(): Promise<void> {
  const client = await getDb();
  const cached = globalForParent.__judgeParentReady;
  if (cached?.client === client) return cached.ready;
  const ready = client.batch(SCHEMA, "write").then(
    () => undefined,
    (e: unknown) => {
      globalForParent.__judgeParentReady = undefined;
      throw e;
    },
  );
  globalForParent.__judgeParentReady = { client, ready };
  return ready;
}

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
export const isParentToken = (v: unknown): v is string => typeof v === "string" && TOKEN.test(v);

/** The public origin the links point to. */
function origin(): string {
  const raw = process.env.BETTER_AUTH_URL?.trim() || process.env.NEXT_PUBLIC_SITE_URL?.trim() || "http://localhost:3000";
  try {
    return new URL(raw).origin;
  } catch {
    return "http://localhost:3000";
  }
}

/** What the teen's pending screen needs; never the address. */
export type ParentView = {
  status: ParentStatus | "none";
  /** An address was given and a mail went out. */
  sent: boolean;
  /** The address as j***@example.com. */
  emailHint: string | null;
  /** When the current link stops working, ISO. */
  expiresAt: string | null;
  expired: boolean;
  resendsLeft: number;
  changesLeft: number;
  /** The earliest ISO time a resend is accepted; null when it is allowed now. */
  resendAt: string | null;
  /** When the account is deleted if nothing changes, ISO. */
  deleteAt: string | null;
};

type Row = {
  id: string;
  user_id: string;
  status: ParentStatus;
  parent_email_hash: string | null;
  parent_email_enc: string | null;
  token_hash: string | null;
  withdraw_hash: string | null;
  lang: string | null;
  created_at: string;
  requested_at: string | null;
  expires_at: string | null;
  resend_count: number;
  change_count: number;
  decided_at: string | null;
};

async function readRow(userId: string): Promise<Row | null> {
  await ensureParentTables();
  const db = await getDb();
  const rs = await db.execute({ sql: "SELECT * FROM parent_consent WHERE user_id = ? AND user_deleted_at IS NULL", args: [userId] });
  return (rs.rows[0] as unknown as Row | undefined) ?? null;
}

/** Makes the account's row if it has none, so its 30 days start. */
export async function ensureParentRow(userId: string, now = new Date()): Promise<void> {
  await ensureParentTables();
  const db = await getDb();
  await db.execute({
    sql: `INSERT OR IGNORE INTO parent_consent (id, user_id, status, created_at) VALUES (?, ?, 'pending', ?)`,
    args: [randomUUID(), userId, now.toISOString()],
  });
}

function mask(email: string): string {
  const [local, domain = ""] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

const addDays = (iso: string, days: number) => new Date(new Date(iso).getTime() + days * DAY_MS).toISOString();

function viewOf(row: Row | null, now: Date): ParentView {
  if (!row) {
    return { status: "none", sent: false, emailHint: null, expiresAt: null, expired: false, resendsLeft: MAX_RESENDS, changesLeft: MAX_CHANGES, resendAt: null, deleteAt: null };
  }
  const sent = row.status === "pending" && row.requested_at !== null;
  const hint = sent && row.parent_email_enc ? openJson<string>(row.parent_email_enc, aad.parentEmail(row.user_id)) : null;
  const resendAt = sent && row.requested_at ? new Date(new Date(row.requested_at).getTime() + RESEND_WAIT_MS) : null;
  const deleteAt =
    row.status === "pending" ? addDays(row.created_at, DELETE_DAYS) : row.status === "approved" ? null : row.decided_at ? addDays(row.decided_at, DELETE_DAYS) : null;
  return {
    status: row.status,
    sent,
    emailHint: hint ? mask(hint) : null,
    expiresAt: sent ? row.expires_at : null,
    expired: sent && row.expires_at !== null && row.expires_at <= now.toISOString(),
    resendsLeft: Math.max(0, MAX_RESENDS - row.resend_count),
    changesLeft: Math.max(0, MAX_CHANGES - row.change_count),
    resendAt: resendAt && resendAt > now ? resendAt.toISOString() : null,
    deleteAt,
  };
}

export async function parentView(userId: string, now = new Date()): Promise<ParentView> {
  return viewOf(await readRow(userId), now);
}

export type RequestResult =
  | { ok: true; view: ParentView }
  | {
      ok: false;
      code: "parent_email" | "parent_declined" | "parent_wait" | "parent_limit" | "conflict" | "rate_limited" | "unavailable";
      retryAfterSec?: number;
    };

/**
 * The teen's request: the first address, a different one (a change) or the
 * same one again (a resend). Sends the mail before anything is written, so a
 * mail that fails changes nothing; a write that lost a race answers
 * "conflict". An address that is the account's own or another account's is
 * refused with "parent_email". After a withdrawal a new request starts over
 * with fresh counts.
 */
export async function requestParent(args: {
  userId: string;
  userName: string;
  userEmail: string;
  email: string | null;
  lang: Lang;
  now?: Date;
}): Promise<RequestResult> {
  const { userId, userName, userEmail, lang } = args;
  const now = args.now ?? new Date();
  await ensureParentRow(userId, now);
  const row = (await readRow(userId))!;
  if (row.status === "declined") return { ok: false, code: "parent_declined" };
  if (row.status === "approved") return { ok: false, code: "conflict" };
  const current = row.parent_email_enc ? openJson<string>(row.parent_email_enc, aad.parentEmail(userId)) : null;
  const email = (args.email ?? current)?.trim() ?? null;
  if (!email) return { ok: false, code: "parent_email" };
  const hash = parentEmailHash(email);
  if (!hash) return { ok: false, code: "conflict" };
  if (canonicalEmail(email) === canonicalEmail(userEmail) || (await isJudgeAddress(email))) return { ok: false, code: "parent_email" };
  const resending = current !== null && parentEmailHash(current) === hash;
  const changing = !resending && current !== null;
  if (resending) {
    if (row.resend_count >= MAX_RESENDS) return { ok: false, code: "parent_limit" };
    const next = new Date(row.requested_at ?? 0).getTime() + RESEND_WAIT_MS;
    if (next > now.getTime()) return { ok: false, code: "parent_wait", retryAfterSec: Math.ceil((next - now.getTime()) / 1000) };
  }
  if (changing && row.change_count >= MAX_CHANGES) return { ok: false, code: "parent_limit" };

  // Five mails a day to one address, whoever asks.
  const limit = await checkUserLimits(hash, "parent_address").catch(() => null);
  if (!limit || (!limit.ok && limit.code === "unavailable")) return { ok: false, code: "unavailable" };
  if (!limit.ok) return { ok: false, code: "rate_limited", retryAfterSec: "retryAfterSec" in limit ? limit.retryAfterSec : undefined };
  const sealed = sealJson(email, aad.parentEmail(userId));
  if (!sealed) throw new Error("parent email could not be sealed");
  const token = newToken();
  const nowIso = now.toISOString();
  await sendParentRequestEmail({
    to: email,
    name: userName.trim(),
    approveUrl: `${origin()}/parent/${token}`,
    declineUrl: `${origin()}/parent/${token}?decline=1`,
    lang,
  });
  const fresh = row.status === "revoked";
  const db = await getDb();
  const done = await db.execute({
    sql: `UPDATE parent_consent SET status = 'pending', parent_email_hash = ?, parent_email_enc = ?, token_hash = ?, withdraw_hash = NULL,
            lang = ?, requested_at = ?, expires_at = ?, decided_at = NULL, resend_count = ?, change_count = ?
          WHERE id = ? AND status = ? AND token_hash IS ?`,
    args: [
      hash,
      sealed.sealed,
      tokenHash(token),
      lang,
      nowIso,
      addDays(nowIso, LINK_DAYS),
      fresh ? 0 : row.resend_count + (resending ? 1 : 0),
      fresh ? 0 : row.change_count + (changing ? 1 : 0),
      row.id,
      row.status,
      row.token_hash,
    ],
  });
  if (done.rowsAffected === 0) return { ok: false, code: "conflict" };
  if (fresh) await db.execute({ sql: `UPDATE "user" SET age_parent = NULL WHERE id = ?`, args: [userId] });
  return { ok: true, view: await parentView(userId, now) };
}

async function isJudgeAddress(email: string): Promise<boolean> {
  const db = await getDb();
  const rs = await db.execute({ sql: `SELECT 1 FROM "user" WHERE lower(email) = ? LIMIT 1`, args: [email.trim().toLowerCase()] });
  return rs.rows.length > 0;
}

/** What a parent's link shows. */
export type LinkInfo = {
  kind: "request" | "withdraw";
  name: string;
  /** False for a request link past its 14 days or already answered. */
  usable: boolean;
};

type LinkRow = Row & { name: string | null };

async function findByToken(token: string): Promise<{ row: LinkRow; kind: "request" | "withdraw" } | null> {
  await ensureParentTables();
  const db = await getDb();
  const h = tokenHash(token);
  const rs = await db.execute({
    sql: `SELECT p.*, u.name AS name FROM parent_consent p JOIN "user" u ON u.id = p.user_id
          WHERE p.user_deleted_at IS NULL AND (p.token_hash = ? OR p.withdraw_hash = ?)`,
    args: [h, h],
  });
  const row = rs.rows[0] as unknown as LinkRow | undefined;
  if (!row) return null;
  return { row, kind: row.withdraw_hash === h ? "withdraw" : "request" };
}

/** Null when the link matches nothing (unknown, used up or its account deleted). */
export async function linkInfo(token: string, now = new Date()): Promise<LinkInfo | null> {
  const found = await findByToken(token);
  if (!found) return null;
  const { row, kind } = found;
  const usable =
    kind === "withdraw"
      ? row.status === "approved"
      : row.status === "pending" && row.expires_at !== null && row.expires_at > now.toISOString();
  return { kind, name: row.name ?? "", usable };
}

export type DecideResult = "approved" | "declined" | "withdrawn" | "invalid" | "failed";

/** Approve, decline or withdraw through a link. Approval needs the parent's
 * tick (`guardian`) and the confirmation mail going out; without it the
 * approval is taken back and the link works again ("failed"). Single use: a
 * second try is "invalid". */
export async function decideParent(
  token: string,
  action: "approve" | "decline" | "withdraw",
  guardian: boolean,
  now = new Date(),
): Promise<DecideResult> {
  const found = await findByToken(token);
  if (!found) return "invalid";
  const { row, kind } = found;
  const nowIso = now.toISOString();
  const mirror = (status: string): InStatement => ({
    sql: `UPDATE "user" SET age_parent = ? WHERE id = ?`,
    args: [status, row.user_id],
  });
  const country = async () => {
    const db = await getDb();
    const rs = await db.execute({ sql: `SELECT age_country FROM "user" WHERE id = ?`, args: [row.user_id] });
    return typeof rs.rows[0]?.age_country === "string" ? rs.rows[0].age_country : null;
  };
  if (action === "withdraw") {
    if (kind !== "withdraw" || row.status !== "approved") return "invalid";
    const [done] = await entitlementWriteBatch([
      {
        sql: `UPDATE parent_consent SET status = 'revoked', decided_at = ?, withdraw_hash = NULL, wording_key = 'parent.withdraw'
              WHERE id = ? AND status = 'approved' AND withdraw_hash = ?`,
        args: [nowIso, row.id, tokenHash(token)],
      },
    ]);
    if (done.rowsAffected === 0) return "invalid";
    await entitlementWriteBatch([mirror("revoked")]);
    return "withdrawn";
  }
  if (kind !== "request" || row.status !== "pending" || !row.expires_at || row.expires_at <= nowIso) return "invalid";
  if (action === "decline") {
    const [done] = await entitlementWriteBatch([
      {
        sql: `UPDATE parent_consent SET status = 'declined', decided_at = ?, parent_email_enc = NULL, token_hash = NULL,
                policy_version = ?, wording_key = 'parent.decline', country = ?
              WHERE id = ? AND status = 'pending' AND token_hash = ?`,
        args: [nowIso, POLICY_VERSION, await country(), row.id, tokenHash(token)],
      },
    ]);
    if (done.rowsAffected === 0) return "invalid";
    await entitlementWriteBatch([mirror("declined")]);
    return "declined";
  }
  if (!guardian) return "invalid";
  const email = row.parent_email_enc ? openJson<string>(row.parent_email_enc, aad.parentEmail(row.user_id)) : null;
  if (!email) return "invalid";
  const withdraw = newToken();
  // Claim the approval first so two clicks cannot both send a withdraw link.
  const [done] = await entitlementWriteBatch([
    {
      sql: `UPDATE parent_consent SET status = 'approved', decided_at = ?, withdraw_hash = ?, policy_version = ?,
              wording_key = 'parent.tick', country = ?
            WHERE id = ? AND status = 'pending' AND token_hash = ?`,
      args: [nowIso, tokenHash(withdraw), POLICY_VERSION, await country(), row.id, tokenHash(token)],
    },
  ]);
  if (done.rowsAffected === 0) return "invalid";
  try {
    await sendParentApprovedEmail({
      to: email,
      name: (row.name ?? "").trim(),
      withdrawUrl: `${origin()}/parent/${withdraw}`,
      lang: (row.lang as Lang | null) ?? "en",
    });
  } catch (e) {
    console.error("[parent] confirmation email failed:", e instanceof Error ? e.message : String(e));
    await entitlementWriteBatch([
      {
        sql: `UPDATE parent_consent SET status = 'pending', decided_at = NULL, withdraw_hash = NULL, wording_key = NULL
              WHERE id = ? AND status = 'approved' AND withdraw_hash = ?`,
        args: [row.id, tokenHash(withdraw)],
      },
    ]);
    return "failed";
  }
  await entitlementWriteBatch([
    { sql: `UPDATE parent_consent SET parent_email_enc = NULL, token_hash = NULL WHERE id = ? AND status = 'approved'`, args: [row.id] },
    mirror("approved"),
  ]);
  return "approved";
}

/** The account is being deleted: the row loses every address, hash and token
 * and is kept 12 months as the record of what was asked and decided. Its
 * account id is swapped for a random one, as the consent ledger does. */
export async function closeParentRecord(userId: string, now = new Date()): Promise<void> {
  await ensureParentTables();
  const db = await getDb();
  await db.execute({
    sql: `UPDATE parent_consent SET user_id = ?, user_deleted_at = ?, parent_email_hash = NULL, parent_email_enc = NULL,
            token_hash = NULL, withdraw_hash = NULL, lang = NULL
          WHERE user_id = ? AND user_deleted_at IS NULL`,
    args: [`gone:${randomUUID()}`, now.toISOString(), userId],
  });
}

/** Proof records 12 months after their account was deleted. */
export async function pruneParentRecords(now = new Date()): Promise<number> {
  await ensureParentTables();
  const db = await getDb();
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - PROOF_MONTHS);
  const rs = await db.execute({
    sql: "DELETE FROM parent_consent WHERE user_deleted_at IS NOT NULL AND user_deleted_at < ?",
    args: [cutoff.toISOString()],
  });
  return rs.rowsAffected;
}

/** The accounts that waited for a parent, or were declined or revoked, 30
 * days ago and still need one (a teen who has since grown past the age, or
 * whose places changed, is not listed). */
export async function dueParentAccounts(now = new Date()): Promise<{ id: string; email: string }[]> {
  await ensureParentTables();
  const db = await getDb();
  const cutoff = new Date(now.getTime() - DELETE_DAYS * DAY_MS).toISOString();
  let rs;
  try {
    rs = await db.execute({
      sql: `SELECT u.id, u.email, u.age_confirmed_at, u.age_blocked_at, u.age_block_final, u.age_dob, u.age_dob_at, u.age_signal,
                   u.age_signal_at, u.age_country, u.age_quebec, u.age_region_lifted_at, u.age_parent
            FROM parent_consent p JOIN "user" u ON u.id = p.user_id
            WHERE p.user_deleted_at IS NULL AND p.status <> 'approved'
              AND ((p.status = 'pending' AND p.created_at <= ?) OR (p.status <> 'pending' AND p.decided_at <= ?))`,
      args: [cutoff, cutoff],
    });
  } catch (e) {
    // Startup cleanup can run before the sign-in migration made the table.
    if (/no such (column|table)/i.test(e instanceof Error ? e.message : String(e))) return [];
    throw e;
  }
  return rs.rows
    .filter(
      (r) =>
        ageStateOf(
          {
            confirmedAt: r.age_confirmed_at,
            blockedAt: r.age_blocked_at,
            blockFinal: r.age_block_final,
            dob: r.age_dob,
            dobAt: r.age_dob_at,
            signal: r.age_signal,
            signalAt: r.age_signal_at,
            country: r.age_country,
            quebec: r.age_quebec,
            regionLiftedAt: r.age_region_lifted_at,
            parent: r.age_parent,
          },
          now,
        ).parent !== undefined,
    )
    .map((r) => ({ id: String(r.id), email: String(r.email) }));
}
