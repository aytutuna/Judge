import type { Lang } from "./langs";

/** One "Try an example": a made-up argument, a on one side and b on the other. */
export type Example = { title: string; aName: string; a: string; bName: string; b: string };

/** Id to example in the order of lib/examples/en.json. Each language is its own chunk, loaded when needed. */
export async function loadExamples(lang: Lang): Promise<Record<string, Example>> {
  return (await import(`./examples/${lang}.json`)).default;
}
