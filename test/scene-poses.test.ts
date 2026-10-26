import { describe, expect, it } from "vitest";
import { tiltFromTug } from "../lib/balance";
import {
  BEAM_LEN,
  MAX_PULSE,
  ORB_POSE_THETA,
  POSE_KEYS,
  POSE_RATES,
  SPHERE_R,
  STORY_VERDICT,
  beamPoint,
  easePose,
  heroTargets,
  lerp,
  orbRadius,
  orbSlots,
  orbitPoint,
  snapStoryQ,
  sphereCentre,
  sphereScale,
  ss,
  storyPose,
  storyWeights,
  verdictWinner,
  voteAt,
  zeroPose,
} from "../lib/scene-poses";

const live = (orbs: number, votes: number) => ({ ...zeroPose(), orbs, votes });

const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe("ss (smoothstep)", () => {
  it("clamps and eases", () => {
    expect(ss(0, 1, -1)).toBe(0);
    expect(ss(0, 1, 2)).toBe(1);
    expect(ss(0, 1, 0.5)).toBeCloseTo(0.5, 12);
  });
});

describe("storyWeights", () => {
  it("is all zeros deep in the hero (q = -3)", () => {
    for (const [k, v] of Object.entries(storyWeights(-3))) expect(v, k).toBe(0);
  });

  it("has the orbs up and the crux collapsed at q = 3", () => {
    const w = storyWeights(3);
    expect(w.collapse).toBeCloseTo(1, 6);
    expect(w.orbs).toBeGreaterThan(0.9);
    expect(w.camDown).toBe(0);
  });

  it("has fully tipped at q = 4", () => {
    const w = storyWeights(4);
    expect(w.tip).toBeCloseTo(1, 6);
    expect(w.votes).toBe(1);
  });

  it("shows each step's beat at its own integer q", () => {
    expect(storyWeights(0)).toMatchObject({ lift: 1, split: 0 });
    expect(storyWeights(1)).toMatchObject({ split: 1, sink: 0 });
    const w2 = storyWeights(2);
    expect(w2.sink).toBe(1);
    expect(w2.meet).toBeGreaterThan(0.95);
    expect(w2.camDown).toBe(1);
    expect(w2.collapse).toBe(0);
  });

  it("staggers the votes between q = 3.0 and 3.35", () => {
    const at = (q: number) => [0, 1, 2].map((i) => voteAt(i, 3, storyWeights(q).votes));
    expect(at(3.0)).toEqual([0, 0, 0]);
    const mid = at(3.17);
    expect(mid[0]).toBeGreaterThan(mid[1]);
    expect(mid[1]).toBeGreaterThan(mid[2]);
    expect(at(3.35)).toEqual([1, 1, 1]);
  });
});

describe("storyPose", () => {
  it("ends on the sample verdict's tilt", () => {
    expect(storyPose(4).tilt).toBeCloseTo(tiltFromTug(20), 12);
    expect(STORY_VERDICT.tugA).toBe(20);
  });

  it("is level before step 5", () => {
    expect(storyPose(3.4).tilt).toBeCloseTo(0, 12);
  });

  it("lifts the spheres until they re-form", () => {
    expect(storyPose(0).lift).toBe(1);
    expect(storyPose(3.2).lift).toBe(0);
  });
});

describe("snapStoryQ (reduced motion)", () => {
  it("snaps to whole steps, with step 4 after its votes", () => {
    expect(snapStoryQ(-2)).toBe(-3);
    expect(snapStoryQ(-0.2)).toBe(0);
    expect(snapStoryQ(1.4)).toBe(1);
    expect(snapStoryQ(2.6)).toBe(3.4);
    expect(snapStoryQ(9)).toBe(4);
    expect(voteAt(2, 3, storyWeights(snapStoryQ(3)).votes)).toBe(1);
  });
});

describe("orbSlots clearance", () => {
  const thetas = Array.from({ length: 23 }, (_, i) => -ORB_POSE_THETA + (i * 2 * ORB_POSE_THETA) / 22);
  const lifts = [0, 0.25, 0.5, 0.75, 1];

  for (let n = 1; n <= 7; n++) {
    it(`keeps >= 0.25 clear of the spheres and beam ends with ${n} orbs`, () => {
      const slots = orbSlots(n);
      const r = orbRadius(n);
      let worst = Infinity;
      for (const theta of thetas) {
        for (const lift of lifts) {
          const sphereR = SPHERE_R * sphereScale(lift, MAX_PULSE);
          for (const side of [-1, 1] as const) {
            const c = sphereCentre(side, theta, lift, 0.05 * lift);
            const tip = beamPoint(theta, (side * BEAM_LEN) / 2, 0.06);
            for (const s of slots) {
              worst = Math.min(worst, dist(s, c) - sphereR - r);
              worst = Math.min(worst, dist(s, { x: tip.x, y: tip.y, z: 0 }) - r - 0.13);
            }
          }
        }
      }
      expect(worst).toBeGreaterThanOrEqual(0.25);
    });
  }

  it("never overlaps neighbouring orbs", () => {
    for (let n = 2; n <= 7; n++) {
      const s = orbSlots(n);
      for (let i = 1; i < n; i++) expect(dist(s[i], s[i - 1])).toBeGreaterThan(2 * orbRadius(n));
    }
  });

  it("stays within x ±1.05, behind the pivot, centre highest", () => {
    for (let n = 1; n <= 7; n++) {
      for (const s of orbSlots(n)) {
        expect(Math.abs(s.x)).toBeLessThanOrEqual(1.05);
        expect(s.z).toBeLessThan(0);
      }
    }
    const three = orbSlots(3);
    expect(three[1].y).toBeGreaterThan(three[0].y);
    expect(three[0].y).toBeCloseTo(three[2].y, 12);
  });
});

describe("orbitPoint (deliberation)", () => {
  const at = (i: number, n: number, t: number) => orbitPoint(i, n, t, { x: 0, y: 0, z: 0 });
  const times = Array.from({ length: 64 }, (_, i) => i * 0.25);
  // Outer edge of the ring outline in judges.ts (torus 1.14 + 0.07).
  const ring = 1.21;

  it("stays clear of the spheres and below the top of the resting arc", () => {
    const top = orbSlots(1)[0].y;
    for (let n = 1; n <= 7; n++) {
      const r = orbRadius(n);
      for (const t of times) {
        for (let i = 0; i < n; i++) {
          const p = at(i, n, t);
          expect(p.y).toBeLessThanOrEqual(top);
          expect(p.z).toBeLessThan(0);
          for (const side of [-1, 1] as const) {
            const c = sphereCentre(side, 0.13, 0, 0);
            expect(dist(p, c) - SPHERE_R * MAX_PULSE - r).toBeGreaterThan(0.25);
          }
        }
      }
    }
  });

  it("never lets two orbs' ink rings overlap on screen", () => {
    for (let n = 2; n <= 7; n++) {
      for (const t of times) {
        for (let i = 0; i < n; i++) {
          for (let j = i + 1; j < n; j++) {
            const a = at(i, n, t);
            const b = at(j, n, t);
            expect(Math.hypot(a.x - b.x, a.y - b.y), `${n} orbs at ${t}s`).toBeGreaterThan(2 * ring * orbRadius(n));
          }
        }
      }
    }
  });

  it("eases the orbs from the arc onto the ring without their ink rings touching", () => {
    // As judges.ts runs it: the ring clock starts when the orbit weight does.
    const slots = orbSlots(3);
    const dt = 1 / 60;
    let orbit = 0;
    let closest = Infinity;
    for (let f = 1; f <= 12 * 60; f++) {
      orbit += (1 - orbit) * (1 - Math.exp(-dt * POSE_RATES.orbit));
      const p = slots.map((s, i) => {
        const o = at(i, 3, f * dt);
        return { x: lerp(s.x, o.x, orbit), y: lerp(s.y, o.y, orbit) };
      });
      for (let i = 0; i < 3; i++) {
        for (let j = i + 1; j < 3; j++) closest = Math.min(closest, Math.hypot(p[i].x - p[j].x, p[i].y - p[j].y));
      }
    }
    expect(closest).toBeGreaterThan(2 * ring * orbRadius(3));
  });

  it("keeps the deliberating three near their places when an escalation adds judges", () => {
    for (let n = 4; n <= 7; n++) {
      for (const t of times) {
        for (let i = 0; i < 3; i++) expect(dist(at(i, 3, t), at(i, n, t)), `${n} orbs at ${t}s`).toBeLessThan(0.8);
      }
    }
  });
});

describe("verdictWinner", () => {
  it("emphasises only an outright win, both cups for a weighed tie", () => {
    expect(verdictWinner({ tugA: 80, votes: ["a", "a", "b"] })).toBe(-1);
    expect(verdictWinner({ tugA: 20, votes: ["b", "b", "b"] })).toBe(1);
    expect(verdictWinner({ tugA: 62, votes: ["a", "b", "other"] })).toBeNull();
    expect(verdictWinner({ tugA: 38, votes: ["other", "other", "other"] })).toBeNull();
    expect(verdictWinner({ tugA: 50, votes: ["a", "b", "other"] })).toBe(0);
    expect(verdictWinner({ tugA: 50, votes: [] })).toBeNull();
  });
});

describe("heroTargets", () => {
  it("is the resting pose when idle", () => {
    expect(heroTargets({ kind: "idle" }, live(0, 0))).toEqual(zeroPose());
  });

  it("maps judging beats to the story's pieces", () => {
    expect(heroTargets({ kind: "judging", beat: "lift" }, live(0, 0)).lift).toBe(1);
    expect(heroTargets({ kind: "judging", beat: "dig" }, live(0, 0)).sink).toBe(1);
    const d = heroTargets({ kind: "judging", beat: "deliberate" }, live(0, 0));
    expect(d).toMatchObject({ orbs: 1, rock: 1, orbit: 1, votes: 0, tilt: 0 });
    expect(d.glow).toBeGreaterThan(0);
    expect(d.glow).toBeLessThan(0.3);
  });

  it("sequences a verdict: orbs, then votes, then drop and tilt", () => {
    const mode = { kind: "verdict", verdict: { tugA: 80, votes: ["a", "a", "b"] } } as const;
    const early = heroTargets(mode, live(0.2, 0));
    expect(early).toMatchObject({ orbs: 1, votes: 0, drop: 0, tilt: 0 });
    const orbsUp = heroTargets(mode, live(0.9, 0.5));
    expect(orbsUp).toMatchObject({ votes: 1, drop: 0, tilt: 0 });
    const votesIn = heroTargets(mode, live(1, 1));
    expect(votesIn.drop).toBe(1);
    expect(votesIn.tilt).toBeCloseTo(tiltFromTug(80), 12);
  });

  it("freezes the pieces where they were instead of replaying them", () => {
    const mode = { kind: "verdict", verdict: { tugA: 50, votes: ["a"] } } as const;
    const t = heroTargets(mode, { ...zeroPose(), lift: 1, split: 0.3, sink: 0, meet: 0 });
    expect(t).toMatchObject({ split: 0.3, sink: 0, meet: 0, collapse: 1, reform: 1, lift: 0 });
  });

  it("a refusal shows no orbs and stays level", () => {
    const t = heroTargets({ kind: "verdict", verdict: { tugA: 50, votes: [] } }, live(0, 0));
    expect(t.orbs).toBe(0);
    expect(t.tilt).toBe(0);
  });

  it("settles from any beat within about two seconds of the verdict", () => {
    for (const beat of ["lift", "sort", "dig", "crux", "orbs", "deliberate"] as const) {
      const live = zeroPose();
      const target = zeroPose();
      for (let i = 0; i < 300; i++) {
        heroTargets({ kind: "judging", beat }, live, target);
        easePose(live, target, 1 / 60);
      }
      const verdict = { kind: "verdict", verdict: { tugA: 20, votes: ["b", "b", "b"] } } as const;
      let t = 0;
      for (; t < 6; t += 1 / 60) {
        heroTargets(verdict, live, target);
        const gap = easePose(live, target, 1 / 60);
        if (target.drop === 1 && Math.abs(live.tilt - tiltFromTug(20)) < 0.01 && gap < 0.05) break;
      }
      expect(t, beat).toBeLessThan(2.5);
    }
  });
});

describe("easePose", () => {
  it("moves every key toward its target and reports the gap", () => {
    const live = zeroPose();
    const target = zeroPose();
    for (const k of POSE_KEYS) target[k] = 1;
    const gap = easePose(live, target, 0.1);
    expect(gap).toBeGreaterThan(0);
    for (const k of POSE_KEYS) {
      expect(live[k], k).toBeGreaterThan(0);
      expect(live[k], k).toBeLessThan(1);
    }
  });
});
