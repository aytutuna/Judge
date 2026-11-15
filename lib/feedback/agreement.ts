/**
 * The one-time agreement before a person's first verdict or case side: their
 * text may hold private details, and Judge sends it (names taken out) to an
 * outside AI service. It is a 'sensitive' row in the consent ledger. Every
 * route that starts a verdict, a case, a case side or an answer refuses with
 * 403 `agreement_required` until the account has one; a signed-out
 * respondent ticks it with their answer, and it is stored with that side
 * (lib/cases/service). Server only.
 */

import { NextResponse } from "next/server";
import { API_ERROR_STATUS, apiErrorBody } from "@/lib/api-errors";
import { getDb } from "@/lib/db";
import { entitlementWriteBatch } from "@/lib/entitlements";
import { loadLocale, t, type Key } from "@/lib/i18n";
import type { Lang } from "@/lib/langs";
import { POLICY_VERSION, SENSITIVE_AGREEMENT_EN } from "@/lib/policy";
import { ensureFeedbackTables, type ConsentPlatform } from "./db";

export const SENSITIVE_WORDING_KEY = "consent.sensitiveBody";

/** The agreement as shown in `lang`; English until a locale has the key. */
export async function sensitiveText(lang: Lang): Promise<string> {
  await loadLocale(lang);
  return (t as (l: Lang, k: Key) => string | undefined)(lang, SENSITIVE_WORDING_KEY as Key) ?? SENSITIVE_AGREEMENT_EN;
}

export async function sensitiveAgreedAt(userId: string): Promise<string | null> {
  await ensureFeedbackTables();
  const db = await getDb();
  const rs = await db.execute({
    sql: "SELECT at FROM consent_ledger WHERE user_id = ? AND kind = 'sensitive' ORDER BY id LIMIT 1",
    args: [userId],
  });
  return rs.rows[0] ? String(rs.rows[0].at) : null;
}

/** Records the agreement once per account; a second call changes nothing and
 * returns the first time. */
export async function recordSensitiveAgreement(
  userId: string,
  lang: Lang,
  platform: ConsentPlatform,
  now: Date = new Date(),
): Promise<string> {
  const text = await sensitiveText(lang);
  await ensureFeedbackTables();
  const nowIso = now.toISOString();
  await entitlementWriteBatch([
    {
      sql: `INSERT INTO consent_ledger (user_id, kind, choice, source, at, policy_version, wording_key, wording_text, lang, platform)
            SELECT ?, 'sensitive', 'on', 'card', ?, ?, ?, ?, ?, ?
            WHERE NOT EXISTS (SELECT 1 FROM consent_ledger WHERE user_id = ? AND kind = 'sensitive')`,
      args: [userId, nowIso, POLICY_VERSION, SENSITIVE_WORDING_KEY, text, lang, platform, userId],
    },
  ]);
  return (await sensitiveAgreedAt(userId)) ?? nowIso;
}

/** 403 agreement_required. */
export function agreementMissing(): NextResponse {
  return NextResponse.json(
    apiErrorBody("agreement_required", "Agree to the private-details notice before your first verdict."),
    { status: API_ERROR_STATUS.agreement_required, headers: { "Cache-Control": "no-store" } },
  );
}

/** The response that stops a request from starting a verdict, case, side or
 * answer for an account that has not agreed, else null. A failed lookup is a
 * 503, not a pass. */
export async function agreementRefusal(userId: string): Promise<NextResponse | null> {
  try {
    return (await sensitiveAgreedAt(userId)) ? null : agreementMissing();
  } catch (e) {
    console.error("[agreement] lookup failed:", e instanceof Error ? e.message : String(e));
    return NextResponse.json(apiErrorBody("unavailable", "Try again in a minute."), {
      status: API_ERROR_STATUS.unavailable,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
