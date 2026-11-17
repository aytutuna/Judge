import { getDb } from "../lib/db";
import { LEDGER_GUARDS } from "../lib/feedback/db";

/** Gives the ledger rows unlinked in the last minute an older unlink time. The
 * table's trigger refuses that, so its guards are lifted for one batch. */
export async function backdateUnlinked(iso: string): Promise<void> {
  const db = await getDb();
  const since = new Date(Date.now() - 60_000).toISOString();
  await db.batch(
    [
      "DROP TRIGGER IF EXISTS consent_ledger_guard_update",
      { sql: "UPDATE consent_ledger SET unlinked_at = ? WHERE unlinked_at >= ?", args: [iso, since] },
      ...LEDGER_GUARDS,
    ],
    "write",
  );
}
