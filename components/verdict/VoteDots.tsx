import type { CSSProperties } from "react";
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

/**
 * One dot per judge run (more than three after an escalation) in its
 * side's colour, a hollow ink ring for anything else. Colour is
 * never the only carrier: with `srText` the visible label is hidden from
 * screen readers in favour of that full sentence; without it the whole
 * cluster is decorative and the caller must say the votes in text elsewhere.
 */
export function VoteDots({
  votes,
  label,
  srText,
}: {
  votes: readonly Vote[];
  label?: string;
  srText?: string;
}) {
  if (!votes.length && !label) return null;
  return (
    <p className={styles.votes} aria-hidden={srText ? undefined : true}>
      {label ? (
        <span className={styles.votesText} aria-hidden={srText ? true : undefined}>
          {label}
        </span>
      ) : null}
      {votes.map((v, i) => (
        <i
          key={i}
          aria-hidden
          className={`${styles.dot} ${DOT_CLASS[v]}`}
          style={{ "--i": i } as CSSProperties}
        />
      ))}
      {srText ? <span className="sr-only">{srText}</span> : null}
    </p>
  );
}
