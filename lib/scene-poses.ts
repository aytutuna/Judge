import { tiltFromTug } from "./balance";
import type { JudgingBeat, SceneMode, SceneVerdict } from "./scene-bridge";

/**
 * Every target pose of the 3D balance as pure maths, no three.js. The engine
 * only eases its live values toward what these functions return, so the
 * whole choreography (scroll story, judging beats, verdict landing) is
 * unit-testable in node.
 */

/* ---------- easing ---------- */

export const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Smoothstep from a to b. */
export function ss(a: number, b: number, x: number): number {
  const k = clamp01((x - a) / (b - a));
  return k * k * (3 - 2 * k);
}
export function easeOutBack(x: number): number {
  if (x <= 0) return 0;
  const c1 = 1.5;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

/* ---------- geometry (world units; the plinth top is y = 0.14) ---------- */

export const PLINTH = { w: 5.3, h: 0.14, d: 1.5 } as const;
export const PIVOT_Y = 1.36;
/** Cup centres along the beam, either side of the pivot. */
export const END = 2.02;
export const BEAM_LEN = 4.5;
/** Party sphere radius. */
export const SPHERE_R = 0.5;
/** Sphere centre height above the beam axis when seated in its cup. */
export const SEAT = 0.15 + 0.045 + SPHERE_R - 0.07;
/** Hard stop of the beam spring. */
export const THETA_LIMIT = 0.42;
/** Pointer authority over the beam once a verdict is showing. */
export const VERDICT_POINTER_RAD = 0.03;
/** Largest |theta| while orbs are visible: the verdict tilt plus pointer. */
export const ORB_POSE_THETA = 0.3 + VERDICT_POINTER_RAD;
/** Pulse headroom on the sphere scale (typing energy, judging breath). */
export const MAX_PULSE = 1.05;
/** Lift raises the spheres off their cups and swells them slightly. */
export const LIFT_RISE = 0.95;
export const LIFT_FORWARD = 0.3;
export const LIFT_SPREAD = 0.08;
export const LIFT_SWELL = 0.14;

export const BED_TOP = -1.55;
export const CRUX_POS = { x: 0, y: -1.08, z: 0.3 } as const;
/** Where the collapsed crux point stops rising and splits into orbs. */
export const ORB_SPLIT_POS = { x: 0, y: PIVOT_Y + 1.3, z: -0.45 } as const;
export const MAX_ORBS = 7;

export type Vec3 = { x: number; y: number; z: number };

/** A point given in beam coordinates, rotated by theta about the pivot. */
export function beamPoint(theta: number, lx: number, ly: number): { x: number; y: number } {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return { x: lx * c - ly * s, y: PIVOT_Y + lx * s + ly * c };
}

/** Party sphere centre. side -1 = Party A (left), 1 = Party B (right). */
export function sphereCentre(side: -1 | 1, theta: number, lift: number, bob = 0): Vec3 {
  const p = beamPoint(theta, side * END, SEAT);
  return {
    x: p.x + side * LIFT_SPREAD * lift,
    y: p.y + LIFT_RISE * lift + bob,
    z: LIFT_FORWARD * lift,
  };
}

/** Sphere scale before the split/reform factor. */
export function sphereScale(lift: number, pulse = 1): number {
  return (1 + LIFT_SWELL * lift) * pulse;
}

/** Orb radius: smaller when an escalation brings in more judges. */
export function orbRadius(n: number): number {
  return n <= 3 ? 0.2 : n <= 5 ? 0.17 : 0.14;
}

const ORB_HALF_SPAN = 1.0;
const ORB_Y = PIVOT_Y + 1.55;
const ORB_ARC = 0.2;
const ORB_Z = -0.65;

/** Resting places of n judge orbs: an arc behind and above the pivot, well
 * clear of the beam ends (test/scene-poses.test.ts guards the clearance). */
export function orbSlots(n: number): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const u = n === 1 ? 0 : -1 + (2 * i) / (n - 1);
    out.push({ x: u * ORB_HALF_SPAN, y: ORB_Y + ORB_ARC * (1 - u * u), z: ORB_Z });
  }
  return out;
}

/** Per-orb vote reveal for an overall 0..1 progress, staggered by index. */
export function voteAt(i: number, n: number, progress: number): number {
  const spread = 0.55;
  const d = n > 1 ? spread / (n - 1) : 0;
  return ss(i * d, i * d + (1 - spread), progress);
}

/* ---------- poses ---------- */

/** Every animated scalar of the scene. 0..1 unless noted. */
export type Pose = {
  /** Spheres float off their cups (step 1, judging "lift"). */
  lift: number;
  /** Claim pieces leave the spheres and sort into rows by kind. */
  split: number;
  /** Pieces sink to each side's bedrock. */
  sink: number;
  /** Pieces ring the crux. */
  meet: number;
  /** Pieces converge into one glowing point. */
  collapse: number;
  /** The point rises and fans out into the judge orbs. */
  orbs: number;
  /** Spheres re-form on the cups. */
  reform: number;
  /** Camera drops to show the bedrock cutaway. */
  camDown: number;
  /** Camera frames the orbs above the beam. */
  judgeView: number;
  /** Vote colour reveal, staggered per orb by voteAt. */
  votes: number;
  /** Voting orbs fly into their cup; "other" votes sink into the pivot. */
  drop: number;
  /** Beam target angle, radians (+ = Party A end down). */
  tilt: number;
  /** Faint crux glow while the judges deliberate. */
  glow: number;
  /** Gentle random rocking of the beam (deliberation). */
  rock: number;
  /** Slow orbit of neutral orbs (deliberation). */
  orbit: number;
  /** Judging breath on the spheres. */
  busy: number;
};

export const POSE_KEYS = [
  "lift",
  "split",
  "sink",
  "meet",
  "collapse",
  "orbs",
  "reform",
  "camDown",
  "judgeView",
  "votes",
  "drop",
  "tilt",
  "glow",
  "rock",
  "orbit",
  "busy",
] as const satisfies readonly (keyof Pose)[];

export function zeroPose(): Pose {
  return {
    lift: 0,
    split: 0,
    sink: 0,
    meet: 0,
    collapse: 0,
    orbs: 0,
    reform: 0,
    camDown: 0,
    judgeView: 0,
    votes: 0,
    drop: 0,
    tilt: 0,
    glow: 0,
    rock: 0,
    orbit: 0,
    busy: 0,
  };
}

/** The verdict the scroll story ends on: the sample card's hot-dog case
 * (Party B wins, 20/80, three votes for B), so step 5 matches its tug bar. */
export const STORY_VERDICT: SceneVerdict = { tugA: 20, votes: ["b", "b", "b"] };

/** Weight of the story pose over the hero pose. */
export function storyBlend(q: number): number {
  return ss(-0.7, -0.05, q);
}

/** Story weights for scroll progress q (step i active when round(q) === i). */
export function storyWeights(q: number) {
  const lift = ss(-0.7, -0.05, q);
  const split = ss(0.3, 0.85, q);
  const sink = ss(1.2, 1.62, q);
  const meet = ss(1.68, 2.05, q);
  const collapse = ss(2.5, 2.8, q);
  const orbs = ss(2.75, 3.05, q);
  const votes = clamp01((q - 3.0) / 0.35);
  const tip = ss(3.55, 3.95, q);
  return {
    lift,
    split,
    sink,
    meet,
    collapse,
    orbs,
    /** Spheres re-form on the cups while the orbs appear. */
    reform: orbs,
    votes,
    tip,
    camDown: ss(1.1, 1.55, q) * (1 - ss(2.25, 2.7, q)),
    judgeView: ss(2.6, 3.0, q) * (1 - ss(4.6, 5.2, q)),
  };
}

/** The story as a pose. Lift runs the whole story until the spheres re-form. */
export function storyPose(q: number, out: Pose = zeroPose()): Pose {
  const w = storyWeights(q);
  out.lift = w.lift * (1 - w.reform);
  out.split = w.split;
  out.sink = w.sink;
  out.meet = w.meet;
  out.collapse = w.collapse;
  out.orbs = w.orbs;
  out.reform = w.reform;
  out.camDown = w.camDown;
  out.judgeView = w.judgeView;
  out.votes = w.votes;
  out.drop = w.tip;
  out.tilt = tiltFromTug(STORY_VERDICT.tugA) * w.tip;
  out.glow = 0;
  out.rock = 0;
  out.orbit = 0;
  out.busy = 0;
  return out;
}

/** Reduced motion has no scroll scrub: each step shows its settled pose. */
export function snapStoryQ(q: number): number {
  if (q < -0.5) return -3;
  const step = Math.max(0, Math.min(4, Math.round(q)));
  // Step 4's settled pose is after the votes are in.
  return step === 3 ? 3.4 : step;
}

const BEATS: Record<JudgingBeat, Partial<Pose>> = {
  lift: { lift: 1, busy: 1 },
  sort: { lift: 1, split: 1, busy: 1 },
  dig: { lift: 1, split: 1, sink: 1, camDown: 0.75, busy: 1 },
  crux: { lift: 1, split: 1, sink: 1, meet: 1, camDown: 0.75, busy: 1 },
  orbs: { split: 1, sink: 1, meet: 1, collapse: 1, orbs: 1, reform: 1, judgeView: 1 },
  deliberate: {
    split: 1,
    sink: 1,
    meet: 1,
    collapse: 1,
    orbs: 1,
    reform: 1,
    judgeView: 1,
    glow: 0.18,
    rock: 1,
    orbit: 1,
  },
};

/**
 * Hero targets for a scene mode. Judging beats are plain targets; a verdict
 * is sequenced off the live values so it can land in any beat: whatever the
 * pieces were doing freezes and collapses into the point, the orbs come up,
 * the votes colour once the orbs are up, then the drop and the tilt once the
 * votes are in.
 */
export function heroTargets(mode: SceneMode, live: Pose, out: Pose = zeroPose()): Pose {
  const { split, sink, meet } = live;
  for (const k of POSE_KEYS) out[k] = 0;
  if (mode.kind === "judging") {
    Object.assign(out, BEATS[mode.beat]);
    return out;
  }
  if (mode.kind === "verdict") {
    const v = mode.verdict;
    // Frozen, not pushed to 1: pieces that never came out stay in.
    out.split = split;
    out.sink = sink;
    out.meet = meet;
    out.collapse = 1;
    out.orbs = v.votes.length > 0 ? 1 : 0;
    out.reform = 1;
    out.judgeView = v.votes.length > 0 ? 1 : 0;
    const orbsUp = v.votes.length === 0 || live.orbs > 0.85;
    out.votes = orbsUp ? 1 : 0;
    const votesIn = v.votes.length === 0 || live.votes > 0.97;
    out.drop = orbsUp && votesIn ? 1 : 0;
    out.tilt = orbsUp && votesIn ? tiltFromTug(v.tugA) : 0;
  }
  return out;
}

/** out = a + (b - a) * w, per key. */
export function blendPose(a: Pose, b: Pose, w: number, out: Pose = zeroPose()): Pose {
  for (const k of POSE_KEYS) out[k] = lerp(a[k], b[k], w);
  return out;
}

/** Per-key easing rates (1/s) for the hero springs. */
export const POSE_RATES: Record<keyof Pose, number> = {
  lift: 3.2,
  split: 2.6,
  sink: 2.4,
  meet: 2.6,
  collapse: 3.2,
  orbs: 3.4,
  reform: 3,
  camDown: 2.2,
  judgeView: 2.4,
  votes: 4.5,
  drop: 3.6,
  tilt: 6,
  glow: 2,
  rock: 1.5,
  orbit: 1.5,
  busy: 2,
};

/** Exponential ease of `live` toward `target` over dt seconds. Returns the
 * largest remaining gap, so the loop knows when everything has settled. */
export function easePose(live: Pose, target: Pose, dt: number): number {
  let gap = 0;
  for (const k of POSE_KEYS) {
    const a = 1 - Math.exp(-dt * POSE_RATES[k]);
    live[k] += (target[k] - live[k]) * a;
    const d = Math.abs(target[k] - live[k]);
    if (d < 1e-4) live[k] = target[k];
    else if (d > gap) gap = d;
  }
  return gap;
}

/** Idle sway fades out after 5 s without input (WCAG 2.2.2, battery). */
export const IDLE_SWAY_MS = 5000;
export function idleFactor(msSinceInput: number): number {
  return 1 - ss(IDLE_SWAY_MS, IDLE_SWAY_MS + 1500, msSinceInput);
}
