"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { t, type Key, type Lang } from "@/lib/i18n";
import { BrandMark } from "../BrandMark";
import styles from "./thread.module.css";

export type ThreadProps = {
  lang: Lang;
  /** What the viewer wrote, as they wrote it. Null when it can't be shown. */
  argument: string | null;
  /** Why it can't be shown (default: it was not kept). */
  missing?: Key;
  /** The judges' side, always in this order, each part only when given. */
  clarify?: ReactNode;
  /** A short progress line (checking for gaps, creating the case). Not a
   * live region: one inserted already holding its text is often not read,
   * so the page announces it from a region that stays mounted. */
  status?: string | null;
  judging?: ReactNode;
  invite?: ReactNode;
  notice?: ReactNode;
  verdict?: ReactNode;
  /** The viewer's next move on this thread: an appeal, the owner's tools. */
  followUp?: ReactNode;
  /** Replaces "The judges" (e.g. how far they agreed). */
  judgesLabel?: string;
};

const PARTS = ["clarify", "status", "judging", "invite", "notice", "verdict"] as const;

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * One argument as a conversation: the viewer's text, then everything the
 * judges answered, then the follow-up. A part that shows up after the first
 * render (the verdict replacing the judging card) is scrolled to, and the
 * verdict takes focus so a screen reader reads it next; a page opened on a
 * finished thread stays where it starts.
 */
export function Thread(props: ThreadProps) {
  const { lang, argument, missing = "owner.notStored", status, followUp, judgesLabel } = props;
  const listRef = useRef<HTMLOListElement>(null);
  const parts = PARTS.filter((p) => Boolean(props[p]));
  const shown = parts.join(" ");
  const prev = useRef<string | null>(null);

  useEffect(() => {
    const before = prev.current;
    prev.current = shown;
    if (before === null || before === shown) return;
    const old = before.split(" ");
    const fresh = shown.split(" ").find((p) => p && !old.includes(p));
    const find = (p: string) => listRef.current?.querySelector<HTMLElement>(`[data-part="${p}"]`) ?? null;
    const el = fresh ? find(fresh) : null;
    if (!el) return;
    if (fresh === "verdict") el.focus({ preventScroll: true });
    // A judging card kept above the verdict (the settled scene) is part of
    // the result, so the view starts there.
    const top = fresh === "verdict" ? (find("judging") ?? el) : el;
    top.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  }, [shown]);

  return (
    <ol ref={listRef} className={styles.thread} aria-label={t(lang, "thread.label")}>
      <li className={styles.you} data-turn="argument">
        <p className="sr-only">{t(lang, "thread.you")}</p>
        {argument === null ? (
          <p className={styles.missing}>{t(lang, missing)}</p>
        ) : (
          <p className={styles.bubble}>{argument}</p>
        )}
      </li>
      {parts.length > 0 ? (
        <li className={styles.judges} data-turn="judges">
          <p className={styles.who}>
            <BrandMark size={22} />
            {judgesLabel ?? t(lang, "thread.judges")}
          </p>
          {parts.map((p) =>
            p === "status" ? (
              <p key={p} data-part={p} className={styles.status}>
                <span className={styles.spinner} aria-hidden />
                {status}
              </p>
            ) : (
              <div key={p} data-part={p} className={styles.part} tabIndex={p === "verdict" ? -1 : undefined}>
                {props[p]}
              </div>
            ),
          )}
        </li>
      ) : null}
      {followUp ? (
        <li className={styles.followUp} data-turn="followUp">
          {followUp}
        </li>
      ) : null}
    </ol>
  );
}
