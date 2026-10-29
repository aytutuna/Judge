import { PALETTE, PALETTE_DARK } from "@/lib/palette";
import type { SceneTheme } from "@/lib/scene-bridge";

/**
 * What changes between the light and the dark scene. Dark keeps a dark beam
 * and light plaster rather than inverting, so the balance still reads as an
 * object on a near-black page; shadows go black and deeper, the key softens
 * and the rim strengthens to pick the beam's edges out. The flat SVG balance
 * (--scene-* in app/globals.css) has no rim light and goes light instead.
 */
export type SceneLook = {
  dark: boolean;
  beam: string;
  plaster: string;
  stone: string;
  strata: string;
  shadow: string;
  /** Multiplies every shadow and contact blob opacity. */
  shade: number;
  key: number;
  rim: number;
  bounce: number;
  exposure: number;
  /** The judges' votes: green for the viewer's side, red for the other. */
  voteGreen: string;
  voteRed: string;
};

export const LOOKS: Record<SceneTheme, SceneLook> = {
  light: {
    dark: false,
    beam: PALETTE.ink,
    plaster: PALETTE.ivory2,
    stone: PALETTE.stone,
    strata: PALETTE.strata,
    shadow: PALETTE.ink2,
    shade: 1,
    key: 2.6,
    rim: 1.4,
    bounce: 0xdcd9d4,
    exposure: 1,
    voteGreen: PALETTE.sageInk,
    voteRed: PALETTE.terra,
  },
  dark: {
    dark: true,
    beam: PALETTE_DARK.strata,
    plaster: PALETTE_DARK.muted,
    stone: PALETTE_DARK.stone,
    strata: PALETTE_DARK.strata,
    shadow: "#000000",
    shade: 2.4,
    key: 2.3,
    rim: 2.6,
    bounce: 0x4f463c,
    exposure: 0.94,
    voteGreen: PALETTE_DARK.sageInk,
    voteRed: PALETTE_DARK.terra,
  },
};
