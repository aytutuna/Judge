import type { FrameworkChoice } from "./types";

/**
 * The homepage form's unsent argument, kept for the round trip through
 * /signin. The home page registers where the draft comes from; the sign-in
 * links (the Premium nudge and the header's "Sign in") save it to
 * sessionStorage on click, and the home page takes it back once when it
 * mounts. So an Apple or Google redirect, or the Back button, brings the
 * visitor back to the text they typed. Nothing is saved on any other path,
 * so the free flow is otherwise unchanged. sessionStorage is per tab and
 * cleared with it.
 */

export type Draft = { argument: string; framework: FrameworkChoice };

export const DRAFT_KEY = "verdict-draft";
/** Same cap as the form (components/thread/Composer MAX_ARGUMENT). */
const MAX_DRAFT = 6000;

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
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Storage unavailable: the draft is simply not kept.
  }
}

/** The saved draft, removed as it is read. Null when none or malformed. */
export function takeDraft(): Draft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (raw === null) return null;
    sessionStorage.removeItem(DRAFT_KEY);
    return parseDraft(raw);
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
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
