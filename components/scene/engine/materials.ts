import {
  CanvasTexture,
  Color,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NormalBlending,
  PointsMaterial,
  ShadowMaterial,
  SpriteMaterial,
  SRGBColorSpace,
  type Texture,
} from "three";
import { PALETTE } from "@/lib/palette";
import { LOOKS, type SceneLook } from "./theme";

/**
 * Every material of the scene, built from lib/palette.ts; paint() sets the
 * colours that follow the theme. Flags that force a shader recompile
 * (transparent, blending) are fixed here once and never toggled at runtime;
 * only colours, opacities and intensities animate.
 */

/** Things the engine must free on dispose. */
export type Bin = { add<T extends { dispose(): void }>(x: T): T; drain(): void };

export function createBin(): Bin {
  const items: { dispose(): void }[] = [];
  return {
    add(x) {
      items.push(x);
      return x;
    },
    drain() {
      for (const x of items.splice(0)) x.dispose();
    },
  };
}

/** Soft radial gradient (centre colour to transparent) on a small canvas. */
export function radialTexture(bin: Bin, rgb: string, stops: readonly [number, number][]): Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  if (g) {
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    for (const [at, alpha] of stops) r.addColorStop(at, `rgba(${rgb},${alpha})`);
    g.fillStyle = r;
    g.fillRect(0, 0, 128, 128);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return bin.add(t);
}

/** Light centre, slightly darker rim: a multiply map so the plinth top is
 * not a flat slab. */
function shadeTexture(bin: Bin): Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  if (g) {
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 90);
    r.addColorStop(0, "#ffffff");
    r.addColorStop(0.55, "#fafafa");
    r.addColorStop(1, "#e4e4e4");
    g.fillStyle = r;
    g.fillRect(0, 0, 128, 128);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return bin.add(t);
}

export function createMaterials(bin: Bin) {
  const ink = bin.add(
    new MeshPhysicalMaterial({
      roughness: 0.38,
      metalness: 0,
      clearcoat: 0.5,
      clearcoatRoughness: 0.35,
    }),
  );
  const plaster = bin.add(new MeshStandardMaterial({ roughness: 0.92 }));
  const plinth = bin.add(new MeshStandardMaterial({ roughness: 0.92, map: shadeTexture(bin) }));

  // Party colours are painted by the balance (paintSides) once the viewer's
  // side is known.
  const sphere = () =>
    bin.add(
      new MeshPhysicalMaterial({
        roughness: 0.58,
        clearcoat: 0.45,
        clearcoatRoughness: 0.28,
        sheen: 0.5,
        sheenRoughness: 0.7,
      }),
    );
  const partyA = sphere();
  const partyB = sphere();

  const stone = bin.add(new MeshStandardMaterial({ roughness: 0.95, transparent: true, opacity: 0 }));
  const strata = [0, 1, 2].map(() =>
    bin.add(
      new MeshStandardMaterial({
        roughness: 1,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    ),
  );
  const gem = bin.add(
    new MeshPhysicalMaterial({
      roughness: 0.18,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      emissive: new Color(PALETTE.terra),
      emissiveIntensity: 0,
    }),
  );

  // The page is ivory, so additive light would vanish; glows are soft
  // normal-blended gradients instead. The shadow gradient is white and takes
  // the theme's shadow colour from each blob material.
  const shadowTex = radialTexture(bin, "255,255,255", [
    [0, 0.55],
    [0.45, 0.22],
    [1, 0],
  ]);
  const glowTex = radialTexture(bin, "255,255,255", [
    [0, 1],
    [0.25, 0.55],
    [1, 0],
  ]);

  const ringTex = radialTexture(bin, "255,255,255", [
    [0, 0],
    [0.5, 0],
    [0.78, 0.85],
    [0.9, 0.3],
    [1, 0],
  ]);

  const blobs: MeshBasicMaterial[] = [];
  const blob = (opacity: number) => {
    const m = bin.add(new MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity }));
    blobs.push(m);
    return m;
  };
  const glow = (color: string) =>
    bin.add(
      new SpriteMaterial({
        map: glowTex,
        color: new Color(color),
        transparent: true,
        depthWrite: false,
        blending: NormalBlending,
        opacity: 0,
      }),
    );
  const ring = (color: string) =>
    bin.add(
      new MeshBasicMaterial({ map: ringTex, color: new Color(color), transparent: true, depthWrite: false, opacity: 0 }),
    );
  const motes = bin.add(
    new PointsMaterial({
      map: glowTex,
      color: new Color(PALETTE.terra),
      size: 0.2,
      transparent: true,
      depthWrite: false,
      vertexColors: true,
    }),
  );
  // No depth write: in the cutaway the crux and its glow sit below the floor
  // plane, which would otherwise hide every transparent thing under it.
  const ground = bin.add(new ShadowMaterial({ opacity: 0.16, depthWrite: false }));

  function paint(look: SceneLook) {
    ink.color.set(look.beam);
    gem.color.set(look.beam);
    plaster.color.set(look.plaster);
    plinth.color.set(look.plaster);
    stone.color.set(look.stone);
    for (const m of strata) m.color.set(look.strata);
    ground.color.set(look.shadow);
    for (const m of blobs) m.color.set(look.shadow);
  }

  paint(LOOKS.light);

  return { ink, plaster, plinth, partyA, partyB, stone, strata, gem, blob, glow, ring, motes, ground, paint };
}

export type Materials = ReturnType<typeof createMaterials>;
