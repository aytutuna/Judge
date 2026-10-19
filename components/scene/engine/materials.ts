import {
  CanvasTexture,
  Color,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NormalBlending,
  ShadowMaterial,
  SpriteMaterial,
  SRGBColorSpace,
  type Texture,
} from "three";
import { PALETTE, PALETTE_NUM } from "@/lib/palette";

/**
 * Every material of the scene, built from lib/palette.ts. Flags that force a
 * shader recompile (transparent, blending) are fixed here once and never
 * toggled at runtime; only colours, opacities and intensities animate.
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

function rgbOf(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

export function createMaterials(bin: Bin) {
  const ink = bin.add(
    new MeshPhysicalMaterial({
      color: PALETTE_NUM.ink,
      roughness: 0.38,
      metalness: 0,
      clearcoat: 0.5,
      clearcoatRoughness: 0.35,
    }),
  );
  const plaster = bin.add(new MeshStandardMaterial({ color: PALETTE_NUM.ivory2, roughness: 0.92 }));

  const sphere = (color: number, sheen: string) =>
    bin.add(
      new MeshPhysicalMaterial({
        color,
        roughness: 0.6,
        clearcoat: 0.18,
        clearcoatRoughness: 0.55,
        sheen: 0.5,
        sheenColor: new Color(sheen),
        sheenRoughness: 0.7,
      }),
    );
  const partyA = sphere(PALETTE_NUM.terra, PALETTE.terraTint);
  const partyB = sphere(PALETTE_NUM.sage, PALETTE.sageTint);

  const stone = bin.add(
    new MeshStandardMaterial({ color: PALETTE_NUM.stone, roughness: 0.95, transparent: true, opacity: 0 }),
  );
  const strata = [0, 1, 2].map(() =>
    bin.add(
      new MeshStandardMaterial({
        color: PALETTE_NUM.strata,
        roughness: 1,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    ),
  );
  const gem = bin.add(
    new MeshPhysicalMaterial({
      color: PALETTE_NUM.ink,
      roughness: 0.18,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      emissive: new Color(PALETTE.terra),
      emissiveIntensity: 0,
    }),
  );

  // The page is ivory, so additive light would vanish; glows are soft
  // normal-blended gradients instead.
  const shadowTex = radialTexture(bin, rgbOf(PALETTE.ink2), [
    [0, 0.55],
    [0.45, 0.22],
    [1, 0],
  ]);
  const glowTex = radialTexture(bin, "255,255,255", [
    [0, 1],
    [0.25, 0.55],
    [1, 0],
  ]);

  const blob = (opacity: number) =>
    bin.add(new MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity }));
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
  const ground = bin.add(new ShadowMaterial({ color: PALETTE_NUM.ink2, opacity: 0.12 }));

  return { ink, plaster, partyA, partyB, stone, strata, gem, blob, glow, ground };
}

export type Materials = ReturnType<typeof createMaterials>;
