/** A side shorter than this, trimmed, is too little to judge. */
export const MIN_SIDE_LENGTH = 20;

/** The boxes (by index, A first) whose text is too short. */
export function shortBoxes(texts: readonly string[]): number[] {
  const short: number[] = [];
  texts.forEach((text, i) => {
    if (text.trim().length < MIN_SIDE_LENGTH) short.push(i);
  });
  return short;
}

export type FlashStep = { lit: boolean; ms: number };

/** Two pulses, 350 ms lit and 200 ms dark; one steady 900 ms flash for
 * people who ask for less motion. */
export function flashSteps(reducedMotion: boolean): FlashStep[] {
  if (reducedMotion) return [{ lit: true, ms: 900 }, { lit: false, ms: 0 }];
  return [
    { lit: true, ms: 350 },
    { lit: false, ms: 200 },
    { lit: true, ms: 350 },
    { lit: false, ms: 200 },
  ];
}

/** Plays `steps` through `set(lit)`; the returned function stops it early and
 * leaves the lights off. */
export function runFlash(steps: readonly FlashStep[], set: (lit: boolean) => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const play = (i: number) => {
    if (stopped || i >= steps.length) return;
    set(steps[i].lit);
    timer = setTimeout(() => play(i + 1), steps[i].ms);
  };
  play(0);
  return () => {
    stopped = true;
    clearTimeout(timer);
    set(false);
  };
}
