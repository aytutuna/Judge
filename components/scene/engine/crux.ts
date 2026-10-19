import {
  BoxGeometry,
  Group,
  Mesh,
  OctahedronGeometry,
  PointLight,
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
  easeOutBack,
  lerp,
  ss,
  type Pose,
  type Vec3,
} from "@/lib/scene-poses";
import type { Bin, Materials } from "./materials";

/**
 * The bedrock cutaway, the crux (gem and ring) and the glowing point the
 * pieces collapse into. The point then rises above the pivot, where it
 * splits into the judge orbs (see judges.ts). The point light is always in
 * the scene at intensity 0 when off: adding or removing lights recompiles
 * every shader.
 */
export function createCrux(scene: Scene, mats: Materials, bin: Bin) {
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

  const glowMat = mats.glow(PALETTE.terra);
  const glow = new Sprite(glowMat);
  scene.add(glow);
  const coreMat = mats.glow(PALETTE.paper);
  const core = new Sprite(coreMat);
  scene.add(core);
  const light = new PointLight(PALETTE_NUM.terra, 0, 3.5, 2);
  scene.add(light);

  const at: Vec3 = { x: 0, y: 0, z: 0 };
  const ABOVE: Vec3 = { x: 0, y: PIVOT_Y + 0.7, z: 0.2 };

  return {
    /** Current position of the glowing point (fragments converge on it). */
    glowAt: at,
    update(pose: Pose, time: number, dt: number) {
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

      const gemAmt = pose.meet * (1 - pose.collapse);
      cruxGroup.visible = gemAmt > 0.002;
      cruxGroup.scale.setScalar(Math.max(easeOutBack(gemAmt), 1e-4));
      cruxGroup.position.y = CRUX_POS.y + Math.sin(time * 1.4) * 0.03;
      gem.rotation.y += dt * 0.9;
      gem.rotation.x = 0.3;
      ring.rotation.z += dt * 0.25;
      mats.gem.emissiveIntensity = 0.8 * pose.collapse;

      // Bright while the pieces converge, fading as it splits into orbs; a
      // faint ember stays while the judges deliberate.
      // The ember has no bright core: it should read as warmth behind the
      // orbs, not as a second point.
      const main = pose.collapse * (1 - ss(0.45, 0.9, pose.orbs));
      const amt = Math.min(1, main + pose.glow);
      const pulse = 1 + 0.06 * Math.sin(time * 3.1);
      glow.position.set(at.x, at.y, at.z);
      core.position.set(at.x, at.y, at.z + 0.01);
      glow.scale.setScalar((0.5 + 0.9 * amt) * pulse);
      core.scale.setScalar((0.16 + 0.3 * main) * pulse);
      glowMat.opacity = 0.55 * amt;
      coreMat.opacity = 0.95 * main;
      glow.visible = amt > 0.003;
      core.visible = main > 0.003;
      light.position.set(at.x, at.y, at.z + 0.2);
      light.intensity = 2.2 * amt;
    },
  };
}
