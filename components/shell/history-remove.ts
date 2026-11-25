import { apiFetch } from "@/lib/api-fetch";
import { apiErrorMessage, type Lang } from "@/lib/i18n";
import { forgetCaseNames } from "@/lib/case-names-store";
import { forgetOwnerToken, loadOwnerToken, ownerHeaders } from "@/lib/owner-store";
import { linkStoredClaim } from "@/lib/respondent-store";
import { dropAnswered } from "@/lib/history-store";
import { markCaseRemoved, markVerdictRemoved, refreshHistory, type HistoryItem } from "./useHistory";

const JSON_HEADERS = { "Content-Type": "application/json" };
const body = () => JSON.stringify({ confirm: "remove" });

/** The invite token of a case the viewer answered, from the row's link. */
function inviteToken(item: HistoryItem): string | null {
  return item.href?.startsWith("/r/") ? item.href.slice(3) : null;
}

type Outcome = "done" | "failed" | { limited: unknown };

/** The same removal calls the verdict and case pages make. False when it
 * failed and is worth another try; a row that is already gone counts as done
 * and the list catches up. */
export async function removeItem(item: HistoryItem): Promise<boolean> {
  return (await attempt(item)) === "done";
}

async function attempt(item: HistoryItem): Promise<Outcome> {
  const id = encodeURIComponent(item.id);
  let path: string;
  let init: RequestInit;
  if (item.kind === "verdict") {
    path = `/api/v1/verdicts/${id}/removal`;
    init = { method: "POST", headers: { ...JSON_HEADERS, ...ownerHeaders(loadOwnerToken(item.id)) }, body: body() };
  } else if (item.role === "respondent") {
    const token = inviteToken(item);
    if (!token) return "failed";
    // An answer given signed out joins the account first; one that belongs to another account is not this person's to remove.
    if ((await linkStoredClaim(item.id)) === "refused") {
      dropAnswered(item.id);
      return "done";
    }
    path = `/api/v1/respond/${token}/removal`;
    init = { method: "POST", headers: JSON_HEADERS, body: body() };
  } else {
    path = `/api/v1/cases/${id}/removal`;
    init = { method: "POST", headers: JSON_HEADERS, body: body() };
  }
  try {
    const res = await apiFetch(path, init);
    if (res.status === 404 || res.status === 410) {
      void refreshHistory();
      return "done";
    }
    if (res.status === 429) return { limited: await res.json().catch(() => null) };
    if (!res.ok) return "failed";
  } catch {
    return "failed";
  }
  if (item.kind === "verdict") {
    forgetOwnerToken(item.id);
    markVerdictRemoved(item.id);
  } else {
    forgetCaseNames(item.id);
    markCaseRemoved(item.id);
  }
  return "done";
}

/** Removes `items` one after the other; how many failed, and the rate-limit
 * message when the server said to slow down, which ends the run since every
 * further call would be refused too. */
export async function removeItems(items: readonly HistoryItem[], lang: Lang): Promise<{ failed: number; limited: string | null }> {
  let failed = 0;
  for (let i = 0; i < items.length; i++) {
    const out = await attempt(items[i]);
    if (out === "failed") failed++;
    else if (out !== "done") return { failed: failed + items.length - i, limited: apiErrorMessage(lang, out.limited, 429) };
  }
  return { failed, limited: null };
}
