import { voteOf, type Vote } from "@/lib/balance";
import styles from "./verdict.module.css";

/** One judge's vote as the card draws it (the same mapping as the 3D vote
 * orbs): for Party A, for Party B, or any non-side ruling. */
export { voteOf, type Vote };

const DOT_CLASS: Record<Vote, string> = {
  a: styles.dotA,
  b: styles.dotB,
  other: styles.dotOther,
};

/** One dot per judge run (more than three after an escalation) in its
 * side's colour, a hollow ink ring for anything else. Decorative: the votes
 * are also written out in the details. */
export function VoteDots({ votes }: { votes: readonly Vote[] }) {
  if (!votes.length) return null;
  return (
    <p className={styles.votes} aria-hidden>
      {votes.map((v, i) => (
        <i key={i} className={`${styles.dot} ${DOT_CLASS[v]}`} />
      ))}
    </p>
  );
}
