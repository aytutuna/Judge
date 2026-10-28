import { Scene } from "three";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createBalance } from "../components/scene/engine/balance";
import { createBin, createMaterials } from "../components/scene/engine/materials";
import { PALETTE } from "../lib/palette";

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
    balance.paintSides("b");
    expect(hex(mats.partyA.color)).toBe(PALETTE.terra);
    expect(hex(mats.partyB.color)).toBe(PALETTE.sage);
    expect(hex(mats.partyB.emissive)).toBe(PALETTE.sage);
    balance.paintSides("a");
    expect(hex(mats.partyA.color)).toBe(PALETTE.sage);
  });
});
