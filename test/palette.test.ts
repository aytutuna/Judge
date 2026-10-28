import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PALETTE,
  PALETTE_ALPHA,
  PALETTE_NUM,
  contrast,
  cssVarName,
  greenParty,
  sideColors,
  type PaletteAlphaKey,
  type PaletteKey,
  type Party,
  type SideColors,
} from "../lib/palette";

const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

/** Declarations of the first `:root { ... }` block: the token block. */
function tokenBlock(source: string): Map<string, string> {
  const start = source.indexOf(":root {");
  expect(start, "globals.css has a :root block").toBeGreaterThanOrEqual(0);
  const end = source.indexOf("}", start);
  const body = source.slice(start + ":root {".length, end).replace(/\/\*[\s\S]*?\*\//g, "");
  const decls = new Map<string, string>();
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    decls.set(m[1], m[2].trim());
  }
  return decls;
}

const tokens = tokenBlock(css);
const squash = (s: string) => s.replace(/\s+/g, "").toLowerCase();

describe("palette", () => {
  it("maps keys to CSS custom property names", () => {
    expect(cssVarName("ivory2")).toBe("--ivory-2");
    expect(cssVarName("terraInk")).toBe("--terra-ink");
    expect(cssVarName("sageStrong")).toBe("--sage-strong");
    expect(cssVarName("ink2")).toBe("--ink-2");
    expect(cssVarName("line2")).toBe("--line-2");
  });

  it("every opaque palette colour is declared in globals.css with the same hex", () => {
    for (const key of Object.keys(PALETTE) as PaletteKey[]) {
      const name = cssVarName(key);
      expect(tokens.get(name), name).toBeDefined();
      expect(tokens.get(name)!.toUpperCase(), name).toBe(PALETTE[key].toUpperCase());
    }
  });

  it("every translucent palette colour is declared in globals.css with the same value", () => {
    for (const key of Object.keys(PALETTE_ALPHA) as PaletteAlphaKey[]) {
      const name = cssVarName(key);
      expect(tokens.get(name), name).toBeDefined();
      expect(squash(tokens.get(name)!), name).toBe(squash(PALETTE_ALPHA[key]));
    }
  });

  it("the token block declares nothing the palette does not know about", () => {
    const known = new Set(
      [...Object.keys(PALETTE), ...Object.keys(PALETTE_ALPHA)].map((k) =>
        cssVarName(k as PaletteKey),
      ),
    );
    expect([...tokens.keys()].filter((name) => !known.has(name))).toEqual([]);
  });

  it("hexes are well formed and numbers mirror them for three.js", () => {
    for (const key of Object.keys(PALETTE) as PaletteKey[]) {
      expect(PALETTE[key], key).toMatch(/^#[0-9A-F]{6}$/);
      expect(PALETTE_NUM[key], key).toBe(Number.parseInt(PALETTE[key].slice(1), 16));
    }
    expect(PALETTE_NUM.ivory).toBe(0xf6f1e9);
    expect(PALETTE_NUM.terra).toBe(0xc8553d);
  });

  it("is light only: no dark-mode media query", () => {
    expect(css).not.toMatch(/prefers-color-scheme\s*:\s*dark/);
    expect(css).toMatch(/color-scheme:\s*light;/);
  });
});

/** The --party-* declarations of the block opened by `selector`, as hexes. */
function sideBlock(selector: string): Record<Party, SideColors> {
  const start = css.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const body = css.slice(start, css.indexOf("}", start));
  const hex = new Map(
    (Object.keys(PALETTE) as PaletteKey[]).map((k) => [cssVarName(k), PALETTE[k] as string]),
  );
  const get = (name: string) => {
    const m = body.match(new RegExp(`${name}:\\s*var\\((--[a-z0-9-]+)\\);`));
    expect(m, name).not.toBeNull();
    return hex.get(m![1])!;
  };
  const side = (p: Party): SideColors => ({
    fill: get(`--party-${p}`),
    strong: get(`--party-${p}-strong`),
    ink: get(`--party-${p}-ink`),
    tint: get(`--party-${p}-tint`),
  });
  return { a: side("a"), b: side("b") };
}

describe("side colours", () => {
  const green = { fill: PALETTE.sage, strong: PALETTE.sageStrong, ink: PALETTE.sageInk, tint: PALETTE.sageTint };
  const red = { fill: PALETTE.terra, strong: PALETTE.terra, ink: PALETTE.terraInk, tint: PALETTE.terraTint };

  it("the writer of a one-person verdict or a case's creator: Party A is green", () => {
    expect(greenParty("a")).toBe("a");
    expect(sideColors("a")).toEqual({ a: green, b: red });
  });

  it("the other side of a case: Party B is green, Party A red", () => {
    expect(greenParty("b")).toBe("b");
    expect(sideColors("b")).toEqual({ a: red, b: green });
  });

  it("a stranger or nobody known (share images, samples): Party A is green", () => {
    expect(greenParty(null)).toBe("a");
    expect(greenParty()).toBe("a");
    expect(sideColors(null)).toEqual({ a: green, b: red });
    expect(sideColors()).toEqual(sideColors("a"));
  });

  it("globals.css declares the same sides, swapped under data-you=\"b\"", () => {
    expect(css).toMatch(/:root,\s*\[data-you="a"\] \{/);
    expect(sideBlock('[data-you="a"]')).toEqual(sideColors("a"));
    expect(sideBlock('[data-you="b"]')).toEqual(sideColors("b"));
  });

  it("either side's text reaches 4.5:1 on its tint and the page, white on its ink too", () => {
    for (const s of [green, red]) {
      for (const bg of [s.tint, PALETTE.paper, PALETTE.ivory, PALETTE.ivory2]) {
        expect(contrast(s.ink, bg), `${s.ink} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast("#FFFFFF", s.ink), `white on ${s.ink}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(s.strong, PALETTE.paper), `${s.strong} mark`).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("palette contrast (WCAG 2.x)", () => {
  const P = PALETTE;
  const AA_TEXT = 4.5;
  const AA_UI = 3;

  it("text colours reach 4.5:1 on the surfaces they sit on", () => {
    const pairs: [PaletteKey, PaletteKey][] = [
      ["ink", "ivory"],
      ["ink2", "ivory"],
      ["ink2", "ivory2"],
      ["muted", "ivory"],
      ["muted", "ivory2"],
      ["muted", "paper"],
      ["placeholder", "paper"],
      ["terraInk", "ivory"],
      ["terraInk", "ivory2"],
      ["terraInk", "paper"],
      ["sageInk", "ivory"],
      ["sageInk", "ivory2"],
      ["sageInk", "paper"],
      ["sageInk", "sageTint"],
      ["terraInk", "terraTint"],
      ["danger", "paper"],
      ["danger", "ivory"],
    ];
    for (const [fg, bg] of pairs) {
      expect(contrast(P[fg], P[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it("thin UI marks and large terracotta display text reach 3:1", () => {
    expect(contrast(P.sageStrong, P.ivory)).toBeGreaterThanOrEqual(AA_UI);
    expect(contrast(P.sageStrong, P.paper)).toBeGreaterThanOrEqual(AA_UI);
    expect(contrast(P.terra, P.ivory)).toBeGreaterThanOrEqual(AA_UI);
  });

  it("the white check on a winner's seal reaches 3:1", () => {
    expect(contrast("#FFFFFF", P.terraInk)).toBeGreaterThanOrEqual(AA_UI);
    expect(contrast("#FFFFFF", P.sageInk)).toBeGreaterThanOrEqual(AA_UI);
  });

  it("plain sage stays a fill: too light for text", () => {
    expect(contrast(P.sage, P.ivory)).toBeLessThan(AA_UI);
  });

  it("contrast is symmetric and bounded", () => {
    expect(contrast("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrast(P.ink, P.ivory)).toBeCloseTo(contrast(P.ivory, P.ink), 10);
    expect(contrast(P.ivory, P.ivory)).toBe(1);
  });
});
