import type { ReactNode } from "react";
import { BrandMark } from "../BrandMark";
import { VoteDots, type Vote } from "./VoteDots";
import styles from "./verdict.module.css";

/** Left: a pill ("Example" on the sample; the translation status, or the
 * CardBrand mark when there is none, on a live verdict). Right: one dot per
 * judge. See VoteDots for `votesSr`. */
export function CardTopRow({
  pill,
  votes,
  votesLabel,
  votesSr,
}: {
  pill?: ReactNode;
  votes: readonly Vote[];
  votesLabel?: string;
  votesSr?: string;
}) {
  return (
    <div className={styles.top}>
      {pill}
      <VoteDots votes={votes} label={votesLabel} srText={votesSr} />
    </div>
  );
}

/** The dark "Example" pill of the homepage sample. */
export function ExamplePill({ children }: { children: ReactNode }) {
  return <span className={styles.pill}>{children}</span>;
}

/** The quiet "Verdict" mark for the top-left corner of a live verdict when
 * no translation note is showing. Decorative: the page already names the
 * product, and a screen reader goes straight to the verdict. */
export function CardBrand() {
  return (
    <span className={styles.brandTag} aria-hidden>
      <BrandMark size={20} />
      Verdict
    </span>
  );
}
