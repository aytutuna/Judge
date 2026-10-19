import type { ReactNode } from "react";
import styles from "./verdict.module.css";

/**
 * Bottom row of the card: share buttons on the left, a terracotta text
 * action on the right ("Settle another one"). `again` renders a button when
 * it has `onClick`, otherwise a link to `href`. Renders nothing when empty.
 */
export function CardActions({
  share,
  again,
}: {
  share?: ReactNode;
  again?: { label: string; onClick?: () => void; href?: string };
}) {
  if (!share && !again) return null;
  return (
    <div className={styles.actions}>
      {share ?? <span />}
      {again ? (
        again.onClick ? (
          <button type="button" className={styles.btnLink} onClick={again.onClick}>
            {again.label}
          </button>
        ) : (
          <a className={styles.btnLink} href={again.href ?? "/"}>
            {again.label}
          </a>
        )
      ) : null}
    </div>
  );
}
