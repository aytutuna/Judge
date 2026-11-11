/**
 * The homepage form's unsent argument, kept for the round trip through
 * /signin or /pricing. The home page registers where the draft comes from;
 * sending the form signed out or with nothing left to spend, and the
 * header's "Sign in", save it on click, and the home page takes it back once
 * when it mounts. So an Apple or Google redirect,
 * the Back button, or an email link opened in a new tab brings the visitor
 * back to the text they typed. It sits in localStorage, which every tab of
 * the browser shares, and is only given back within 30 minutes of saving.
 * Nothing is saved on any other path.
 */

export type Draft = {
  argument: string;
  otherSide?: string;
  mineName?: string;
  otherName?: string;
  theirsOpen?: boolean;
  /** Sides C and D, when added. */
  more?: { text: string; name: string }[];
};

export const DRAFT_KEY = "verdict-draft";
/** Same cap as the form (lib/sides MAX_ARGUMENT). */
const MAX_DRAFT = 6000;
/** Same cap as the name inputs. */
const MAX_NAME = 40;
const DRAFT_TTL_MS = 30 * 60_000;

/** Whether the second side shows when the draft comes back: it has text, was
 * left open, or sides C and D were added (they hang under it). */
export function draftTheirsOpen(d: Draft): boolean {
  return Boolean(d.otherSide) || d.theirsOpen === true || (d.more?.length ?? 0) > 0;
}

let source: (() => Draft | null) | null = null;

/** Registers the current form state; returns the unregister function. */
export function registerDraftSource(fn: () => Draft | null): () => void {
  source = fn;
  return () => {
    if (source === fn) source = null;
  };
}

/** Called on the way to /signin. A no-op without a registered form or with
 * nothing typed. */
export function saveDraftForSignIn(): void {
  const draft = source?.();
  if (!draft || (!draft.argument.trim() && !draft.otherSide?.trim())) return;
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, savedAt: Date.now() }));
  } catch {
    // Storage unavailable: the draft is simply not kept.
  }
}

/** The saved draft, removed as it is read. Null when none, malformed or
 * older than 30 minutes. */
export function takeDraft(now: number = Date.now()): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw === null) return null;
    localStorage.removeItem(DRAFT_KEY);
    const savedAt = (JSON.parse(raw) as { savedAt?: unknown } | null)?.savedAt;
    if (typeof savedAt !== "number" || now - savedAt > DRAFT_TTL_MS) return null;
    return parseDraft(raw);
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** Validates a stored draft (it is user-writable storage). */
export function parseDraft(raw: string): Draft | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null) return null;
  const { argument, otherSide, mineName, otherName, theirsOpen, more } = v as Record<string, unknown>;
  if (typeof argument !== "string" || argument.length > MAX_DRAFT) return null;
  if (otherSide !== undefined && (typeof otherSide !== "string" || otherSide.length > MAX_DRAFT)) return null;
  const extra = parseMore(more);
  if (!argument.trim() && !(otherSide as string | undefined)?.trim() && !extra.some((e) => e.text.trim())) return null;
  const draft: Draft = { argument };
  if (otherSide) draft.otherSide = otherSide as string;
  if (typeof mineName === "string" && mineName.length <= MAX_NAME) draft.mineName = mineName;
  if (typeof otherName === "string" && otherName.length <= MAX_NAME) draft.otherName = otherName;
  if (theirsOpen === true) draft.theirsOpen = true;
  if (extra.length) draft.more = extra;
  return draft;
}

/** Sides C and D as stored; a malformed entry ends the list. */
function parseMore(v: unknown): { text: string; name: string }[] {
  if (!Array.isArray(v)) return [];
  const out: { text: string; name: string }[] = [];
  for (const e of v.slice(0, 2)) {
    const { text, name } = (e ?? {}) as Record<string, unknown>;
    if (typeof text !== "string" || text.length > MAX_DRAFT) break;
    out.push({ text, name: typeof name === "string" && name.length <= MAX_NAME ? name : "" });
  }
  return out;
}
