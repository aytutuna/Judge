import { SIDES_HEADER } from "@/lib/case-types";

/** Whether the request comes from an app that can show a case with `sides`
 * sides (it sends Judge-Sides: the most it can show). Older builds never
 * send it, so they are treated as showing two. */
export function acceptsManySides(req: Request, sides = 3): boolean {
  const n = Number(req.headers.get(SIDES_HEADER));
  return Number.isInteger(n) && n >= sides;
}

export const VERDICT_UPDATE = "This verdict has more than two sides. Update the app to open it.";

/** A stored verdict with three or four sides, asked by an app that cannot
 * read it: it would show the winner as "too close". */
export function hidesFrom(req: Request, result: { parties?: readonly unknown[] } | null | undefined): boolean {
  return result?.parties !== undefined && !acceptsManySides(req, result.parties.length);
}
