import styles from "./verdict.module.css";

/** What decided the ruling, right under the headline. */
export function WhyBlock({ title, text }: { title: string; text: string }) {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionLabel}>{title}</h3>
      <p className={styles.sectionText}>{text}</p>
    </section>
  );
}
