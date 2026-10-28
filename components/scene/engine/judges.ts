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
import { PALETTE, greenParty, type Party } from "@/lib/palette";
import type { Vote } from "@/lib/scene-bridge";
import {
  MAX_ORBS,
  ORB_SPLIT_POS,
  PIVOT_Y,
  bump,
  easeOutBack,
  lerp,
  orbRadius,
  orbSlots,
  orbitPoint,
  ss,
  voteAt,
  type Pose,
  type Vec3,
} from "@/lib/scene-poses";
import type { Bin, Materials } from "./materials";

/**
 * The judge orbs. They fan out of the crux point into an arc behind and
 * above the pivot. Neutral orbs are ivory with a thin ink ring; a vote turns
 * an orb its side's colour with a soft halo: saturated terra for the red
 * side, sage-ink for the green one, so a vote reads at a glance and is never
 * confused with the green side's lighter sphere. "Other" votes (split, conditional, dissolved) keep the
 * hollow ink ring. On the verdict, voting orbs fly into their cup and other
 * votes sink into the pivot.
 *
 * While the judges deliberate the orbs drift on a slow ring and each one
 * pulses faintly at its own rate. A revealed vote pops the orb once, the
 * pops spaced at least POP_GAP apart.
 */

/** One side of the hero/story blend. */
export type OrbSource = { pose: Pose; votes: readonly Vote[] | null; n: number };

type OrbLook = {
  pos: Vector3;
  scale: number;
  wa: number;
  wb: number;
  /** Reveal progress of any vote, "other" included. */
  rev: number;
  absorbA: number;
  absorbB: number;
};

const POP_S = 0.35;
const POP_GAP = 0.12;

const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

export function createJudges(scene: Scene, mats: Materials, bin: Bin, opts: { shadows: boolean }) {
  const geo = bin.add(new SphereGeometry(1, 40, 28));
  const ringGeo = bin.add(new TorusGeometry(1.14, 0.07, 10, 64));
  const neutral = new Color(PALETTE.paper);
  const voteA = new Color();
  const voteB = new Color();
  const paintSides = (you: Party | null) => {
    const green = greenParty(you);
    voteA.set(green === "a" ? PALETTE.sageInk : PALETTE.terra);
    voteB.set(green === "b" ? PALETTE.sageInk : PALETTE.terra);
  };
  paintSides(null);
  const black = new Color(0x000000);
  const warm = new Color(PALETTE.terraTint);

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
    return { mesh, mat, ring, ringMat, halo, haloMat, at: new Vector3(), r: 0, ready: false, popAt: Number.NaN };
  });

  const split = new Vector3(ORB_SPLIT_POS.x, ORB_SPLIT_POS.y, ORB_SPLIT_POS.z);
  const pivot = new Vector3(0, PIVOT_Y, 0);
  const sa = new Vector3();
  const sb = new Vector3();
  const tmp = new Vector3();
  const storySlot = new Vector3();
  const drift = new Vector3();
  const looks: [OrbLook, OrbLook] = [
    { pos: new Vector3(), scale: 0, wa: 0, wb: 0, rev: 0, absorbA: 0, absorbB: 0 },
    { pos: new Vector3(), scale: 0, wa: 0, wb: 0, rev: 0, absorbA: 0, absorbB: 0 },
  ];
  let clock = 0;
  let ringT = 0;
  let lastPop = -Infinity;
  const col = new Color();
  const emi = new Color();

  function look(out: OrbLook, i: number, src: OrbSource, at: Vector3, radius: number): OrbLook {
    const { pose, votes, n } = src;
    const fan = ss(0.35, 0.9, pose.orbs);
    out.pos.copy(split).lerp(at, easeOutBack(fan));
    const v = votes?.[i];
    const r = v ? voteAt(i, n, pose.votes) : 0;
    out.rev = r;
    out.wa = v === "a" ? r : 0;
    out.wb = v === "b" ? r : 0;
    const d = v ? easeInOut(voteAt(i, n, pose.drop)) : 0;
    if (d > 0) out.pos.lerp(v === "a" ? sa : v === "b" ? sb : pivot, d);
    const gone = ss(0.6, 1, d);
    out.scale = radius * fan * (1 - gone);
    out.absorbA = v === "a" ? gone : 0;
    out.absorbB = v === "b" ? gone : 0;
    return out;
  }

  return {
    paintSides,
    /** Returns how many votes each sphere has absorbed (for a weight bump). */
    update(
      hero: OrbSource,
      story: OrbSource,
      w: number,
      time: number,
      ambientDt: number,
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
      clock += dt;
      // The ring starts turning when the orbs leave the arc, so they ease onto
      // it in the slots' order. Only the hero orbits; the story never does.
      ringT = hero.pose.orbit > 0 ? ringT + ambientDt : 0;
      const orbit = lerp(hero.pose.orbit, story.pose.orbit, w);
      let absorbA = 0;
      let absorbB = 0;
      orbs.forEach((o, i) => {
        // Eased, so an escalation that changes the orb count mid-air moves the
        // panel over instead of jumping: new orbs grow out of the split point,
        // dropped ones shrink where they are.
        const slot = heroSlots[i];
        if (slot) {
          tmp.set(slot.x, slot.y, slot.z);
          if (hero.pose.orbit > 0) tmp.lerp(orbitPoint(i, hero.n, ringT, drift), hero.pose.orbit);
        } else tmp.copy(o.r > 0.004 ? o.at : split);
        const r = slot ? orbRadius(hero.n) : 0;
        if (!o.ready || snap) {
          o.at.copy(tmp);
          o.r = r;
          o.ready = true;
        } else {
          o.at.lerp(tmp, k);
          o.r += (r - o.r) * k;
        }
        const sSlot = storySlots[i] ?? ORB_SPLIT_POS;
        storySlot.set(sSlot.x, sSlot.y, sSlot.z);
        const h = look(looks[0], i, hero, o.at, o.r);
        const s = look(looks[1], i, story, storySlot, i < story.n ? orbRadius(story.n) : 0);

        const wa = lerp(h.wa, s.wa, w);
        const wb = lerp(h.wb, s.wb, w);
        const rev = lerp(h.rev, s.rev, w);
        if (rev < 0.01) o.popAt = Number.NaN;
        else if (Number.isNaN(o.popAt)) {
          // A snapped frame shows the vote without the pop.
          o.popAt = snap ? -Infinity : Math.max(clock, lastPop + POP_GAP);
          if (!snap) lastPop = o.popAt;
        }
        const scale = lerp(h.scale, s.scale, w) * (1 + 0.25 * bump((clock - o.popAt) / POP_S));
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
        // Deliberation pulse. With the rate linear in i a linear phase would
        // line every orb up every 17 s; a quadratic one keeps the panel from
        // ever brightening in step.
        const beat = orbit * (1 - voted) * (0.5 + 0.5 * Math.sin(time * (1.1 + 0.37 * i) + i * i * 2.4));
        col.copy(neutral).multiplyScalar((1 - voted) * (0.9 + 0.1 * beat));
        col.add(emi.copy(voteA).multiplyScalar(wa));
        col.add(emi.copy(voteB).multiplyScalar(wb));
        o.mat.color.copy(col);
        emi.copy(black).add(col.copy(voteA).multiplyScalar(wa)).add(col.copy(voteB).multiplyScalar(wb));
        emi.add(col.copy(warm).multiplyScalar(0.5 * beat));
        o.mat.emissive.copy(emi);
        o.ringMat.opacity = 0.85 * (1 - voted);
        o.haloMat.color.copy(wa >= wb ? voteA : voteB);
        o.haloMat.opacity = 0.42 * voted;
      });
      return { absorbA, absorbB };
    },
  };
}
