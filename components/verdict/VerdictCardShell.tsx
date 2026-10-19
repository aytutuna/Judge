import type { ReactNode, Ref } from "react";
import styles from "./verdict.module.css";

/**
 * The paper verdict card (radius 30, card shadow). Hook-free, so the share
 * page can render it on the server.
 *
 * - `top` renders OUTSIDE the busy region: it holds the translation live
 *   region, and screen readers may hold back announcements from inside an
 *   aria-busy subtree.
 * - `busy`: aria-busy plus .55 opacity on the body (a translation is loading).
 * - `highlight`: the sage "fresh" ring, fading out over 2.6s.
 * - `animate`: the live entrance (card rises, tug settles, dots pop, label
 *   lifts, meter fills). Pure CSS; reduced motion shows the final state.
 */
export function VerdictCardShell({
  top,
  children,
  highlight = false,
  busy = false,
  animate = false,
  labelledBy,
  ref,
}: {
  top?: ReactNode;
  children: ReactNode;
  highlight?: boolean;
  busy?: boolean;
  animate?: boolean;
  labelledBy?: string;
  ref?: Ref<HTMLElement>;
}) {
  const cls = [styles.shell, animate && styles.animate, highlight && styles.fresh]
    .filter(Boolean)
    .join(" ");
  return (
    <article ref={ref} className={cls} aria-labelledby={labelledBy}>
      {top}
      <div className={busy ? `${styles.body} ${styles.busy}` : styles.body} aria-busy={busy}>
        {children}
      </div>
    </article>
  );
}
