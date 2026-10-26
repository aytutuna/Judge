import { PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { cardSpan, frameCard, type View } from "../components/scene/engine/camera";
import { MOTE_RISE, RIPPLE_R } from "../components/scene/engine/crux";
import type { JudgingBeat, SceneMode, Vote } from "../lib/scene-bridge";
import { tiltFromTug } from "../lib/balance";
import {
  BEAM_LEN,
  BED_TOP,
  CRUX_POS,
  END,
  MAX_PULSE,
  ORB_SPLIT_POS,
  PLINTH,
  SPHERE_R,
  beamPoint,
  heroTargets,
  lerp,
  orbRadius,
  orbSlots,
  orbitPoint,
  sphereCentre,
  sphereScale,
  zeroPose,
  type Pose,
} from "../lib/scene-poses";

type Ball = { x: number; y: number; z: number; r: number };

/** What is on screen for a pose with the beam at theta at a given time, as
 * spheres. Built from the scene geometry, independent of cardSpan. */
function content(pose: Pose, theta: number, n: number, time: number): Ball[] {
  const out: Ball[] = [];
  const box = (hx: number, y0: number, y1: number, hz: number) => {
    for (const x of [-hx, hx]) for (const y of [y0, y1]) for (const z of [-hz, hz]) out.push({ x, y, z, r: 0 });
  };
  box(PLINTH.w / 2, 0, PLINTH.h, PLINTH.d / 2);
  if (pose.camDown > 0.3) box(2.5, BED_TOP - 0.34, BED_TOP, 0.85);
  for (const s of [-1, 1]) {
    for (const ly of [0, 0.2]) {
      const p = beamPoint(theta, (s * BEAM_LEN) / 2, ly);
      out.push({ x: p.x, y: p.y, z: 0, r: 0.12 });
    }
    const cup = beamPoint(theta, s * (END + 0.34), 0.2);
    out.push({ x: cup.x, y: cup.y, z: 0.34, r: 0 });
  }
  const shown = 1 - pose.split * (1 - pose.reform);
  if (shown > 0.5) {
    for (const s of [-1, 1] as const) {
      const c = sphereCentre(s, theta, pose.lift, 0.05 * pose.lift);
      out.push({ ...c, r: SPHERE_R * sphereScale(pose.lift, MAX_PULSE) });
    }
  }
  if (pose.split > 0.5 && pose.sink < 0.5 && pose.reform < 0.5) {
    for (const x of [-2.7, -1.2, 1.2, 2.7]) for (const y of [1.95, 3.19]) out.push({ x, y, z: 0.2, r: 0.11 });
  }
  if (pose.meet > 0.5 && pose.collapse < 0.5) {
    // The pieces' ring, the gem's ripple and the motes rising off it.
    out.push({ ...CRUX_POS, r: Math.max(0.8, RIPPLE_R + 0.03) });
    out.push({ ...CRUX_POS, y: CRUX_POS.y + 0.08 + MOTE_RISE, r: 0.3 });
  }
  if (pose.orbs > 0.5 && pose.drop < 0.5) {
    // Ring outline, a vote's pop and part of its halo.
    const r = orbRadius(n) * 1.25 + 0.07 + 0.1 * pose.votes;
    for (const s of orbSlots(n)) out.push({ ...s, r });
    if (pose.orbit > 0.5) {
      for (let i = 0; i < n; i++) out.push({ ...orbitPoint(i, n, time, { x: 0, y: 0, z: 0 }), r });
      out.push({ ...ORB_SPLIT_POS, y: ORB_SPLIT_POS.y + 0.08 + MOTE_RISE, r: 0.3 });
    }
  }
  if (pose.drop > 0.5) {
    // The ground ring under the winning cup, at its widest.
    for (const s of [-1, 1]) {
      const x = beamPoint(theta, s * END, 0).x;
      for (const dx of [-0.675, 0.675]) for (const z of [-0.675, 0.675]) out.push({ x: x + dx, y: PLINTH.h, z, r: 0 });
    }
  }
  return out;
}

/** Beam angles the live spring can reach around the pose's tilt. */
function thetas(pose: Pose): number[] {
  const play = lerp(0.19, 0.03, pose.drop) + 0.08 * pose.rock;
  return [pose.tilt - play, pose.tilt, pose.tilt + play];
}

const BEATS: JudgingBeat[] = ["lift", "sort", "dig", "crux", "orbs", "deliberate"];

/** Every settled beat, then each stage a verdict passes through after the
 * deliberation (orbs up, votes coloured, dropped and tipped). */
function poses(): { name: string; pose: Pose; n: number }[] {
  const out: { name: string; pose: Pose; n: number }[] = BEATS.map((beat) => ({
    name: beat,
    pose: heroTargets({ kind: "judging", beat }, zeroPose()),
    n: 3,
  }));
  const ballots: Vote[][] = [["a", "a", "b"], ["b", "b", "b", "other", "b"], ["a", "a", "a", "a", "b", "b", "other"], []];
  for (const tugA of [0, 50, 100]) {
    for (const votes of ballots) {
      const mode: SceneMode = { kind: "verdict", verdict: { tugA, votes } };
      let live = out[5].pose;
      for (let i = 0; i < 4; i++) {
        live = heroTargets(mode, live);
        out.push({ name: `verdict ${tugA} ${votes.join("") || "refused"} #${i}`, pose: live, n: votes.length || 3 });
      }
    }
  }
  return out;
}

const SIZES: [number, number][] = [
  [358, 268],
  [480, 320],
  [640, 360],
  [720, 360],
  [720, 315],
];

const v = new Vector3();
const toCam = new Vector3();

/** Largest |NDC| any content reaches, with each ball's projected radius. */
function reach(camera: PerspectiveCamera, balls: Ball[], aspect: number): number {
  const tanH = Math.tan((camera.fov * Math.PI) / 360);
  let worst = 0;
  for (const b of balls) {
    v.set(b.x, b.y, b.z);
    const depth = toCam.copy(v).sub(camera.position).length();
    v.project(camera);
    const ry = b.r / (depth * tanH);
    worst = Math.max(worst, Math.abs(v.x) + ry / aspect, Math.abs(v.y) + ry);
  }
  return worst;
}

describe("card framing", () => {
  const camera = new PerspectiveCamera(30, 1, 0.1, 120);
  const views: View[] = [];
  for (const px of [-1, 0, 1]) {
    for (const py of [-1, 1]) {
      for (let t = 0; t < 30; t += 2.5) views.push({ px, py, time: t, idle: 1, reduced: false });
    }
  }
  views.push({ px: 0, py: 0, time: 0, idle: 0, reduced: true });

  for (const [W, H] of SIZES) {
    it(`keeps every beat and verdict inside a ${W}x${H} card`, () => {
      for (const { name, pose, n } of poses()) {
        let worst = 0;
        for (const theta of thetas(pose)) {
          for (const view of views) {
            const balls = content(pose, theta, n, view.time);
            frameCard(camera, pose, W, H, view);
            worst = Math.max(worst, reach(camera, balls, W / H));
          }
        }
        expect(worst, name).toBeLessThan(0.97);
      }
    });
  }

  it("still fills most of a mobile card with the balance", () => {
    const pose = heroTargets({ kind: "verdict", verdict: { tugA: 50, votes: [] } }, zeroPose());
    frameCard(camera, pose, 358, 268, { px: 0, py: 0, time: 0, idle: 0, reduced: true });
    const left = v.set(-PLINTH.w / 2, PLINTH.h, 0).project(camera).x;
    const right = v.set(PLINTH.w / 2, PLINTH.h, 0).project(camera).x;
    expect(right - left).toBeGreaterThan(2 * 0.7);
  });

  it("opens downward for the bedrock and upward for the orbs", () => {
    const at = (beat: JudgingBeat) => cardSpan(heroTargets({ kind: "judging", beat }, zeroPose()));
    expect(at("dig").yMin).toBeLessThan(BED_TOP - 0.34);
    expect(at("lift").yMin).toBeGreaterThan(-0.5);
    expect(at("orbs").yMax).toBeGreaterThan(orbSlots(1)[0].y + orbRadius(1));
  });

  it("frames a tipped verdict without the orbs tighter than the deliberation", () => {
    const delib = heroTargets({ kind: "judging", beat: "deliberate" }, zeroPose());
    const done = { ...zeroPose(), reform: 1, collapse: 1, drop: 1, judgeView: 1, tilt: tiltFromTug(100) };
    expect(cardSpan(done).yMax).toBeLessThan(cardSpan(delib).yMax);
  });
});
