import { Scene } from "three";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createBalance } from "../components/scene/engine/balance";
import { createBin, createMaterials } from "../components/scene/engine/materials";
import { LOOKS } from "../components/scene/engine/theme";
import { PALETTE, PALETTE_DARK } from "../lib/palette";

const hex = (c: { getHexString(): string }) => `#${c.getHexString().toUpperCase()}`;

describe("scene side colours", () => {
  // The materials draw two small gradient textures; no canvas is needed here.
  vi.stubGlobal("document", { createElement: () => ({ getContext: () => null }) });
  afterAll(() => vi.unstubAllGlobals());
  const bin = createBin();
  const mats = createMaterials(bin);
  const balance = createBalance(new Scene(), mats, bin, { segments: 8, shadows: false });

  it("paints Party A's sphere green by default (writer or nobody known)", () => {
    expect(hex(mats.partyA.color)).toBe(PALETTE.sage);
    expect(hex(mats.partyB.color)).toBe(PALETTE.terra);
    expect(hex(mats.partyA.sheenColor)).toBe(PALETTE.sageTint);
  });

  it("swaps when the viewer is Party B, and back", () => {
    balance.paint("b", LOOKS.light);
    expect(hex(mats.partyA.color)).toBe(PALETTE.terra);
    expect(hex(mats.partyB.color)).toBe(PALETTE.sage);
    expect(hex(mats.partyB.emissive)).toBe(PALETTE.sage);
    balance.paint("a", LOOKS.light);
    expect(hex(mats.partyA.color)).toBe(PALETTE.sage);
  });

  it("takes the dark sides and keeps a dark beam on light plaster under the dark theme", () => {
    mats.paint(LOOKS.dark);
    balance.paint(null, LOOKS.dark);
    expect(hex(mats.partyA.color)).toBe(PALETTE_DARK.sage);
    expect(hex(mats.partyB.color)).toBe(PALETTE_DARK.terra);
    expect(hex(mats.ink.color)).toBe(PALETTE_DARK.strata);
    expect(hex(mats.plinth.color)).toBe(PALETTE_DARK.muted);
    expect(hex(mats.ground.color)).toBe("#000000");
    mats.paint(LOOKS.light);
    expect(hex(mats.ink.color)).toBe(PALETTE.ink);
    expect(hex(mats.plinth.color)).toBe(PALETTE.ivory2);
  });
});
