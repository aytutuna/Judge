import type { JudgeVerdict, VerdictResult } from "./types";
import { tugFinal } from "./verdict-display";
import type { SceneVerdict, Vote } from "./scene-bridge";

/**
 * How a verdict tips the balance. Pure: shared by the 3D engine, the SVG
 * fallback and the share page, so every picture of the beam agrees with the
 * tug-of-war bar (both read tugFinal).
 */

export type { SceneVerdict, Vote } from "./scene-bridge";

/** Largest verdict tilt (about 17 degrees at a full 100/0, 10.3 at 80/20). */
export const MAX_TILT_RAD = 0.3;

/** Beam angle for Party A's tug share. Positive = Party A (left) end DOWN,
 * which is three.js's counter-clockwise rotation.z. */
export function tiltFromTug(tugA: number): number {
  const l = Math.max(-1, Math.min(1, (tugA - 50) / 50));
  return l * MAX_TILT_RAD;
}

/** The same tilt for SVG, whose rotate() is clockwise-positive. */
export function svgRotateDeg(tugA: number): number {
  const deg = (-tiltFromTug(tugA) * 180) / Math.PI;
  return deg === 0 ? 0 : deg; // no -0 in markup
}

/** One judge run as a vote orb: a side, or "other" for split, conditional
 * and dissolved (the run declined to pick). */
export function voteOf(run: JudgeVerdict): Vote {
  return run === "side_a" ? "a" : run === "side_b" ? "b" : "other";
}

/** What the scene shows for a finished verdict. A refusal is level with no
 * votes: the model never judged, so no orb may pretend it did. */
export function sceneVerdictFrom(r: VerdictResult): SceneVerdict {
  return r.model_refused ? { tugA: 50, votes: [] } : { tugA: tugFinal(r), votes: r.runs.map(voteOf) };
}
