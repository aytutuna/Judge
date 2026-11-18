import { apiFetch } from "@/lib/api-fetch";
import { forgetCaseNames } from "@/lib/case-names-store";
import { forgetOwnerToken, loadOwnerToken, ownerHeaders } from "@/lib/owner-store";
import { loadClaim } from "@/lib/respondent-store";
import { markCaseRemoved, markVerdictRemoved, refreshHistory, type HistoryItem } from "./useHistory";

const JSON_HEADERS = { "Content-Type": "application/json" };
const body = (extra: object = {}) => JSON.stringify({ confirm: "remove", ...extra });

/** The invite token of a case the viewer answered, from the row's link. */
function inviteToken(item: HistoryItem): string | null {
  return item.href?.startsWith("/r/") ? item.href.slice(3) : null;
}

/** The same removal calls the verdict and case pages make. False when it
 * failed and is worth another try; a row that is already gone counts as done
 * and the list catches up. */
export async function removeItem(item: HistoryItem): Promise<boolean> {
  const id = encodeURIComponent(item.id);
  let path: string;
  let init: RequestInit;
  if (item.kind === "verdict") {
    path = `/api/v1/verdicts/${id}/removal`;
    init = { method: "POST", headers: { ...JSON_HEADERS, ...ownerHeaders(loadOwnerToken(item.id)) }, body: body() };
  } else if (item.role === "respondent") {
    const token = inviteToken(item);
    if (!token) return false;
    const claim = loadClaim(item.id);
    path = `/api/v1/respond/${token}/removal`;
    init = {
      method: "POST",
      headers: { ...JSON_HEADERS, ...(claim ? { "Respondent-Claim": claim } : {}) },
      body: body(claim ? { claim } : {}),
    };
  } else {
    path = `/api/v1/cases/${id}/removal`;
    init = { method: "POST", headers: JSON_HEADERS, body: body() };
  }
  try {
    const res = await apiFetch(path, init);
    if (res.status === 404 || res.status === 410) {
      void refreshHistory();
      return true;
    }
    if (!res.ok) return false;
  } catch {
    return false;
  }
  if (item.kind === "verdict") {
    forgetOwnerToken(item.id);
    markVerdictRemoved(item.id);
  } else {
    forgetCaseNames(item.id);
    markCaseRemoved(item.id);
  }
  return true;
}

/** Removes `items` one after the other; how many failed. */
export async function removeItems(items: readonly HistoryItem[]): Promise<number> {
  let failed = 0;
  for (const item of items) if (!(await removeItem(item))) failed++;
  return failed;
}
