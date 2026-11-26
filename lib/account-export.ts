/**
 * GET /api/v1/me/export: a signed-in person's copy of everything Judge holds
 * about them, as one JSON download. Their own verdicts and case sides come
 * with the original text and names decrypted; for a case only what the
 * person can already see in it (their own side, appeal and display name, and
 * the case verdicts), never another party's text or names. Sign-in tokens,
 * the password hash and the scrambled email kept against free-credit abuse
 * are not included. Server only.
 */

import { NextResponse } from "next/server";
import { API_ERROR_STATUS, apiErrorBody, type ApiErrorCode } from "@/lib/api-errors";
import { ensureAnalyticsTables } from "@/lib/analytics/db";
import { deadBearerResponse, lookupViewer } from "@/lib/bearer-guard";
import { getCase, type CaseRow } from "@/lib/cases/db";
import { getDb } from "@/lib/db";
import { ensureEntitlementTables } from "@/lib/entitlements";
import { ensureFeedbackTables } from "@/lib/feedback/db";
import { aad, openOrNull } from "@/lib/originals/crypto";
import { partyOriginals } from "@/lib/originals/cases";
import { ensureOriginalsTables, getOriginal, getVerdictMeta, subjects } from "@/lib/originals/db";
import { openCaseDisplayName, openVerdictDisplay } from "@/lib/originals/display";
import type { OriginalPayload } from "@/lib/originals-types";
import { hasPassword } from "@/lib/password";
import { POLICY_VERSION } from "@/lib/policy";
import { checkUserLimits } from "@/lib/ratelimit";

const NO_STORE = { "Cache-Control": "no-store" } as const;

function fail(code: ApiErrorCode, error: string, retryAfterSec?: number): NextResponse {
  return NextResponse.json(apiErrorBody(code, error, retryAfterSec ? { retryAfterSec } : {}), {
    status: API_ERROR_STATUS[code],
    headers: retryAfterSec ? { ...NO_STORE, "Retry-After": String(retryAfterSec) } : NO_STORE,
  });
}

type Rows = Record<string, unknown>[];

async function query(sql: string, args: (string | number)[]): Promise<Rows> {
  const db = await getDb();
  return (await db.execute({ sql, args })).rows.map((r) => ({ ...r }));
}

const text = (v: unknown): string | null => (v == null ? null : String(v));
const iso = (ms: unknown): string => new Date(Number(ms)).toISOString();

function json(value: unknown): unknown {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** A sealed original, opened. `stored` carries the text and names as the
 * person wrote them; the other states say why there is none. */
async function original(subject: string) {
  const row = await getOriginal(subject);
  if (!row) return { status: "not_stored" as const, original: null };
  if (!row.sealed) return { status: row.removedAt ? ("removed" as const) : ("not_stored" as const), original: null };
  const payload = openOrNull<OriginalPayload>(row.sealed, aad.original(subject), subject);
  return payload ? { status: "stored" as const, original: payload } : { status: "unreadable" as const, original: null };
}

async function account(userId: string) {
  const [user] = await query(
    `SELECT id, email, name, image, emailVerified, createdAt, age_confirmed_at, age_source, age_blocked_at,
            age_dob, age_dob_at, age_signal
     FROM "user" WHERE id = ?`,
    [userId],
  );
  const methods = await query("SELECT providerId, createdAt FROM account WHERE userId = ? ORDER BY createdAt", [userId]);
  return {
    id: userId,
    email: text(user?.email),
    name: text(user?.name),
    image: text(user?.image),
    emailVerified: Boolean(user?.emailVerified),
    createdAt: text(user?.createdAt),
    ageConfirmedAt: text(user?.age_confirmed_at),
    ageConfirmedBy: text(user?.age_source),
    ageBlockedAt: text(user?.age_blocked_at),
    dateOfBirth: text(user?.age_dob),
    dateOfBirthGivenAt: text(user?.age_dob_at),
    storeAgeSignal: text(user?.age_signal),
    signInMethods: methods.map((m) => ({ provider: String(m.providerId), addedAt: text(m.createdAt) })),
    hasPassword: await hasPassword(userId),
  };
}

async function verdicts(userId: string) {
  const roots = await query(
    `SELECT m.verdict_id, m.kind, m.created_at, m.removed_at, m.removal_reason, m.names_visible, m.training_ok_at,
            m.training_withdrawn_at, m.policy_version, m.lang, v.input, v.result, v.erased_at
     FROM verdict_meta m LEFT JOIN verdicts v ON v.id = m.verdict_id
     WHERE m.owner_user_id = ? AND m.kind IN ('free','premium')
       AND NOT EXISTS (SELECT 1 FROM verdict_appeals a WHERE a.id = m.verdict_id)
     ORDER BY m.created_at, m.verdict_id`,
    [userId],
  );
  const out = [];
  for (const r of roots) {
    const id = String(r.verdict_id);
    const meta = await getVerdictMeta(id);
    const rounds = await query(
      `SELECT a.id, a.text, a.evidence, a.outcome, a.created_at, v.result
       FROM verdict_appeals a LEFT JOIN verdicts v ON v.id = a.id WHERE a.verdict_id = ? ORDER BY a.created_at, a.id`,
      [id],
    );
    out.push({
      id,
      kind: String(r.kind),
      createdAt: String(r.created_at),
      removedAt: text(r.removed_at),
      removalReason: text(r.removal_reason),
      erasedAt: text(r.erased_at),
      lang: text(r.lang),
      namesShownOnSharePage: Number(r.names_visible) === 1,
      shareNames: meta ? openVerdictDisplay(meta) : null,
      original: await original(subjects.verdict(id)),
      anonymizedText: text(r.input),
      result: json(r.result),
      addedContext: rounds.map((a) => ({
        id: String(a.id),
        createdAt: String(a.created_at),
        anonymizedText: String(a.text),
        evidence: json(a.evidence),
        outcome: text(a.outcome),
        result: json(a.result),
      })),
      training: { policyVersion: text(r.policy_version), stampedAt: text(r.training_ok_at), withdrawnAt: text(r.training_withdrawn_at) },
    });
  }
  return out;
}

function partiesOf(row: CaseRow, userId: string, invites: Rows): ("a" | "b" | "c" | "d")[] {
  const out: ("a" | "b" | "c" | "d")[] = [];
  if (row.ownerId === userId) out.push("a");
  if (row.respondentUserId === userId) out.push("b");
  for (const i of invites) if (i.user_id === userId) out.push(String(i.party) as "c" | "d");
  return out;
}

async function cases(userId: string) {
  const ids = await query(
    `SELECT id FROM cases
     WHERE owner_id = ? OR respondent_user_id = ? OR id IN (SELECT case_id FROM case_invites WHERE user_id = ?)
     ORDER BY created_at, id`,
    [userId, userId, userId],
  );
  const out = [];
  for (const { id } of ids) {
    const row = await getCase(String(id));
    if (!row) continue;
    const invites = await query("SELECT party, user_id FROM case_invites WHERE case_id = ?", [row.id]);
    const verdicts = await query(
      `SELECT cv.seq, cv.created_at, cv.mode, cv.appeal_id, v.result
       FROM case_verdicts cv LEFT JOIN verdicts v ON v.id = cv.verdict_id WHERE cv.case_id = ? ORDER BY cv.seq`,
      [row.id],
    );
    for (const party of partiesOf(row, userId, invites)) {
      const [side] = await query("SELECT text, submitted_at FROM case_sides WHERE case_id = ? AND party = ?", [row.id, party]);
      const [appeal] = await query("SELECT text, created_at FROM case_appeals WHERE case_id = ? AND party = ?", [row.id, party]);
      const mine = await partyOriginals(row, party);
      out.push({
        id: row.id,
        yourParty: party,
        status: row.status,
        sides: row.sides,
        lang: row.lang,
        createdAt: row.createdAt,
        judgedAt: row.judgedAt,
        removedAt: { a: row.removedAAt, b: row.removedBAt, c: row.removedCAt, d: row.removedDAt }[party],
        yourDisplayName: openCaseDisplayName(row, party),
        yourOriginal: { side: mine.side, appeal: mine.appeal, names: mine.names },
        yourAnonymizedText: side ? { text: String(side.text), submittedAt: String(side.submitted_at) } : null,
        yourAnonymizedAppeal: appeal ? { text: String(appeal.text), createdAt: String(appeal.created_at) } : null,
        verdicts: verdicts.map((v) => ({
          seq: Number(v.seq),
          createdAt: String(v.created_at),
          mode: String(v.mode),
          fromAppeal: v.appeal_id != null,
          result: json(v.result),
        })),
      });
    }
  }
  return out;
}

async function ratings(userId: string) {
  const rows = await query(
    `SELECT verdict_id, rating, created_at, updated_at, training_ok_at, training_withdrawn_at
     FROM verdict_ratings WHERE user_id = ? ORDER BY created_at, verdict_id`,
    [userId],
  );
  return rows.map((r) => ({
    verdictId: String(r.verdict_id),
    rating: text(r.rating),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    trainingStampedAt: text(r.training_ok_at),
    trainingWithdrawnAt: text(r.training_withdrawn_at),
  }));
}

async function consent(userId: string) {
  const [state] = await query("SELECT choice, asked_at, updated_at, policy_version FROM consent_state WHERE user_id = ?", [userId]);
  const history = await query(
    `SELECT kind, choice, source, at, policy_version, wording_key, wording_text, lang, platform
     FROM consent_ledger WHERE user_id = ? ORDER BY id`,
    [userId],
  );
  return {
    helpImproveJudge: state
      ? { choice: String(state.choice), askedAt: String(state.asked_at), updatedAt: String(state.updated_at), policyVersion: String(state.policy_version) }
      : null,
    history: history.map((h) => ({
      kind: String(h.kind),
      choice: String(h.choice),
      source: String(h.source),
      at: String(h.at),
      policyVersion: String(h.policy_version),
      wordingKey: String(h.wording_key),
      wordingText: String(h.wording_text),
      lang: String(h.lang),
      platform: String(h.platform),
    })),
  };
}

async function usage(userId: string) {
  const devices = await query(
    "SELECT device_id, platform, country, first_seen, last_seen FROM account_devices WHERE user_id = ? ORDER BY first_seen",
    [userId],
  );
  const events = await query(
    `SELECT at, anon_id, device_id, platform, app_version, os_version, device_model, country, locale, name, props
     FROM events WHERE user_id = ? ORDER BY at, id`,
    [userId],
  );
  return {
    devices: devices.map((d) => ({
      deviceId: String(d.device_id),
      platform: String(d.platform),
      country: text(d.country),
      firstSeen: iso(d.first_seen),
      lastSeen: iso(d.last_seen),
    })),
    events: events.map((e) => ({
      at: iso(e.at),
      name: String(e.name),
      platform: String(e.platform),
      appVersion: text(e.app_version),
      osVersion: text(e.os_version),
      deviceModel: text(e.device_model),
      country: text(e.country),
      locale: text(e.locale),
      deviceId: text(e.device_id),
      anonId: text(e.anon_id),
      props: json(e.props),
    })),
  };
}

async function purchases(userId: string) {
  const [balance] = await query("SELECT credits FROM entitlement_accounts WHERE user_id = ?", [userId]);
  const grants = await query(
    `SELECT source, external_id, kind, product_id, credits_delta, subscription_id, ref_external_id, note, created_at
     FROM entitlement_grants WHERE user_id = ? ORDER BY created_at, id`,
    [userId],
  );
  const subscriptions = await query(
    `SELECT source, original_transaction_id, product_id, status, period_start, period_end, will_renew, used_in_period
     FROM subscriptions WHERE user_id = ? ORDER BY period_start`,
    [userId],
  );
  const uses = await query(
    "SELECT funded_by, status, verdict_id, created_at FROM premium_usage WHERE user_id = ? ORDER BY created_at, id",
    [userId],
  );
  return {
    credits: Number(balance?.credits ?? 0),
    grants: grants.map((g) => ({
      source: String(g.source),
      transactionId: String(g.external_id),
      kind: String(g.kind),
      productId: text(g.product_id),
      creditsDelta: Number(g.credits_delta),
      subscriptionId: text(g.subscription_id),
      refundsTransactionId: text(g.ref_external_id),
      note: text(g.note),
      createdAt: String(g.created_at),
    })),
    subscriptions: subscriptions.map((s) => ({
      source: String(s.source),
      originalTransactionId: String(s.original_transaction_id),
      productId: String(s.product_id),
      status: String(s.status),
      periodStart: String(s.period_start),
      periodEnd: String(s.period_end),
      willRenew: Number(s.will_renew) === 1,
      verdictsUsedInPeriod: Number(s.used_in_period),
    })),
    verdictsPaidFor: uses.map((u) => ({
      fundedBy: String(u.funded_by),
      status: String(u.status),
      verdictId: text(u.verdict_id),
      createdAt: String(u.created_at),
    })),
  };
}

export async function buildAccountExport(userId: string, now: Date = new Date()) {
  await ensureOriginalsTables();
  await ensureFeedbackTables();
  await ensureEntitlementTables();
  await ensureAnalyticsTables();
  return {
    exportedAt: now.toISOString(),
    policyVersion: POLICY_VERSION,
    account: await account(userId),
    verdicts: await verdicts(userId),
    cases: await cases(userId),
    ratings: await ratings(userId),
    consent: await consent(userId),
    usage: await usage(userId),
    purchases: await purchases(userId),
  };
}

/** GET /api/v1/me/export -> the JSON file, as an attachment. */
export async function exportGetHandler(req: Request): Promise<NextResponse> {
  try {
    const { viewer, deadBearer, refused } = await lookupViewer(req);
    if (deadBearer) return deadBearerResponse();
    if (refused) return refused;
    if (!viewer) return fail("signin_required", "Sign in first.");
    const limit = await checkUserLimits(viewer.user.id, "data_export").catch(() => null);
    if (!limit || (!limit.ok && limit.code === "unavailable")) return fail("unavailable", "Try again in a minute.");
    if (!limit.ok) return fail("rate_limited", "Too many requests, try again later.", limit.retryAfterSec);
    const now = new Date();
    const data = await buildAccountExport(viewer.user.id, now);
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        ...NO_STORE,
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="judge-data-${now.toISOString().slice(0, 10)}.json"`,
      },
    });
  } catch (e) {
    console.error("[export] failed:", e instanceof Error ? e.message : String(e));
    return fail("unavailable", "Your data could not be put together. Try again in a minute.");
  }
}
