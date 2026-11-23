import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
  SphereGeometry,
  type Scene,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { PALETTE, sideColors, type Party } from "@/lib/palette";
import { ZONE_R, type Play } from "@/lib/scene-play";
import { BEAM_LEN, END, PIVOT_Y, PLINTH, SPHERE_R, bump, clamp01, lerp, ss, type Vec3 } from "@/lib/scene-poses";
import type { Bin, Materials } from "./materials";
import { LOOKS, type SceneLook } from "./theme";

/** Verdict emphasis: the winning side (-1 = Party A, 1 = Party B), 0 for a
 * result too close to call, null while there is no settled verdict. */
export type Winner = -1 | 0 | 1 | null;

/**
 * The balance itself: a long plinth that reaches under both cups (so sphere
 * shadows land on it, not on the floor), a turned stand with a knife edge, the
 * beam with its cups, the two party spheres and the baked contact shadows. Once a
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

  const stand = (geo: BufferGeometry, y: number, mat: Mesh["material"] = mats.ink) => {
    const m = new Mesh(bin.add(geo), mat);
    m.position.y = y;
    m.castShadow = opts.shadows;
    scene.add(m);
    return m;
  };
  stand(new CylinderGeometry(0.4, 0.46, 0.08, seg), top + 0.04);
  stand(new CylinderGeometry(0.22, 0.27, 0.06, seg), top + 0.11);
  const yokeY = PIVOT_Y - 0.2;
  const colBottom = top + 0.14;
  stand(new CylinderGeometry(0.07, 0.11, yokeY - colBottom, seg), (colBottom + yokeY) / 2);
  stand(new RoundedBoxGeometry(0.22, 0.06, 0.44, 2, 0.02), yokeY + 0.03);
  const postH = PIVOT_Y - 0.02 - (yokeY + 0.06);
  for (const z of [-0.21, 0.21]) {
    stand(new BoxGeometry(0.1, postH, 0.05), yokeY + 0.06 + postH / 2).position.z = z;
    stand(new RoundedBoxGeometry(0.16, 0.02, 0.08, 2, 0.006), PIVOT_Y - 0.01, mats.plaster).position.z = z;
  }

  const beam = new Group();
  beam.position.y = PIVOT_Y;
  scene.add(beam);
  const bar = new Mesh(bin.add(new RoundedBoxGeometry(BEAM_LEN, 0.09, 0.24, 4, 0.04)), mats.ink);
  bar.position.y = 0.06;
  bar.castShadow = opts.shadows;
  bar.receiveShadow = opts.shadows;
  beam.add(bar);
  // A triangular blade, edge down on the two pads.
  const blade = new Mesh(bin.add(new CylinderGeometry(0.09, 0.09, 0.52, 3)), mats.ink);
  blade.rotation.x = Math.PI / 2;
  blade.position.y = 0.09;
  blade.castShadow = opts.shadows;
  beam.add(blade);
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
  // Thrown balls keep flying while the next one comes in: one a throw every
  // 0.7 s at best, each alive 2.1 s.
  const extras = [mats.partyA, mats.partyB].map((mat) =>
    [0, 1, 2, 3, 4].map(() => {
      const m = new Mesh(sphereGeo, mat);
      m.castShadow = opts.shadows;
      m.visible = false;
      scene.add(m);
      return m;
    }),
  );

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
  const zoneGeo = bin.add(new RingGeometry(ZONE_R - 0.018, ZONE_R, 128));
  const zones = [0, 1].map(() => {
    const mat = bin.add(new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    const m = new Mesh(zoneGeo, mat);
    m.renderOrder = 2;
    m.visible = false;
    scene.add(m);
    return m;
  });
  mats.partyA.emissiveIntensity = mats.partyB.emissiveIntensity = 0;

  let shade = 1;

  function paint(you: Party | null, look: SceneLook) {
    shade = look.shade;
    const c = sideColors(you, look.dark);
    for (const [mat, side, ringColor, zone] of [
      [mats.partyA, c.a, ringA, zones[0]],
      [mats.partyB, c.b, ringB, zones[1]],
    ] as const) {
      mat.color.set(side.fill);
      mat.sheenColor.set(side.tint);
      mat.emissive.set(side.fill);
      ringColor.set(side.strong);
      (zone.material as MeshBasicMaterial).color.copy(ringColor);
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
    /** `rise` lifts the beam and its cups (the entrance); the sphere
     * centres already include it, plus their own breathing bob. */
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
    /** Balls that are not a side's current one, and the zone rings; `scale`
     * is the spheres' common scale. Returns whether a ring is still easing. */
    playScene(play: Play | null, dt: number, scale: number) {
      const used = [0, 0];
      if (play) {
        for (const b of play.balls) {
          if (b === play.current(b.side)) continue;
          const i = b.side < 0 ? 0 : 1;
          const m = extras[i][used[i]++];
          if (!m) continue;
          m.position.set(b.x, b.y, b.z);
          m.scale.setScalar(Math.max(b.k * scale, 1e-4));
          m.visible = true;
        }
      }
      for (let i = 0; i < 2; i++) {
        for (let j = used[i]; j < extras[i].length; j++) extras[i][j].visible = false;
      }
      let easing = false;
      zones.forEach((z, i) => {
        const side = i === 0 ? -1 : 1;
        const want = play ? play.glow(side) : 0;
        const mat = z.material as MeshBasicMaterial;
        mat.opacity = dt > 0 ? mat.opacity + (want - mat.opacity) * (1 - Math.exp(-dt * 10)) : want;
        z.visible = mat.opacity > 0.01;
        if (play) z.position.set(play.seats[i].x, play.seats[i].y, 0);
        if (Math.abs(want - mat.opacity) > 0.005) easing = true;
      });
      return easing;
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
