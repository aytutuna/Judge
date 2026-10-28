import styles from "./PremiumBadge.module.css";

/** The small four-point spark used wherever Premium is named. Decorative. */
export function PremiumSpark({ className }: { className?: string }) {
  return (
    <svg className={className ?? styles.spark} viewBox="0 0 12 12" aria-hidden>
      <path d="M6 0.8 7.3 4.7 11.2 6 7.3 7.3 6 11.2 4.7 7.3 0.8 6 4.7 4.7z" fill="currentColor" />
    </svg>
  );
}
