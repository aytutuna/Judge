import { SIDES_HEADER } from "@/lib/case-types";

/** Whether the request comes from an app that can show a case with `sides`
 * sides (it sends Judge-Sides: the most it can show). Older builds never
 * send it, so they are treated as showing two. */
export function acceptsManySides(req: Request, sides = 3): boolean {
  const n = Number(req.headers.get(SIDES_HEADER));
  return Number.isInteger(n) && n >= sides;
}
