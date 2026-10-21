/** The judge-facing EVIDENCE block built from anonymized transcripts. Pure. */

import { HEADING_LINE, KIND_HEADING } from "./render";
import type { EvidenceGroup } from "./types";

const NOTE = "they show only what was on screen";

function heading(party: EvidenceGroup["party"]): string {
  if (party === null) {
    return `EVIDENCE (machine transcripts of images the person asking attached; ${NOTE}):`;
  }
  const label = `Party ${party.toUpperCase()}`;
  return `EVIDENCE FROM ${label.toUpperCase()} (machine transcripts of images ${label} attached; ${NOTE}):`;
}

/**
 * One item: the transcript's own heading line folds into the id line
 * (`[A1 · Chat screenshot · "Party B"]`), and every transcript line is
 * indented so text on a screenshot can never pass for a heading of the case.
 */
function item(id: string, kind: keyof typeof KIND_HEADING, transcript: string): string {
  const lines = transcript.replace(/\r\n?/g, "\n").split("\n");
  const first = HEADING_LINE.exec(lines[0]?.trim() ?? "");
  let head = `[${id} · ${KIND_HEADING[kind]}]`;
  if (first) {
    lines.shift();
    head = first[2] ? `[${id} · ${first[1]} · "${first[2]}"]` : `[${id} · ${first[1]}]`;
  }
  const body = lines.filter((l) => l.trim() !== "").map((l) => `  ${l.trim()}`);
  return [head, ...body].join("\n");
}

/**
 * EVIDENCE FROM PARTY A (...):
 * [A1 · Chat screenshot · "Party B"]
 *   21:02 Party A: Did you pay the electricity bill?
 *
 * One block per non-empty group, in the given order; ids are the group's
 * prefix plus a 1-based number (A1, B2, E1, A-new1). Null when there is
 * nothing to show.
 */
export function evidenceBlock(groups: readonly EvidenceGroup[]): string | null {
  const blocks: string[] = [];
  for (const group of groups) {
    const items = group.items.filter((e) => e.transcript.trim() !== "");
    if (items.length === 0) continue;
    blocks.push(
      [heading(group.party), ...items.map((e, i) => item(`${group.idPrefix}${i + 1}`, e.kind, e.transcript))].join(
        "\n",
      ),
    );
  }
  return blocks.length ? blocks.join("\n\n") : null;
}
