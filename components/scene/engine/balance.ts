import {
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  PlaneGeometry,
  SphereGeometry,
  type Scene,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { PALETTE, sideColors, type Party } from "@/lib/palette";
import { BEAM_LEN, END, PIVOT_Y, PLINTH, SPHERE_R, bump, clamp01, lerp, ss, type Vec3 } from "@/lib/scene-poses";
import type { Bin, Materials } from "./materials";
import { LOOKS, type SceneLook } from "./theme";

/** Verdict emphasis: the winning side (-1 = Party A, 1 = Party B), 0 for a
 * result too close to call, null while there is no settled verdict. */
export type Winner = -1 | 0 | 1 | null;

/**
 * The balance itself: a long plinth that reaches under both cups (so sphere
 * shadows land on it, not on the floor), the cone, the axle, the beam with
 * its cups, the two party spheres and the baked contact shadows. Once a
 * verdict settles, the winner flashes and a soft ring marks the plinth under
 * its cup. The spheres and the ring take the side colours: the viewer's own
 * side green, the other red, in the theme's colours (paint).
 */
export function createBalance(
  scene: Scene,
  mats: Materials,
  bin: Bin,
  opts: { segments: number; shadows: boolean },
) {
  const seg = opts.segments;
  const top = PLINTH.h;

  const plinth = new Mesh(
    bin.add(new RoundedBoxGeometry(PLINTH.w, PLINTH.h, PLINTH.d, 4, 0.06)),
    mats.plinth,
  );
  plinth.position.y = top / 2;
  plinth.castShadow = opts.shadows;
  plinth.receiveShadow = opts.shadows;
  scene.add(plinth);

  const cone = new Mesh(bin.add(new ConeGeometry(0.4, PIVOT_Y - top - 0.06, seg)), mats.ink);
  cone.position.y = top + (PIVOT_Y - top - 0.06) / 2;
  cone.castShadow = opts.shadows;
  scene.add(cone);

  const axle = new Mesh(bin.add(new CylinderGeometry(0.1, 0.1, 0.36, 48)), mats.plaster);
  axle.rotation.x = Math.PI / 2;
  axle.position.y = PIVOT_Y;
  axle.castShadow = opts.shadows;
  scene.add(axle);

  const beam = new Group();
  beam.position.y = PIVOT_Y;
  scene.add(beam);
  const bar = new Mesh(bin.add(new RoundedBoxGeometry(BEAM_LEN, 0.09, 0.24, 4, 0.04)), mats.ink);
  bar.position.y = 0.06;
  bar.castShadow = opts.shadows;
  bar.receiveShadow = opts.shadows;
  beam.add(bar);
  const cupGeo = bin.add(new CylinderGeometry(0.34, 0.24, 0.09, seg));
  for (const s of [-1, 1]) {
    const cup = new Mesh(cupGeo, mats.plaster);
    cup.position.set(s * END, 0.15, 0);
    cup.castShadow = opts.shadows;
    cup.receiveShadow = opts.shadows;
    beam.add(cup);
  }

  const sphereGeo = bin.add(new SphereGeometry(SPHERE_R, seg, Math.round(seg * 0.67)));
  const sphereA = new Mesh(sphereGeo, mats.partyA);
  const sphereB = new Mesh(sphereGeo, mats.partyB);
  for (const m of [sphereA, sphereB]) {
    m.castShadow = opts.shadows;
    scene.add(m);
  }

  // Floor: a real shadow catcher when shadows are on, plus a baked blob under
  // the plinth that is always there (it anchors the object on ivory).
  const ground = new Mesh(bin.add(new PlaneGeometry(40, 40)), mats.ground);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = opts.shadows;
  ground.visible = opts.shadows;
  scene.add(ground);

  const blobGeo = bin.add(new PlaneGeometry(1, 1));
  const blob = (w: number, d: number, opacity: number, y: number) => {
    const m = new Mesh(blobGeo, mats.blob(opacity));
    m.rotation.x = -Math.PI / 2;
    m.scale.set(w, d, 1);
    m.position.y = y;
    m.renderOrder = 1;
    scene.add(m);
    return m;
  };
  const plinthBlob = blob(PLINTH.w * 1.25, PLINTH.d * 1.9, 0.42, 0.002);
  const plinthContact = blob(PLINTH.w * 1.07, PLINTH.d * 1.3, 0.38, 0.003);
  blob(1.15, 0.8, 0.6, top + 0.002);
  // Without a shadow map (mobile) each sphere gets a blob on the plinth top,
  // fading and spreading with height.
  const sphereBlobs = opts.shadows ? [] : [blob(1, 1, 0, top + 0.002), blob(1, 1, 0, top + 0.002)];

  const ringMat = mats.ring(PALETTE.paper);
  const ring = new Mesh(blobGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = top + 0.004;
  ring.renderOrder = 2;
  ring.visible = false;
  scene.add(ring);
  const ringA = new Color();
  const ringB = new Color();
  mats.partyA.emissiveIntensity = mats.partyB.emissiveIntensity = 0;

  let shade = 1;

  function paint(you: Party | null, look: SceneLook) {
    shade = look.shade;
    const c = sideColors(you, look.dark);
    for (const [mat, side, ringColor] of [
      [mats.partyA, c.a, ringA],
      [mats.partyB, c.b, ringB],
    ] as const) {
      mat.color.set(side.fill);
      mat.sheenColor.set(side.tint);
      mat.emissive.set(side.fill);
      ringColor.set(side.strong);
    }
  }
  paint(null, LOOKS.light);
  let ringSide = 0;

  const blobMat = (m: Mesh) => m.material as { opacity: number };

  return {
    beam,
    sphereA,
    sphereB,
    paint,
    /** `rise` lifts the beam, axle and cups (the entrance, the breathing
     * bob); the sphere centres already include it. */
    update(
      theta: number,
      a: Vec3,
      b: Vec3,
      scaleA: number,
      scaleB: number,
      spinDt: number,
      camDown: number,
      rise: number,
    ) {
      beam.rotation.z = theta;
      beam.position.y = PIVOT_Y + rise;
      axle.position.y = PIVOT_Y + rise;
      sphereA.position.set(a.x, a.y, a.z);
      sphereB.position.set(b.x, b.y, b.z);
      sphereA.scale.setScalar(Math.max(scaleA, 1e-4));
      sphereB.scale.setScalar(Math.max(scaleB, 1e-4));
      sphereA.visible = scaleA > 0.01;
      sphereB.visible = scaleB > 0.01;
      sphereA.rotation.y += spinDt * 0.3;
      sphereB.rotation.y -= spinDt * 0.3;

      blobMat(plinthBlob).opacity = Math.min(1, 0.42 * shade) * (1 - camDown * 0.6);
      blobMat(plinthContact).opacity = Math.min(1, 0.38 * shade) * (1 - camDown * 0.6);
      (mats.ground as { opacity: number }).opacity = 0.16 * shade * (1 - camDown * 0.7);
      sphereBlobs.forEach((m, i) => {
        const p = i === 0 ? a : b;
        const s = i === 0 ? scaleA : scaleB;
        const h = Math.max(0, p.y - SPHERE_R * s - top);
        const k = clamp01(1 - h / 2.4);
        blobMat(m).opacity = 0.55 * k * clamp01(s);
        const size = (0.75 + h * 0.3) * Math.max(s, 0.2);
        m.scale.set(size, size * 0.8, 1);
        m.position.x = p.x;
        m.position.z = Math.min(p.z, PLINTH.d / 2 - 0.2);
        m.visible = blobMat(m).opacity > 0.004;
      });
    },
    /** `since`: seconds since the verdict's beam settled (large when the
     * verdict was snapped into place). */
    emphasis(winner: Winner, since: number, theta: number, dt: number) {
      const flash = winner === 0 ? 0.22 * bump(since / 0.6) : winner ? 0.55 * bump(since / 0.4) : 0;
      mats.partyA.emissiveIntensity = winner === 1 ? 0 : flash;
      mats.partyB.emissiveIntensity = winner === -1 ? 0 : flash;

      if (winner === -1 || winner === 1) {
        ringSide = winner;
        ringMat.color.copy(winner === -1 ? ringA : ringB);
        const grow = ss(0, 0.7, since);
        ring.scale.setScalar(lerp(0.9, 1.35, 1 - (1 - grow) * (1 - grow)));
        ringMat.opacity = clamp01(since / 0.12) * (0.28 + 0.24 * (1 - ss(0.2, 0.9, since)));
      } else ringMat.opacity = dt > 0 ? ringMat.opacity * Math.exp(-dt * 5) : 0;
      ring.position.x = ringSide * END * Math.cos(theta);
      ring.visible = ringMat.opacity > 0.004;
    },
  };
}
