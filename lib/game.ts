import { useSyncExternalStore } from "react";

// The inline script in app/layout.tsx reads the same key before first paint.
export const GAME_KEY = "verdict-game";

let current: boolean | null = null;
const listeners = new Set<() => void>();

function readStorage(): boolean {
  try {
    return localStorage.getItem(GAME_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setGame(on: boolean): void {
  current = on;
  try {
    localStorage.setItem(GAME_KEY, on ? "on" : "off");
  } catch {
    // Storage unavailable: `current` still drives the page.
  }
  const root = document.documentElement;
  if (on) delete root.dataset.game;
  else root.dataset.game = "off";
  for (const fn of listeners) fn();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

export function getGame(): boolean {
  return (current ??= readStorage());
}

/** Whether the court art is on (the default). */
export function useGame(): boolean {
  return useSyncExternalStore(subscribe, getGame, () => true);
}
