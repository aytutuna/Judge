import { useSyncExternalStore } from "react";
import { PALETTE, PALETTE_DARK } from "./palette";

export type Theme = "system" | "light" | "dark";

// The inline script in app/layout.tsx reads the same key before first paint.
export const THEME_KEY = "verdict-theme";

let current: Theme | null = null;
const listeners = new Set<() => void>();

function parse(v: string | null): Theme {
  return v === "light" || v === "dark" ? v : "system";
}

function readStorage(): Theme {
  try {
    return parse(localStorage.getItem(THEME_KEY));
  } catch {
    return "system";
  }
}

export function setTheme(t: Theme): void {
  current = t;
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {
    // Storage unavailable: `current` still drives the page.
  }
  const root = document.documentElement;
  if (t === "system") delete root.dataset.theme;
  else root.dataset.theme = t;
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const dark = t === "system" ? meta.media.includes("dark") : t === "dark";
    meta.content = dark ? PALETTE_DARK.ivory : PALETTE.ivory;
  }
  for (const fn of listeners) fn();
}

export function resolvedDark(t: Theme): boolean {
  return t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

export function getTheme(): Theme {
  return (current ??= readStorage());
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, getTheme, () => "system");
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

function subscribeScheme(onChange: () => void): () => void {
  const mq = window.matchMedia(DARK_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/** The scheme in effect: the stored choice, or the device's while there is none. */
export function useDark(): boolean {
  const theme = useTheme();
  const device = useSyncExternalStore(
    subscribeScheme,
    () => window.matchMedia(DARK_QUERY).matches,
    () => false,
  );
  return theme === "system" ? device : theme === "dark";
}
