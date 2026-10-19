import { cruxStyle } from "@/lib/crux-style";
import { PALETTE } from "@/lib/palette";
import styles from "./verdict.module.css";

/** Dashed box with a diamond kicker. Short cruxes are set in the display
 * serif; long ones switch to the body face (see lib/crux-style.ts). */
export function CruxBlock({ title, text }: { title: string; text: string }) {
  const face = cruxStyle(text) === "serif" ? styles.cruxSerif : styles.cruxSans;
  return (
    <div className={styles.crux}>
      <span className={`${styles.k} ${styles.cruxKicker}`}>
        <svg viewBox="0 0 12 12" aria-hidden>
          <path d="M6 0.8 11.2 6 6 11.2 0.8 6z" fill={PALETTE.ink} />
        </svg>
        {title}
      </span>
      <p className={`${styles.cruxText} ${face}`}>{text}</p>
    </div>
  );
}
