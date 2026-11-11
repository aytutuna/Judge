import type { PartyLetter } from "./case-types";

/**
 * The names the owner typed for the other sides when they sent the link, kept
 * in this browser only. They label the rows on the case page; the server
 * never sees them.
 */

export type SideNames = Partial<Record<Exclude<PartyLetter, "a">, string>>;

const key = (caseId: string) => `settle.sidenames.${caseId}`;

export function saveSideNames(caseId: string, names: SideNames): void {
  const kept = Object.fromEntries(Object.entries(names).filter(([, v]) => v && v.trim()));
  if (Object.keys(kept).length === 0) return;
  try {
    localStorage.setItem(key(caseId), JSON.stringify(kept));
  } catch {
    // Storage unavailable: the rows just show the avatar.
  }
}

export function loadSideNames(caseId: string): SideNames {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(key(caseId)) ?? "null");
    return v && typeof v === "object" ? (v as SideNames) : {};
  } catch {
    return {};
  }
}

export function forgetSideNames(caseId: string): void {
  try {
    localStorage.removeItem(key(caseId));
  } catch {
    // Nothing to remove.
  }
}
