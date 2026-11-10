import type { PartyId, VerdictResult } from "@/lib/types";
import { VoteDots, votesOf } from "./VoteDots";
import styles from "./verdict.module.css";

export type SideNames = Record<PartyId, { name: string; self: boolean }>;

/** A verdict with three or four sides, which have no tug and no lean to draw. */
export const isMany = (r: VerdictResult): r is VerdictResult & { parties: PartyId[] } => r.parties !== undefined;

function Check() {
  return (
    <svg viewBox="0 0 16 16" className={styles.winMark} aria-hidden>
      <path d="m3 8.5 3.2 3.2L13 4.8" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Every side with its name, a dot per judge that voted for it, and the winner marked. */
export function SideList({ result, names }: { result: VerdictResult & { parties: PartyId[] }; names: SideNames }) {
  const votes = votesOf(result);
  return (
    <ul className={styles.sideList}>
      {result.parties.map((p) => (
        <li key={p} className={styles.sideRow} data-party={p} data-winner={result.winner === p ? "" : undefined}>
          <span className={styles.sideAvatar} aria-hidden>
            {p.toUpperCase()}
          </span>
          <span className={styles.sideName}>{names[p].name}</span>
          {result.winner === p ? <Check /> : null}
          <VoteDots votes={votes.filter((v) => v === p)} />
        </li>
      ))}
    </ul>
  );
}

/** One short line for each side that did not win, on where it fell short. */
export function OtherLines({ result, names }: { result: VerdictResult; names: SideNames }) {
  const lines = (result.others ?? []).filter((o) => o.line.trim() && names[o.party]);
  if (lines.length === 0) return null;
  return (
    <ul className={styles.others}>
      {lines.map((o) => (
        <li key={o.party} className={styles.other} data-party={o.party}>
          <span className={styles.otherName}>{names[o.party].name}</span> {o.line}
        </li>
      ))}
    </ul>
  );
}
