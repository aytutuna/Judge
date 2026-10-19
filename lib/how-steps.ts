import type { Key } from "./i18n";

/**
 * The five judging steps, in order. Shared by the homepage story and the
 * About page's method list, so both always tell the same five-step story.
 * Pure data, no React.
 */
export const HOW_STEPS = [
  { title: "how.step1.title", body: "how.step1.body" },
  { title: "how.step2.title", body: "how.step2.body" },
  { title: "how.step3.title", body: "how.step3.body" },
  { title: "how.step4.title", body: "how.step4.body" },
  { title: "how.step5.title", body: "how.step5.body" },
] as const satisfies readonly { title: Key; body: Key }[];

/** "01", "02", ... for step numerals. */
export function stepNumeral(index: number): string {
  return String(index + 1).padStart(2, "0");
}
