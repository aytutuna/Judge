import type { Key } from "./i18n";
import { FINISH_CAPTION, READY, STILL_JUDGING, THINKING_STEPS } from "./thinking";

/**
 * lib/thinking.ts's exported English strings → dictionary keys, so
 * captions/announcements localize by REVERSE LOOKUP while thinking.ts keeps
 * making every timing/announcement decision (its semantics — the story once
 * on cycle 0, STILL_JUDGING on later cycles, READY when done — are preserved
 * by construction). Exported for the completeness test.
 */
export const KEY_BY_CAPTION: Record<string, Key> = {
  [THINKING_STEPS[0].caption]: "thinking.read",
  [THINKING_STEPS[1].caption]: "thinking.label",
  [THINKING_STEPS[2].caption]: "thinking.dig", // steps 3–4 share this caption — same entry, harmless
  [THINKING_STEPS[5].caption]: "thinking.reach",
  [THINKING_STEPS[6].caption]: "thinking.crux",
  [THINKING_STEPS[7].caption]: "thinking.judges",
  [THINKING_STEPS[8].caption]: "thinking.votes",
  [FINISH_CAPTION]: "thinking.finish",
  [STILL_JUDGING]: "thinking.stillJudging",
  [READY]: "thinking.ready",
};
