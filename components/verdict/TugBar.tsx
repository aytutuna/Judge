import type { CSSProperties } from "react";
import styles from "./verdict.module.css";

/**
 * Tug-of-war bar: Party A's share against Party B's, in the side colours
 * (the viewer's own green), with an ink knot at the divide. `tugA` is A's share in percent (see
 * tugFinal). The bar is one role="img" whose label states the verdict in
 * words. Motion comes from the card shell (`animate` or the sample's play
 * state), so the bar itself is static markup.
 */
export function TugBar({
  nameA,
  nameB,
  tugA,
  ariaLabel,
}: {
  nameA: string;
  nameB: string;
  tugA: number;
  ariaLabel: string;
}) {
  const a = Math.max(0, Math.min(100, tugA));
  return (
    <div>
      <div className={styles.tugNames}>
        <span className={styles.tugName}>
          <i aria-hidden className={styles.nameDot} style={{ background: "var(--party-a-strong)" }} />
          <span className={styles.nameText}>{nameA}</span>
        </span>
        <span className={styles.tugName}>
          <span className={styles.nameText}>{nameB}</span>
          <i aria-hidden className={styles.nameDot} style={{ background: "var(--party-b-strong)" }} />
        </span>
      </div>
      <div
        className={styles.tugBar}
        role="img"
        aria-label={ariaLabel}
        style={{ "--a": `${a}%` } as CSSProperties}
      >
        <div className={styles.tugA} />
        <div className={styles.tugKnot} />
      </div>
    </div>
  );
}
