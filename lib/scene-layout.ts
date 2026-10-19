/**
 * Narrow-screen (< 960px) layout numbers that the 3D framing shares with the
 * CSS. On mobile the sticky stage is a full-height layer behind the page,
 * but the balance is framed into a band between the fixed nav and the text
 * below it, so the hero copy and the form start on the first screen.
 *
 * Mirrored in CSS (test/scene-layout.test.ts checks the formulas match):
 * - NAV_H                  : --nav-h in app/globals.css
 * - heroBandPx(W)          : --scene-band in app/globals.css (the hero's top padding is nav + band)
 * - storyCardTopPx(H)      : --story-card-top in components/home/ScrollStory.module.css
 *
 * Pure TS, no three: imported by the engine chunk and by the hero alike.
 */

/** Height of the fixed nav, CSS px. */
export const NAV_H = 56;

/** Hero scene band on mobile: clamp(176px, 52vw, 240px). */
export const HERO_BAND = { min: 176, vw: 0.52, max: 240 } as const;

/** Story card offset inside each step on mobile, below the nav:
 * clamp(250px, 44svh, 380px). */
export const STORY_BAND = { min: 250, vh: 0.44, max: 380 } as const;

/** While judging on mobile, the hero scrolls the card's top to this fraction
 * of the viewport height; the balance gets the band above it. */
export const JUDGING_CARD_TOP = 0.45;

/** Clear space (px) between the balance's base and the text below it: more
 * than the overlap fade's FADE_CLEAR_PX, so the resting balance is never
 * dimmed. */
export const BAND_GAP = 18;

const clamp = (min: number, v: number, max: number) => Math.min(max, Math.max(min, v));

/** Height of the hero scene band (between the nav and the hero text) for a
 * viewport `width` px wide. */
export function heroBandPx(width: number): number {
  return clamp(HERO_BAND.min, width * HERO_BAND.vw, HERO_BAND.max);
}

/** Viewport y (px) of a story card's top while its step is active, for a
 * viewport `height` px tall (100svh). */
export function storyCardTopPx(height: number): number {
  return NAV_H + clamp(STORY_BAND.min, height * STORY_BAND.vh, STORY_BAND.max);
}

/** The band (viewport px) the balance is framed into on mobile. `engaged`
 * 0..1 blends the hero band toward the judging band, `story` 0..1 blends
 * toward the story band. The balance's base sits on `bottom`. */
export function mobileSceneBand(
  width: number,
  height: number,
  engaged: number,
  story: number,
): { top: number; bottom: number } {
  const top = NAV_H + 10;
  const hero = NAV_H + heroBandPx(width) - BAND_GAP;
  const judging = height * JUDGING_CARD_TOP - BAND_GAP;
  const heroBottom = hero + (Math.max(hero, judging) - hero) * engaged;
  const storyBottom = storyCardTopPx(height) - BAND_GAP;
  return { top, bottom: heroBottom + (storyBottom - heroBottom) * story };
}
