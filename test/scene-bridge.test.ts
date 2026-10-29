import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getSceneMode,
  getSceneStatus,
  getSceneTheme,
  getSceneYou,
  getStoryStep,
  nudgeScene,
  resetScene,
  sceneInput,
  setPointer,
  setSceneMode,
  setSceneStatus,
  setSceneTheme,
  setSceneYou,
  setStoryProgress,
  storyStepOf,
  subscribeScene,
  subscribeSceneInput,
  subscribeSceneStatus,
  subscribeStoryStep,
} from "../lib/scene-bridge";

afterEach(() => {
  resetScene();
  sceneInput.px = 0;
  sceneInput.py = 0;
  setStoryProgress(-3);
  setSceneStatus("loading");
  vi.restoreAllMocks();
});

describe("viewer side", () => {
  afterEach(() => setSceneYou(null));

  it("starts with nobody known, so Party A is drawn as the viewer's", () => {
    expect(getSceneYou()).toBeNull();
  });

  it("tells mode subscribers when the viewer is the other side, once per change", () => {
    const fn = vi.fn();
    const off = subscribeScene(fn);
    setSceneYou("b");
    setSceneYou("b");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(getSceneYou()).toBe("b");
    off();
  });

  it("survives a scene reset: whoever shows the scene owns it", () => {
    setSceneYou("b");
    setSceneMode({ kind: "judging", beat: "lift" });
    resetScene();
    expect(getSceneYou()).toBe("b");
  });
});

describe("theme", () => {
  afterEach(() => setSceneTheme("light"));

  it("starts light and tells mode subscribers once per change", () => {
    expect(getSceneTheme()).toBe("light");
    const fn = vi.fn();
    const off = subscribeScene(fn);
    setSceneTheme("dark");
    setSceneTheme("dark");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(getSceneTheme()).toBe("dark");
    resetScene();
    expect(getSceneTheme()).toBe("dark");
    off();
  });
});

describe("scene mode", () => {
  it("notifies subscribers on change and stops after unsubscribe", () => {
    const fn = vi.fn();
    const off = subscribeScene(fn);
    setSceneMode({ kind: "judging", beat: "lift" });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(getSceneMode()).toEqual({ kind: "judging", beat: "lift" });
    off();
    setSceneMode({ kind: "judging", beat: "sort" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("ignores a mode equal to the current one", () => {
    const fn = vi.fn();
    const off = subscribeScene(fn);
    setSceneMode({ kind: "verdict", verdict: { tugA: 80, votes: ["a", "a"] } });
    setSceneMode({ kind: "verdict", verdict: { tugA: 80, votes: ["a", "a"] } });
    expect(fn).toHaveBeenCalledTimes(1);
    setSceneMode({ kind: "verdict", verdict: { tugA: 80, votes: ["a", "b"] } });
    expect(fn).toHaveBeenCalledTimes(2);
    off();
  });

  it("resetScene returns to idle with no pending motion", () => {
    setSceneMode({ kind: "judging", beat: "dig" });
    nudgeScene("example", 1);
    resetScene();
    expect(getSceneMode()).toEqual({ kind: "idle" });
    expect(sceneInput.impulse).toBe(0);
    expect(sceneInput.energy).toBe(0);
  });
});

describe("scene status", () => {
  it("notifies once per change", () => {
    const fn = vi.fn();
    const off = subscribeSceneStatus(fn);
    setSceneStatus("ready");
    setSceneStatus("ready");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(getSceneStatus()).toBe("ready");
    off();
  });
});

describe("nudgeScene", () => {
  it("typing gives a random ±0.35..0.7 kick and +0.25 energy", () => {
    vi.spyOn(Math, "random").mockReturnValueOnce(0.2).mockReturnValueOnce(0);
    nudgeScene("type");
    expect(sceneInput.impulse).toBeCloseTo(-0.35, 12);
    expect(sceneInput.energy).toBeCloseTo(0.25, 12);
    vi.spyOn(Math, "random").mockReturnValueOnce(0.9).mockReturnValueOnce(0.9999);
    sceneInput.impulse = 0;
    nudgeScene("type");
    expect(sceneInput.impulse).toBeCloseTo(0.7, 3);
  });

  it("an example chip gives sign * 2.2 and full energy", () => {
    nudgeScene("example", -1);
    expect(sceneInput.impulse).toBeCloseTo(-2.2, 12);
    expect(sceneInput.energy).toBe(1);
    nudgeScene("example", 1);
    expect(sceneInput.impulse).toBeCloseTo(0, 12);
  });

  it("clamps energy at 1", () => {
    for (let i = 0; i < 10; i++) nudgeScene("type");
    expect(sceneInput.energy).toBe(1);
  });

  it("records the input time", () => {
    sceneInput.lastInputAt = 0;
    nudgeScene("type");
    expect(sceneInput.lastInputAt).toBeGreaterThan(0);
  });
});

describe("pointer and story progress", () => {
  it("clamps the pointer to -1..1", () => {
    setPointer(3, -2);
    expect(sceneInput.px).toBe(1);
    expect(sceneInput.py).toBe(-1);
  });

  it("snaps the story step", () => {
    expect(storyStepOf(-3)).toBe(-1);
    expect(storyStepOf(-0.4)).toBe(0);
    expect(storyStepOf(2.49)).toBe(2);
    expect(storyStepOf(2.5)).toBe(3);
    expect(storyStepOf(12)).toBe(4);
  });

  it("notifies step subscribers only when the step changes", () => {
    const fn = vi.fn();
    const off = subscribeStoryStep(fn);
    setStoryProgress(0.1);
    setStoryProgress(0.3);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sceneInput.q).toBe(0.3);
    setStoryProgress(1.2);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(getStoryStep()).toBe(1);
    off();
  });
});

describe("input wake-up", () => {
  it("fires on typing, examples, pointer moves and story scroll, not on repeated q", () => {
    const fn = vi.fn();
    const off = subscribeSceneInput(fn);
    nudgeScene("type");
    nudgeScene("example", 1);
    setPointer(0.2, -0.4);
    expect(fn).toHaveBeenCalledTimes(3);
    setStoryProgress(0.4);
    expect(fn).toHaveBeenCalledTimes(4);
    setStoryProgress(0.4);
    expect(fn).toHaveBeenCalledTimes(4);
    off();
    nudgeScene("type");
    expect(fn).toHaveBeenCalledTimes(4);
  });
});
