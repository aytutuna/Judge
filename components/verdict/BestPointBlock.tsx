import styles from "./verdict.module.css";

/** The other side's best point, on a terracotta left rule. */
export function BestPointBlock({ title, text }: { title: string; text: string }) {
  return (
    <div className={styles.best}>
      <span className={styles.k}>{title}</span>
      <p>{text}</p>
    </div>
  );
}
