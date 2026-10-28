import styles from "./verdict.module.css";

/** The losing side's best point, on a rule in that side's colour. */
export function BestPointBlock({ title, text, party }: { title: string; text: string; party: "a" | "b" }) {
  return (
    <div className={styles.best} data-party={party}>
      <span className={styles.k}>{title}</span>
      <p>{text}</p>
    </div>
  );
}
