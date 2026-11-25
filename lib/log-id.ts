import { createHash } from "node:crypto";

/** A verdict's id opens its share link, so logs carry this short hash of it
 * instead: enough to follow one verdict through the lines, useless as a link. */
export function logId(id: string): string {
  return createHash("sha256").update(id).digest("hex").slice(0, 8);
}
