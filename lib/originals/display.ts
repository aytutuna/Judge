/**
 * Display names for share pages and the owner's views, decrypted on the
 * server. Public names come only from the stored display names (never from
 * a raw name map). A display name that cannot be decrypted shows the label;
 * a failed read of the ownership or case row throws (callers answer
 * "unavailable", never the verdict). Server only.
 */

import { cache } from "react";
import { getCase, type CaseRow } from "@/lib/cases/db";
import { getVerdict, type StoredVerdict } from "@/lib/db";
import { EMPTY_DISPLAY, normalizeDisplay, type DisplayNames, type DisplayState } from "@/lib/originals-types";
import { aad, openOrNull } from "./crypto";
import { getVerdictMeta, type VerdictMeta } from "./db";

/** A one-sided verdict's display names as stored (ignores the switch). */
export function openVerdictDisplay(meta: VerdictMeta): DisplayNames {
  const raw = openOrNull(meta.displaySealed, aad.verdictDisplay(meta.verdictId), `verdict:${meta.verdictId}:display`);
  return raw ? normalizeDisplay(raw) : { ...EMPTY_DISPLAY, others: {} };
}

/** One case party's display name, or null. */
export function openCaseDisplayName(row: Pick<CaseRow, "id" | "displayASealed" | "displayBSealed">, party: "a" | "b"): string | null {
  const sealed = party === "a" ? row.displayASealed : row.displayBSealed;
  const raw = openOrNull<{ name?: unknown }>(sealed, aad.caseDisplay(row.id, party), `case:${row.id}:display:${party}`);
  return raw && typeof raw.name === "string" && raw.name.trim() ? raw.name : null;
}

/** The case's display state as its parties see it. */
export function caseDisplayState(row: CaseRow): DisplayState {
  return {
    namesVisible: row.namesVisible,
    a: openCaseDisplayName(row, "a"),
    b: openCaseDisplayName(row, "b"),
    others: {},
  };
}

export type PublicVerdict = {
  stored: StoredVerdict;
  meta: VerdictMeta | null;
  /** Null: show the labels (no meta, names off, nothing stored, or unreadable). */
  display: DisplayNames | null;
  removed: boolean;
};

function hasAny(d: DisplayNames): boolean {
  return Boolean(d.a || d.b || Object.keys(d.others).length > 0);
}

async function loadPublicVerdict(id: string): Promise<PublicVerdict | null> {
  const stored = await getVerdict(id);
  if (!stored) return null;
  let meta: VerdictMeta | null = null;
  try {
    meta = await getVerdictMeta(id);
  } catch (e) {
    // Fails closed: without the ownership row nothing says whether the
    // verdict was removed, so callers answer "unavailable" rather than
    // render it. Only a database without the originals tables yet reads
    // as "no meta" (labels, not removed), like removed.ts.
    const message = e instanceof Error ? e.message : String(e);
    if (!/no such (table|column)/i.test(message)) throw e;
  }
  if (!meta) return { stored, meta: null, display: null, removed: false };
  if (meta.kind === "case" && meta.caseId) {
    const row = await getCase(meta.caseId);
    const removed = Boolean(meta.removedAt || row?.removedAt);
    if (!row || removed || !row.namesVisible) return { stored, meta, display: null, removed };
    const display = { a: openCaseDisplayName(row, "a"), b: openCaseDisplayName(row, "b"), others: {} };
    return { stored, meta, display: hasAny(display) ? display : null, removed: false };
  }
  if (meta.removedAt) return { stored, meta, display: null, removed: true };
  if (!meta.namesVisible || !meta.displaySealed) return { stored, meta, display: null, removed: false };
  const display = openVerdictDisplay(meta);
  return { stored, meta, display: hasAny(display) ? display : null, removed: false };
}

/** One read per request (shared by metadata and the page). */
export const getPublicVerdict = cache(loadPublicVerdict);
