import {
  Color,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  SphereGeometry,
  Sprite,
  TorusGeometry,
  Vector3,
  type Quaternion,
  type Scene,
} from "three";
import { PALETTE } from "@/lib/palette";
import type { Vote } from "@/lib/scene-bridge";
import {
  MAX_ORBS,
  ORB_SPLIT_POS,
  PIVOT_Y,
  easeOutBack,
  lerp,
  orbRadius,
  orbSlots,
  ss,
  voteAt,
  type Pose,
  type Vec3,
} from "@/lib/scene-poses";
import type { Bin, Materials } from "./materials";

/**
 * The judge orbs. They fan out of the crux point into an arc behind and
 * above the pivot. Neutral orbs are ivory with a thin ink ring; a vote turns
 * an orb saturated terra (Party A) or sage-ink (Party B) with a soft halo, so
 * a vote reads at a glance and "sage = a vote" is never confused with "sage =
 * Party B's sphere". "Other" votes (split, conditional, dissolved) keep the
 * hollow ink ring. On the verdict, voting orbs fly into their cup and other
 * votes sink into the pivot.
 */

/** One side of the hero/story blend. */
export type OrbSource = { pose: Pose; votes: readonly Vote[] | null; n: number };

type OrbLook = { pos: Vector3; scale: number; wa: number; wb: number; absorbA: number; absorbB: number };

const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

export function createJudges(scene: Scene, mats: Materials, bin: Bin, opts: { shadows: boolean }) {
  const geo = bin.add(new SphereGeometry(1, 40, 28));
  const ringGeo = bin.add(new TorusGeometry(1.14, 0.07, 10, 64));
  const neutral = new Color(PALETTE.paper);
  const terra = new Color(PALETTE.terra);
  const sage = new Color(PALETTE.sageInk);
  const black = new Color(0x000000);

  const orbs = Array.from({ length: MAX_ORBS }, () => {
    const mat = bin.add(
      new MeshPhysicalMaterial({
        color: neutral.clone(),
        roughness: 0.32,
        clearcoat: 1,
        clearcoatRoughness: 0.15,
        emissive: black.clone(),
        emissiveIntensity: 0.6,
      }),
    );
    const mesh = new Mesh(geo, mat);
    mesh.castShadow = opts.shadows;
    scene.add(mesh);
    const ringMat = bin.add(
      new MeshBasicMaterial({ color: PALETTE.ink, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    const ring = new Mesh(ringGeo, ringMat);
    scene.add(ring);
    const haloMat = mats.glow(PALETTE.paper);
    const halo = new Sprite(haloMat);
    scene.add(halo);
    return { mesh, mat, ring, ringMat, halo, haloMat, slot: new Vector3(), slotReady: false };
  });

  const split = new Vector3(ORB_SPLIT_POS.x, ORB_SPLIT_POS.y, ORB_SPLIT_POS.z);
  const pivot = new Vector3(0, PIVOT_Y, 0);
  const sa = new Vector3();
  const sb = new Vector3();
  const tmp = new Vector3();
  const storySlot = new Vector3();
  const looks: [OrbLook, OrbLook] = [
    { pos: new Vector3(), scale: 0, wa: 0, wb: 0, absorbA: 0, absorbB: 0 },
    { pos: new Vector3(), scale: 0, wa: 0, wb: 0, absorbA: 0, absorbB: 0 },
  ];
  const col = new Color();
  const emi = new Color();

  function look(
    out: OrbLook,
    i: number,
    src: OrbSource,
    slot: Vector3,
    time: number,
  ): OrbLook {
    const { pose, votes, n } = src;
    const fan = ss(0.35, 0.9, pose.orbs);
    tmp.copy(slot);
    if (pose.orbit > 0) {
      tmp.x += Math.sin(time * 0.5 + i * 2.1) * 0.07 * pose.orbit;
      tmp.y += Math.cos(time * 0.7 + i * 1.3) * 0.05 * pose.orbit;
      tmp.z += Math.sin(time * 0.4 + i) * 0.05 * pose.orbit;
    }
    out.pos.copy(split).lerp(tmp, easeOutBack(fan));
    const v = votes?.[i];
    const r = v ? voteAt(i, n, pose.votes) : 0;
    out.wa = v === "a" ? r : 0;
    out.wb = v === "b" ? r : 0;
    const d = v ? easeInOut(voteAt(i, n, pose.drop)) : 0;
    if (d > 0) out.pos.lerp(v === "a" ? sa : v === "b" ? sb : pivot, d);
    const gone = ss(0.6, 1, d);
    out.scale = i < n ? orbRadius(n) * fan * (1 - gone) : 0;
    out.absorbA = v === "a" ? gone : 0;
    out.absorbB = v === "b" ? gone : 0;
    return out;
  }

  return {
    /** Returns how many votes each sphere has absorbed (for a weight bump). */
    update(
      hero: OrbSource,
      story: OrbSource,
      w: number,
      time: number,
      dt: number,
      sphereA: Vec3,
      sphereB: Vec3,
      cameraQuat: Quaternion,
      snap: boolean,
    ): { absorbA: number; absorbB: number } {
      sa.set(sphereA.x, sphereA.y, sphereA.z);
      sb.set(sphereB.x, sphereB.y, sphereB.z);
      const heroSlots = orbSlots(hero.n);
      const storySlots = orbSlots(story.n);
      const k = snap ? 1 : 1 - Math.exp(-dt * 6);
      let absorbA = 0;
      let absorbB = 0;
      orbs.forEach((o, i) => {
        // Hero slots ease when an escalation changes the orb count mid-air.
        const target = heroSlots[i] ?? storySlots[i] ?? ORB_SPLIT_POS;
        if (!o.slotReady || snap) {
          o.slot.set(target.x, target.y, target.z);
          o.slotReady = true;
        } else o.slot.lerp(tmp.set(target.x, target.y, target.z), k);
        const sSlot = storySlots[i] ?? heroSlots[i] ?? ORB_SPLIT_POS;
        const h = look(looks[0], i, hero, o.slot, time);
        const s = look(looks[1], i, story, storySlot.set(sSlot.x, sSlot.y, sSlot.z), time);

        const scale = lerp(h.scale, s.scale, w);
        const wa = lerp(h.wa, s.wa, w);
        const wb = lerp(h.wb, s.wb, w);
        absorbA += lerp(h.absorbA, s.absorbA, w);
        absorbB += lerp(h.absorbB, s.absorbB, w);
        const visible = scale > 0.004;
        o.mesh.visible = o.ring.visible = visible;
        o.halo.visible = visible && wa + wb > 0.01;
        if (!visible) return;
        const pos = h.pos.lerp(s.pos, w);
        o.mesh.position.copy(pos);
        o.mesh.scale.setScalar(scale);
        o.ring.position.copy(pos);
        o.ring.quaternion.copy(cameraQuat);
        o.ring.scale.setScalar(scale);
        o.halo.position.copy(pos);
        o.halo.scale.setScalar(scale * 5.5);

        const voted = Math.min(1, wa + wb);
        col.copy(neutral).multiplyScalar(1 - voted);
        col.add(emi.copy(terra).multiplyScalar(wa));
        col.add(emi.copy(sage).multiplyScalar(wb));
        o.mat.color.copy(col);
        emi.copy(black).add(col.copy(terra).multiplyScalar(wa)).add(col.copy(sage).multiplyScalar(wb));
        o.mat.emissive.copy(emi);
        o.ringMat.opacity = 0.85 * (1 - voted);
        o.haloMat.color.copy(wa >= wb ? terra : sage);
        o.haloMat.opacity = 0.42 * voted;
      });
      return { absorbA, absorbB };
    },
  };
}
