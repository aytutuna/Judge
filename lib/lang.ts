import { useEffect, useSyncExternalStore } from "react";
import type { Lang } from "./i18n";

/**
 * Client-side language preference: a module-level external store consumed
 * via useSyncExternalStore (the same proven lint-clean shape as the
 * reduced-motion store in components/scene/useReducedMotion.ts — no
 * setState-in-effect anywhere).
 *
 * The source of truth is the in-module `current` variable; localStorage is
 * persistence only. If storage is unavailable (private mode, storage
 * blocked), a store that read only localStorage would notify listeners but
 * return an unchanged snapshot — and the toggle would be dead exactly where
 * the try/catch was added for. Cross-tab sync: non-goal.
 */

const STORAGE_KEY = "verdict-lang";

let current: Lang | null = null;
const listeners = new Set<() => void>();

function readStorage(): Lang | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "en" || v === "tr" ? v : null;
  } catch {
    return null;
  }
}

function navigatorDefault(): Lang {
  return typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("tr")
    ? "tr"
    : "en";
}

function applyDocumentLang(l: Lang): void {
  if (typeof document !== "undefined") document.documentElement.lang = l;
}

export function setLang(l: Lang): void {
  current = l;
  applyDocumentLang(l);
  try {
    localStorage.setItem(STORAGE_KEY, l);
  } catch {
    // Storage unavailable — `current` still drives the UI.
  }
  for (const fn of listeners) fn();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function getSnapshot(): Lang {
  return current ?? readStorage() ?? navigatorDefault();
}

function getServerSnapshot(): Lang {
  // Known, accepted flash: a tr-browser visitor's first paint is English for
  // one frame before hydration flips it — inherent to the no-cookie design.
  return "en";
}

// Language the document was last set to; the server render is always "en".
let applied: Lang = "en";
let hydrated = false;

export function useLang(): Lang {
  const lang = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  useEffect(() => {
    const changed = lang !== applied;
    applied = lang;
    applyDocumentLang(lang);
    // First paint was English; switching to the stored language after
    // hydration shifts content, so re-anchor a deep link such as /#sample.
    const first = !hydrated;
    hydrated = true;
    if (!changed || !first || !location.hash) return;
    const id = decodeURIComponent(location.hash.slice(1));
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "auto" });
    });
  }, [lang]);
  return lang;
}
