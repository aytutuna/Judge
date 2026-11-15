/**
 * When the training consent card is shown. The server decides: the card
 * comes once, on a person's own verdict page, after their second finished
 * verdict (a one-sided verdict of theirs, or a case verdict of a case they
 * are a party to; a round of added context is not another verdict). Server only.
 */

import { getDb } from "@/lib/db";
import { ensureOriginalsTables } from "@/lib/originals/db";
import { getConsent, type ConsentView } from "./db";

export const VERDICTS_BEFORE_ASK = 2;

export async function finishedVerdictCount(userId: string): Promise<number> {
  await ensureOriginalsTables();
  const db = await getDb();
  const rs = await db.execute({
    sql: `SELECT
            (SELECT COUNT(*) FROM verdict_meta m JOIN verdicts v ON v.id = m.verdict_id
             WHERE m.owner_user_id = ? AND m.kind IN ('free','premium')
               AND NOT EXISTS (SELECT 1 FROM verdict_appeals a WHERE a.id = m.verdict_id))
            + (SELECT COUNT(DISTINCT cv.case_id) FROM case_verdicts cv JOIN cases c ON c.id = cv.case_id
               WHERE c.owner_id = ? OR c.respondent_user_id = ?
                  OR cv.case_id IN (SELECT case_id FROM case_invites WHERE user_id = ?)) AS n`,
    args: [userId, userId, userId, userId],
  });
  return Number(rs.rows[0].n);
}

export type ConsentStatus = ConsentView & { ask: boolean };

/** The current choice, and whether the card should be shown now. */
export async function consentStatus(userId: string): Promise<ConsentStatus> {
  const view = await getConsent(userId);
  const ask = view.state === "not_asked" && (await finishedVerdictCount(userId)) >= VERDICTS_BEFORE_ASK;
  return { ...view, ask };
}
