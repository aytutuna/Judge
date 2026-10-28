import { useEffect, useSyncExternalStore } from "react";
import { hasStrings, loadLocale, subscribeLocales, type Lang } from "./i18n";
import { isEnabled, matchLang } from "./langs";

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
 *
 * A language's strings download on first use. Until they arrive the store
 * answers English, so nothing renders half-translated.
 */

const STORAGE_KEY = "verdict-lang";

let current: Lang | null = null;
const listeners = new Set<() => void>();

function readStorage(): Lang | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isEnabled(v) ? v : null;
  } catch {
    return null;
  }
}

function navigatorDefault(): Lang {
  if (typeof navigator === "undefined") return "en";
  return matchLang(navigator.languages?.length ? navigator.languages : [navigator.language]);
}

function wanted(): Lang {
  return current ?? readStorage() ?? navigatorDefault();
}

function applyDocumentLang(l: Lang): void {
  if (typeof document !== "undefined") document.documentElement.lang = l;
}

export function setLang(l: Lang): void {
  current = l;
  void loadLocale(l);
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
  const off = subscribeLocales(onChange);
  void loadLocale(wanted());
  return () => {
    listeners.delete(onChange);
    off();
  };
}

function getSnapshot(): Lang {
  const l = wanted();
  return hasStrings(l) ? l : "en";
}

function getServerSnapshot(): Lang {
  // Known, accepted flash: a tr-browser visitor's first paint is English for
  // one frame before hydration flips it — inherent to the no-cookie design.
  return "en";
}

// Start the download before hydration asks for the language.
if (typeof window !== "undefined") void loadLocale(wanted());

// Language the document was last set to; the server render is always "en".
let applied: Lang = "en";
let reanchored = false;

export function useLang(): Lang {
  const lang = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  useEffect(() => {
    const changed = lang !== applied;
    applied = lang;
    applyDocumentLang(lang);
    // First paint was English; switching to the stored language after
    // hydration (once its strings arrive) shifts content, so re-anchor a deep
    // link such as /#sample. A switch the visitor makes later does not.
    if (!changed || reanchored || current !== null || !location.hash) return;
    reanchored = true;
    const id = decodeURIComponent(location.hash.slice(1));
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "auto" });
    });
  }, [lang]);
  return lang;
}

/** `want` once its strings are here, English until then. For a language
 * chosen on one page only (the share page's own switch), not the store. */
export function useLocaleLang(want: Lang): Lang {
  useEffect(() => {
    void loadLocale(want);
  }, [want]);
  const read = () => (hasStrings(want) ? want : "en");
  return useSyncExternalStore(subscribeLocales, read, read);
}
