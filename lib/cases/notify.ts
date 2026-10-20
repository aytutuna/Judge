/**
 * "The other side answered" email to the case owner, sent once when a
 * two-sided case is judged, and only when email is configured (otherwise the
 * case page shows the status; the app will add push later). Never logs the
 * address or any case text.
 */

import { getAuth } from "@/lib/auth";
import { emailConfigured, sendCaseReadyEmail } from "@/lib/email";
import { entitlementWriteBatch } from "@/lib/entitlements";
import type { CaseRow } from "./db";

export async function notifyOwnerCaseReady(row: CaseRow, origin: string): Promise<void> {
  if (!emailConfigured()) return;
  try {
    const ctx = await (await getAuth()).$context;
    const user = await ctx.internalAdapter.findUserById(row.ownerId);
    if (!user?.email) return;
    // Claim the notice first, so a retried judging run never sends two.
    const [claimed] = await entitlementWriteBatch([
      {
        sql: "UPDATE cases SET owner_notified = 1 WHERE id = ? AND owner_notified = 0",
        args: [row.id],
      },
    ]);
    if (claimed.rowsAffected !== 1) return;
    await sendCaseReadyEmail({ to: user.email, url: `${origin}/c/${row.id}`, lang: row.lang });
  } catch (e) {
    console.error("[cases] owner notice failed:", e instanceof Error ? e.message : String(e));
  }
}
