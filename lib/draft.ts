import type { FrameworkChoice } from "./types";

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

export type Draft = { argument: string; framework: FrameworkChoice };

export const DRAFT_KEY = "verdict-draft";
/** Same cap as the form (components/thread/Composer MAX_ARGUMENT). */
const MAX_DRAFT = 6000;
const DRAFT_TTL_MS = 30 * 60_000;

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
  if (!draft || !draft.argument.trim()) return;
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

function isFramework(v: unknown): v is FrameworkChoice {
  if (typeof v !== "object" || v === null) return false;
  const { preset, sliders } = v as { preset?: unknown; sliders?: unknown };
  if (typeof preset !== "string" || preset.length > 64) return false;
  if (sliders === undefined) return true;
  if (typeof sliders !== "object" || sliders === null || Array.isArray(sliders)) return false;
  return Object.values(sliders).every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 100);
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
  const { argument, framework } = v as { argument?: unknown; framework?: unknown };
  if (typeof argument !== "string" || !argument.trim() || argument.length > MAX_DRAFT) return null;
  if (!isFramework(framework)) return null;
  return {
    argument,
    framework: framework.sliders ? { preset: framework.preset, sliders: framework.sliders } : { preset: framework.preset },
  };
}
