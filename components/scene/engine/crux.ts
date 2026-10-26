import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PointLight,
  Points,
  Sprite,
  TorusGeometry,
  type Scene,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { PALETTE, PALETTE_NUM } from "@/lib/palette";
import {
  BED_TOP,
  CRUX_POS,
  ORB_SPLIT_POS,
  PIVOT_Y,
  bump,
  clamp01,
  easeOutBack,
  lerp,
  ss,
  type Pose,
  type Vec3,
} from "@/lib/scene-poses";
import type { Bin, Materials } from "./materials";

/** Largest radius of the ripple the gem sends out when the pieces arrive
 * (test/scene-card.test.ts keeps it inside the card). */
export const RIPPLE_R = 0.95;
/** How far the ember motes rise above the glowing point. */
export const MOTE_RISE = 0.7;
const MOTES = 10;

/**
 * The bedrock cutaway, the crux (gem and ring) and the glowing point the
 * pieces collapse into. The point then rises above the pivot, where it
 * splits into the judge orbs (see judges.ts). The point light is always in
 * the scene at intensity 0 when off: adding or removing lights recompiles
 * every shader.
 *
 * When the pieces arrive around the crux the gem wakes: its emissive ramps
 * up, a halo breathes behind it, one ripple runs out and a few motes rise.
 * Small screens keep the halo only.
 */
export function createCrux(scene: Scene, mats: Materials, bin: Bin, opts: { small: boolean }) {
  const under = new Group();
  scene.add(under);
  const bedrock = new Mesh(bin.add(new RoundedBoxGeometry(5.0, 0.34, 1.7, 3, 0.06)), mats.stone);
  bedrock.position.y = BED_TOP - 0.17;
  bedrock.receiveShadow = true;
  under.add(bedrock);
  [-0.42, -0.8, -1.16].forEach((y, i) => {
    const s = new Mesh(bin.add(new BoxGeometry(4.8 - i * 0.1, 0.022, 1.6)), mats.strata[i]);
    s.position.y = y;
    under.add(s);
  });

  const gem = new Mesh(bin.add(new OctahedronGeometry(0.2, 0)), mats.gem);
  const ring = new Mesh(bin.add(new TorusGeometry(0.34, 0.012, 12, 96)), mats.ink);
  const cruxGroup = new Group();
  cruxGroup.add(gem, ring);
  cruxGroup.position.set(CRUX_POS.x, CRUX_POS.y, CRUX_POS.z);
  scene.add(cruxGroup);

  const rippleMat = bin.add(
    new MeshBasicMaterial({ color: PALETTE.terra, transparent: true, depthWrite: false, opacity: 0 }),
  );
  const ripple = new Mesh(bin.add(new TorusGeometry(1, 0.026, 8, 96)), rippleMat);
  ripple.visible = false;
  scene.add(ripple);

  const moteGeo = bin.add(new BufferGeometry());
  const motePos = new BufferAttribute(new Float32Array(MOTES * 3), 3).setUsage(DynamicDrawUsage);
  const moteCol = new BufferAttribute(new Float32Array(MOTES * 4).fill(1), 4).setUsage(DynamicDrawUsage);
  moteGeo.setAttribute("position", motePos);
  moteGeo.setAttribute("color", moteCol);
  const motes = new Points(moteGeo, mats.motes);
  motes.frustumCulled = false;
  motes.visible = false;
  scene.add(motes);

  const glowMat = mats.glow(PALETTE.terra);
  const glow = new Sprite(glowMat);
  scene.add(glow);
  const haloMat = mats.glow(PALETTE.terra);
  const halo = new Sprite(haloMat);
  scene.add(halo);
  const coreMat = mats.glow(PALETTE.paper);
  const core = new Sprite(coreMat);
  scene.add(core);
  const light = new PointLight(PALETTE_NUM.terra, 0, 3.5, 2);
  scene.add(light);

  const at: Vec3 = { x: 0, y: 0, z: 0 };
  const src: Vec3 = { x: 0, y: 0, z: 0 };
  const ABOVE: Vec3 = { x: 0, y: PIVOT_Y + 0.7, z: 0.2 };
  const dim = new Color(PALETTE.terraInk);
  const hot = new Color(PALETTE.terra);
  let wake = 0;
  let armed = false;
  let clock = 0;
  let rippleAt = -1;
  let moteTime = 0;

  return {
    /** Current position of the glowing point (fragments converge on it). */
    glowAt: at,
    update(pose: Pose, time: number, dt: number, realDt: number, snap: boolean) {
      clock += dt;
      // The ambient clock stops when a verdict lands for an idle user; the
      // motes keep rising on real time while they fade instead of hanging.
      moteTime += realDt;
      // Where the point is: at the crux, rising to the split as orbs form.
      // Without the cutaway the crux is out of sight under the floor, so the
      // point forms above the pivot instead.
      const below = pose.camDown;
      const fromX = lerp(ABOVE.x, CRUX_POS.x, below);
      const fromY = lerp(ABOVE.y, CRUX_POS.y, below);
      const fromZ = lerp(ABOVE.z, CRUX_POS.z, below);
      const rise = ss(0, 0.5, pose.orbs);
      at.x = lerp(fromX, ORB_SPLIT_POS.x, rise);
      at.y = lerp(fromY, ORB_SPLIT_POS.y, rise) + Math.sin(time * 1.4) * 0.03;
      at.z = lerp(fromZ, ORB_SPLIT_POS.z, rise);

      under.visible = pose.camDown > 0.002;
      mats.stone.opacity = pose.camDown;
      mats.strata.forEach((m, i) => {
        m.opacity = pose.camDown * (0.5 - i * 0.08);
      });

      // The gem wakes once the pieces have arrived around it.
      const arrived = pose.meet > 0.85 && pose.collapse < 0.5;
      if (snap) wake = arrived ? 1 : 0;
      else wake = clamp01(wake + (arrived ? dt : -dt) / 0.6);
      if (arrived && !armed) {
        armed = true;
        if (!snap && !opts.small) rippleAt = clock;
      } else if (pose.meet < 0.5) armed = false;
      const woke = ss(0, 1, wake);

      const gemAmt = pose.meet * (1 - pose.collapse);
      cruxGroup.visible = gemAmt > 0.002;
      cruxGroup.scale.setScalar(Math.max(easeOutBack(gemAmt), 1e-4));
      cruxGroup.position.y = CRUX_POS.y + Math.sin(time * 1.4) * 0.03;
      gem.rotation.y += dt * 0.9;
      gem.rotation.x = 0.3;
      ring.rotation.z += dt * 0.25;
      const heat = Math.max(woke, pose.collapse);
      mats.gem.emissive.lerpColors(dim, hot, heat);
      mats.gem.emissiveIntensity = Math.max(0.8 * pose.collapse, 0.85 * woke);

      const rk = rippleAt < 0 ? 1 : (clock - rippleAt) / 0.9;
      ripple.visible = rk < 1 && cruxGroup.visible;
      if (ripple.visible) {
        ripple.position.copy(cruxGroup.position);
        ripple.scale.setScalar(lerp(0.3, RIPPLE_R, 1 - Math.pow(1 - rk, 2.2)));
        rippleMat.opacity = 0.8 * Math.pow(1 - rk, 1.3) * gemAmt;
      }

      // Bright while the pieces converge, fading as it splits into orbs; a
      // faint ember stays while the judges deliberate.
      // The ember has no bright core: it should read as warmth behind the
      // orbs, not as a second point.
      const main = pose.collapse * (1 - ss(0.45, 0.9, pose.orbs));
      const amt = Math.min(1, main + pose.glow);
      const breath = 1 + 0.08 * Math.sin(time * 1.6);
      glow.position.set(at.x, at.y, at.z);
      core.position.set(at.x, at.y, at.z + 0.01);
      glow.scale.setScalar((0.5 + 0.9 * amt) * breath);
      core.scale.setScalar((0.16 + 0.3 * main) * breath);
      glowMat.opacity = 0.55 * amt;
      coreMat.opacity = 0.95 * main;
      glow.visible = amt > 0.003;
      core.visible = main > 0.003;

      // The awake gem's own halo, just behind it so the gem stays crisp.
      const lit = woke * gemAmt;
      const g = cruxGroup.position;
      halo.position.set(g.x, g.y, g.z - 0.12);
      halo.scale.setScalar(1.25 * (1 + 0.1 * Math.sin(time * 1.3)) * Math.max(gemAmt, 0.2));
      haloMat.opacity = 0.62 * lit;
      halo.visible = lit > 0.003;
      src.x = lerp(at.x, g.x, lit);
      src.y = lerp(at.y, g.y, lit);
      src.z = lerp(at.z, g.z, lit);
      light.position.set(src.x, src.y, src.z + 0.2);
      light.intensity = 2.2 * Math.max(amt, 0.8 * lit);

      const emit = opts.small || snap ? 0 : Math.max(lit, pose.orbit * pose.glow * 4);
      motes.visible = emit > 0.01;
      if (!motes.visible) return;
      for (let i = 0; i < MOTES; i++) {
        const u = (moteTime / 3.6 + i / MOTES) % 1;
        const s = i * 2.39;
        motePos.setXYZ(
          i,
          src.x + Math.sin(s) * 0.2 * (0.4 + u) + Math.sin(moteTime * 0.9 + s) * 0.03,
          src.y + 0.08 + u * MOTE_RISE,
          src.z + Math.cos(s) * 0.12,
        );
        moteCol.setW(i, 0.4 * emit * bump(u));
      }
      motePos.needsUpdate = true;
      moteCol.needsUpdate = true;
    },
  };
}
