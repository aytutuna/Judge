import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  HERO_BAND,
  NAV_H,
  STORY_BAND,
  heroBandPx,
  mobileSceneBand,
  storyCardTopPx,
} from "../lib/scene-layout";

const read = (...p: string[]) => readFileSync(join(__dirname, "..", ...p), "utf8");
const squash = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, "");

/** The value of the first declaration of `name` in `css`, whitespace removed. */
function decl(css: string, name: string): string {
  const m = squash(css).match(new RegExp(`${name}:([^;]+);`));
  expect(m, `${name} is declared`).not.toBeNull();
  return m![1];
}

describe("scene layout: CSS and camera agree", () => {
  const globals = read("app", "globals.css");
  const story = read("components", "home", "ScrollStory.module.css");

  it("nav height", () => {
    expect(decl(globals, "--nav-h")).toBe(`${NAV_H}px`);
  });

  it("hero scene band", () => {
    expect(decl(globals, "--scene-band")).toBe(
      `clamp(${HERO_BAND.min}px,${HERO_BAND.vw * 100}vw,${HERO_BAND.max}px)`,
    );
  });

  it("story card offset", () => {
    expect(decl(story, "--story-card-top")).toBe(
      `calc(var(--nav-h)+clamp(${STORY_BAND.min}px,calc(var(--unit)*${STORY_BAND.vh}),${STORY_BAND.max}px))`,
    );
  });

  it("the hero's top padding is the nav plus the band", () => {
    const hero = squash(read("components", "home", "Hero.module.css"));
    expect(hero).toContain("padding-top:calc(var(--nav-h)+var(--scene-band));");
  });
});

describe("scene layout maths", () => {
  it("clamps the hero band", () => {
    expect(heroBandPx(320)).toBe(HERO_BAND.min);
    expect(heroBandPx(390)).toBeCloseTo(202.8);
    expect(heroBandPx(600)).toBe(HERO_BAND.max);
  });

  it("puts the story card below the nav, clamped", () => {
    expect(storyCardTopPx(500)).toBe(NAV_H + STORY_BAND.min);
    expect(storyCardTopPx(844)).toBeCloseTo(NAV_H + 371.36);
    expect(storyCardTopPx(1000)).toBe(NAV_H + STORY_BAND.max);
  });

  it("blends hero and story bands, always below the nav", () => {
    const hero = mobileSceneBand(390, 844, 0);
    const story = mobileSceneBand(390, 844, 1);
    expect(hero.top).toBeGreaterThan(NAV_H);
    expect(hero.bottom).toBeLessThan(NAV_H + heroBandPx(390));
    expect(story.bottom).toBeLessThan(storyCardTopPx(844));
    expect(mobileSceneBand(390, 844, 0.5).bottom).toBeCloseTo((hero.bottom + story.bottom) / 2);
  });
});
