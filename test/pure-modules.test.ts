import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Shared modules the future React Native app reuses as they are. They may
 * import only each other and zod: no Next, React DOM, Node built-ins or
 * browser globals. (lib/use-viewer.ts and lib/tier.ts are website-only:
 * they use React and localStorage, so they are deliberately not listed.)
 */
const PURE = [
  "types",
  "i18n",
  "verdict-display",
  "names",
  "palette",
  "frameworks",
  "content-lang",
  "api-errors",
  "account-types",
  "pricing",
] as const;

const ALLOWED_PACKAGES = new Set(["zod"]);

const source = (name: string) => readFileSync(join(__dirname, "..", "lib", `${name}.ts`), "utf8");

/** Comments and string contents can mention "window" or "process"; only code counts. */
function stripCommentsAndStrings(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/`(?:\\[\s\S]|[^\\`])*`/g, "``")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''");
}

function importSpecifiers(code: string): string[] {
  const specs: string[] = [];
  const patterns = [
    /\bimport\s+(?:type\s+)?[^"';]*?\sfrom\s+["']([^"']+)["']/g,
    /\bimport\s+["']([^"']+)["']/g,
    /\bexport\s+(?:type\s+)?[^"';]*?\sfrom\s+["']([^"']+)["']/g,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) for (const m of code.matchAll(re)) specs.push(m[1]);
  return specs;
}

describe("pure shared modules", () => {
  for (const name of PURE) {
    it(`lib/${name}.ts imports only pure modules and zod`, () => {
      for (const spec of importSpecifiers(source(name))) {
        if (spec.startsWith("./")) {
          expect(PURE as readonly string[], `lib/${name}.ts imports ${spec}`).toContain(spec.slice(2).replace(/\.ts$/, ""));
        } else {
          expect(ALLOWED_PACKAGES.has(spec), `lib/${name}.ts imports ${spec}`).toBe(true);
        }
      }
    });

    it(`lib/${name}.ts uses no Node or browser globals`, () => {
      const code = stripCommentsAndStrings(source(name));
      expect(code).not.toMatch(
        /\b(window|document|localStorage|sessionStorage|navigator|process|Buffer|__dirname|require)\b/,
      );
    });
  }

  it("the import scanner sees every import form", () => {
    const code = [
      'import { a } from "next/server";',
      'import type { B } from "./types";',
      'import "react-dom";',
      'export { c } from "node:fs";',
      'const d = await import("./i18n");',
    ].join("\n");
    expect(importSpecifiers(code)).toEqual(
      expect.arrayContaining(["next/server", "./types", "react-dom", "node:fs", "./i18n"]),
    );
  });
});
