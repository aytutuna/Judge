import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BalanceFallback } from "../components/scene/BalanceFallback";
import { balanceSvg, tiltDeg, tiltTransform } from "../mobile/shared/scene/fallback";

// Every element under the root with its attributes, ids aside.
function shapes(svg: string): string[] {
  return [...svg.matchAll(/<(\w+)([^>]*?)\/?>/g)]
    .filter(([, tag]) => tag !== "svg")
    .map(([, tag, attrs]) => {
      const pairs = [...attrs.matchAll(/([\w-]+)="([^"]*)"/g)].filter(([, k]) => k !== "id");
      return `${tag} ${pairs.map(([, k, v]) => `${k}=${v}`).sort().join(" ")}`;
    });
}

describe("app scene fallback", () => {
  it("draws the same balance as BalanceFallback", () => {
    expect(shapes(balanceSvg())).toHaveLength(11);
    expect(shapes(balanceSvg())).toEqual(shapes(renderToStaticMarkup(<BalanceFallback />)));
  });

  it("tilts like BalanceFallback for a verdict", () => {
    for (const tugA of [0, 20, 50, 80, 100]) {
      const web = renderToStaticMarkup(<BalanceFallback tugA={tugA} />);
      expect(web).toContain(`transform="${tiltTransform(tiltDeg(tugA))}"`);
    }
  });
});
