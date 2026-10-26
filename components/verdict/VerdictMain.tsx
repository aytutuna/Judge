import type { ReactNode } from "react";
import type { Lang } from "@/lib/i18n";
import { hyphenRuns } from "@/lib/text";
import { ConfidenceMeter } from "../ConfidenceMeter";
import styles from "./verdict.module.css";

/** Which side the seal honours: its colour follows the winner, ink when
 * nobody won outright. */
export type SealSide = "a" | "b" | "none";

const SEAL_CLASS: Record<SealSide, string> = {
  a: styles.sealA,
  b: styles.sealB,
  none: styles.sealNone,
};

/** Labels longer than this may wrap on a phone, so the seal stacks above
 * them ("You're right" and "Sen haklısın" stay inline). */
const STACK_LABEL = 12;
/** Labels longer than this drop to a smaller display size so that "It
 * depends on your values" or a long name still fits a 390px card. */
const LONG_LABEL = 18;

function SealIcon({ side }: { side: SealSide }) {
  return (
    <span className={`${styles.seal} ${SEAL_CLASS[side]}`} aria-hidden>
      {side === "none" ? (
        // a level beam on a pivot: no outright winner
        <svg viewBox="0 0 16 16">
          <path d="M2.5 6.5h11" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" />
          <path d="M8 6.5 5.6 12.5h4.8z" fill="#fff" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16">
          <path
            d="M3.5 8.4 6.6 11.4 12.6 4.9"
            fill="none"
            stroke="#fff"
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </span>
  );
}

/**
 * The centre of the card: dispute badge, seal plus verdict label, headline,
 * confidence meter (how many judges agreed), then `children` as the slot
 * for the forced-ruling lean, cross-examination, refusal and demo notes. The meter scores the MAIN
 * verdict and stays bound to the headline; the slots sit below it.
 */
export function VerdictMain({
  badge,
  label,
  labelId,
  labelAs: Label = "h2",
  seal,
  headline,
  agreement,
  lang,
  children,
}: {
  badge: string;
  label: string;
  labelId?: string;
  labelAs?: "h2" | "h3" | "p";
  seal: SealSide;
  headline: string;
  agreement: { n: number; total: number };
  lang: Lang;
  children?: ReactNode;
}) {
  const chars = [...label].length;
  const labelCls = [
    styles.label,
    chars > STACK_LABEL && styles.labelStack,
    chars > LONG_LABEL && styles.labelLong,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={styles.main}>
      <span className={styles.badge}>{badge}</span>
      <Label id={labelId} className={labelCls}>
        <SealIcon side={seal} />
        <span>{label}</span>
      </Label>
      {headline ? (
        <p className={styles.headline}>
          {hyphenRuns(headline).map((r, i) =>
            r.keep ? (
              <span key={i} className={styles.nobreak}>
                {r.text}
              </span>
            ) : (
              r.text
            ),
          )}
        </p>
      ) : null}
      <ConfidenceMeter n={agreement.n} total={agreement.total} lang={lang} />
      {children}
    </div>
  );
}

/** One note in the VerdictMain slot area. */
export function MainSlot({ children }: { children: ReactNode }) {
  return <div className={styles.slot}>{children}</div>;
}
