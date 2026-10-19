import { MathUtils, Vector3, type PerspectiveCamera } from "three";
import { PLINTH, lerp, type Pose } from "@/lib/scene-poses";

/**
 * Camera framing. The balance is fitted into a fraction of the viewport:
 * the right half on desktop (text on the left); on mobile, a band between
 * the nav and the text or card below it (lib/scene-layout.ts), with its base
 * set on the band's bottom edge so no empty gap opens above the text. Also
 * projects the balance's bounding box to CSS px so the stage can fade the
 * canvas where it would ghost through text.
 */

export type View = {
  /** Smoothed pointer, -1..1. */
  px: number;
  py: number;
  time: number;
  /** 1 while there has been recent input, 0 once idle (sway stops). */
  idle: number;
  reduced: boolean;
};

/** Mobile framing target in viewport px: the balance fits between `top` and
 * `bottom`, and its base (the lowest projected point of the footprint at
 * height `yMin`) sits on `bottom`. Ignored on desktop. */
export type Band = { top: number; bottom: number; yMin: number };

/** Share of the mobile band the framing height `hc` may fill. */
const BAND_FILL = 0.86;

const target = new Vector3();
const corner = new Vector3();

export function frameCamera(
  camera: PerspectiveCamera,
  pose: Pose,
  desk: boolean,
  W: number,
  H: number,
  view: View,
  band: Band,
): void {
  const { lift, split, sink, reform, camDown, judgeView } = pose;
  let ty = lerp(1.12, 1.55, lift);
  let hc = lerp(2.85, 3.4, lift);
  let el = 0.15;
  const sorted = split * (1 - sink) * (1 - reform);
  ty = lerp(ty, 2.0, sorted);
  hc = lerp(hc, 3.7, sorted);
  ty = lerp(ty, -0.3, camDown);
  hc = lerp(hc, 4.2, camDown);
  el = lerp(el, 0.05, camDown);
  const jv = judgeView * (1 - camDown);
  ty = lerp(ty, 1.72, jv);
  hc = lerp(hc, 3.85, jv);
  el = lerp(el, 0.2, jv);
  const wc = lerp(5.7, 6.1, jv);

  const tanH = Math.tan(MathUtils.degToRad(camera.fov / 2));
  const aspect = W / H;
  const fw = desk ? 0.4 : 0.9;
  const fh = desk ? 0.6 : Math.max(0.12, ((band.bottom - band.top) * BAND_FILL) / H);
  const dist = Math.max(wc / (fw * 2 * tanH * aspect), hc / (fh * 2 * tanH));

  const az = view.reduced
    ? 0.12
    : view.px * 0.12 + Math.sin(view.time * 0.17) * 0.04 * view.idle + 0.05;
  if (!view.reduced) el += -view.py * 0.035;

  target.set(0, ty, 0);
  camera.position.set(
    Math.sin(az) * Math.cos(el) * dist,
    ty + Math.sin(el) * dist,
    Math.cos(az) * Math.cos(el) * dist,
  );
  camera.lookAt(target);
  camera.aspect = aspect;
  camera.setViewOffset(W, H, desk ? -W * 0.24 : 0, 0, W, H);
  camera.updateProjectionMatrix();
  // render() would refresh this too, but projectContent runs before it: a
  // stale view matrix projects the previous frame's framing (under reduced
  // motion, the previous mode's pose).
  camera.updateMatrixWorld();
  if (desk) return;
  // Moving the view window down by n px moves the picture up by n px.
  const base = projectedBottom(camera, H, band.yMin);
  camera.setViewOffset(W, H, 0, base - band.bottom, W, H);
  camera.updateProjectionMatrix();
}

/** Lowest projected point (CSS px from the top) of the plinth footprint at
 * height y. */
function projectedBottom(camera: PerspectiveCamera, H: number, y: number): number {
  let bottom = -Infinity;
  const hw = PLINTH.w / 2;
  for (const x of [-hw, hw]) {
    for (const z of [-0.85, 0.9]) {
      corner.set(x, y, z).project(camera);
      bottom = Math.max(bottom, ((1 - corner.y) / 2) * H);
    }
  }
  return bottom;
}

/** Projected bounding box (CSS px, relative to the canvas) of the balance
 * between heights yMin and yMax. */
export function projectContent(
  camera: PerspectiveCamera,
  W: number,
  H: number,
  yMin: number,
  yMax: number,
  out: { top: number; right: number; bottom: number; left: number },
): void {
  let top = Infinity;
  let bottom = -Infinity;
  let left = Infinity;
  let right = -Infinity;
  const hw = PLINTH.w / 2;
  for (const x of [-hw, hw]) {
    for (const y of [yMin, yMax]) {
      for (const z of [-0.85, 0.9]) {
        corner.set(x, y, z).project(camera);
        const sx = ((corner.x + 1) / 2) * W;
        const sy = ((1 - corner.y) / 2) * H;
        if (sx < left) left = sx;
        if (sx > right) right = sx;
        if (sy < top) top = sy;
        if (sy > bottom) bottom = sy;
      }
    }
  }
  out.top = top;
  out.right = right;
  out.bottom = bottom;
  out.left = left;
}
