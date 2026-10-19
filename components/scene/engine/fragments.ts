import {
  InstancedMesh,
  Object3D,
  OctahedronGeometry,
  Quaternion,
  SphereGeometry,
  TetrahedronGeometry,
  Vector3,
  type BufferGeometry,
  type Scene,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { BED_TOP, CRUX_POS, clamp01, type Pose, type Vec3 } from "@/lib/scene-poses";
import type { Bin, Materials } from "./materials";

/**
 * The claim pieces: four kinds per party (cube = fact, ball = value,
 * tetrahedron = definition, octahedron = logic, the same shapes as the
 * ArgumentMap glyphs). They leave the spheres, sort into rows, sink to
 * bedrock, ring the crux, then converge into the glowing point.
 */

type Frag = {
  mesh: InstancedMesh;
  idx: number;
  party: 0 | 1;
  inner: Vector3;
  sorted: Vector3;
  bed: Vector3;
  crux: Vector3;
  axis: Vector3;
  phase: number;
  delay: number;
  spin: number;
};

export function createFragments(
  scene: Scene,
  mats: Materials,
  bin: Bin,
  opts: { perKind: number; shadows: boolean },
) {
  const perKind = opts.perKind;
  const kindGeo: BufferGeometry[] = [
    bin.add(new RoundedBoxGeometry(1, 1, 1, 2, 0.16)),
    bin.add(new SphereGeometry(0.6, 20, 14)),
    bin.add(new TetrahedronGeometry(0.82)),
    bin.add(new OctahedronGeometry(0.72)),
  ];
  // Seeded so every visit lays the pieces out the same way.
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  const frags: Frag[] = [];
  const meshes: InstancedMesh[] = [];
  for (let p = 0 as 0 | 1; p < 2; p = (p + 1) as 0 | 1) {
    const sx = p === 0 ? -1.95 : 1.95;
    for (let k = 0; k < 4; k++) {
      const mesh = new InstancedMesh(kindGeo[k], p === 0 ? mats.partyA : mats.partyB, perKind);
      mesh.castShadow = opts.shadows;
      mesh.frustumCulled = false;
      scene.add(mesh);
      meshes.push(mesh);
      for (let j = 0; j < perKind; j++) {
        const total = 4 * perKind;
        const local = k * perKind + j;
        const inner = new Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(0.6);
        const sorted = new Vector3(sx + (j - (perKind - 1) / 2) * 0.3, 1.95 + (3 - k) * 0.4, 0.2);
        const ang = rnd() * Math.PI * 2;
        const rad = Math.sqrt(rnd()) * 0.62;
        const bed = new Vector3(
          sx * 0.82 + Math.cos(ang) * rad,
          BED_TOP + 0.1 + rnd() * 0.2,
          Math.sin(ang) * rad * 0.6,
        );
        const a = (p === 0 ? Math.PI / 2 : -Math.PI / 2) + ((local + 0.5) / total) * Math.PI;
        const r = 0.5 + rnd() * 0.16;
        const crux = new Vector3(
          CRUX_POS.x + Math.cos(a) * r,
          CRUX_POS.y + Math.sin(a) * r * 0.85,
          CRUX_POS.z + (rnd() - 0.5) * 0.2,
        );
        frags.push({
          mesh,
          idx: j,
          party: p,
          inner,
          sorted,
          bed,
          crux,
          axis: new Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(),
          phase: rnd() * 6.28,
          delay: rnd(),
          spin: 0.4 + rnd() * 0.8,
        });
      }
    }
  }

  const v = new Vector3();
  const tmp = new Vector3();
  const centre = new Vector3();
  const point = new Vector3();
  const dummy = new Object3D();
  const q4 = new Quaternion();

  return {
    /** Visible while pieces are out of the spheres and not yet collapsed. */
    update(pose: Pose, time: number, a: Vec3, b: Vec3, glowAt: Vec3, small: boolean) {
      const on = pose.split * (1 - pose.reform) * (1 - pose.collapse);
      const show = on > 0.002;
      for (const m of meshes) m.visible = show;
      if (!show) return;
      const base = small ? 0.17 : 0.155;
      point.set(glowAt.x, glowAt.y, glowAt.z);
      for (const f of frags) {
        const d = f.delay * 0.35;
        const sp = clamp01((pose.split - d) / 0.65);
        const sk = clamp01((pose.sink - d) / 0.65);
        const mt = clamp01((pose.meet - d * 0.6) / 0.75);
        const cl = clamp01((pose.collapse - d * 0.3) / 0.7);
        const rf = clamp01((pose.reform - d * 0.4) / 0.6);
        const c = f.party === 0 ? a : b;
        centre.set(c.x, c.y, c.z);
        v.copy(f.inner).add(centre);
        tmp.copy(f.sorted);
        tmp.y += Math.sin(time * 1.1 + f.phase) * 0.035;
        v.lerp(tmp, sp);
        v.lerp(f.bed, sk);
        tmp.copy(f.crux);
        tmp.y += Math.sin(time * 1.6 + f.phase) * 0.02;
        v.lerp(tmp, mt);
        v.lerp(point, cl);
        tmp.copy(f.inner).multiplyScalar(0.5).add(centre);
        v.lerp(tmp, rf);
        const sc = base * sp * (1 - rf) * (1 - 0.3 * mt) * (1 - cl);
        dummy.position.copy(v);
        q4.setFromAxisAngle(f.axis, time * f.spin + f.phase);
        dummy.quaternion.copy(q4);
        dummy.scale.setScalar(Math.max(sc, 1e-4));
        dummy.updateMatrix();
        f.mesh.setMatrixAt(f.idx, dummy.matrix);
      }
      for (const m of meshes) m.instanceMatrix.needsUpdate = true;
    },
  };
}
