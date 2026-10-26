"use client";

import Link from "next/link";
import { formatDate, t, tWithDate, type Key, type Lang } from "@/lib/i18n";
import { historyHref } from "../shell/HistoryList";
import type { HistoryItem } from "../shell/useHistory";
import styles from "./Recent.module.css";

const MAX = 8;

export type RecentCard = {
  key: string;
  /** Null while a verdict is still being judged: its page 404s until then. */
  href: string | null;
  kicker: string;
  tone: "decided" | "waiting" | "closed";
  title: string;
  date: string;
};

/** The newest few verdicts and cases for the home page, removed ones left
 * out. Dated "Today" or by calendar day, in local time. */
export function recentCards(lang: Lang, items: HistoryItem[], now: number): RecentCard[] {
  const d = new Date(now);
  const today = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return items
    .filter((i) => !i.removed)
    .slice(0, MAX)
    .map((i) => {
      const waiting = i.pending || i.status === "awaiting_respondent" || i.status === "judging";
      const kicker: Key = waiting
        ? "home.waiting"
        : i.status === "failed"
          ? "shell.case.failed"
          : i.status === "expired"
            ? "shell.case.expired"
            : "home.decided";
      return {
        key: `${i.kind}-${i.id}`,
        href: i.pending ? null : historyHref(i),
        kicker: t(lang, kicker),
        tone: waiting ? "waiting" : kicker === "home.decided" ? "decided" : "closed",
        title:
          i.title ??
          (i.kind === "case" ? tWithDate(lang, "case.list.untitled", i.createdAt) : t(lang, "shell.untitled")),
        date: Date.parse(i.createdAt) >= today ? t(lang, "shell.today") : (formatDate(lang, i.createdAt) ?? ""),
      };
    });
}

/** "Recent" under the home card: a row of the newest verdicts, with a link
 * to the whole list. Nothing at all while the list is empty. */
export function Recent({ lang, items, now }: { lang: Lang; items: HistoryItem[]; now: number }) {
  const cards = recentCards(lang, items, now);
  if (!cards.length) return null;
  return (
    <section className={styles.recent} aria-labelledby="recent-title">
      <div className={styles.head}>
        <h2 id="recent-title" className={styles.label}>
          {t(lang, "home.recent")}
        </h2>
        <Link href="/verdicts" className={styles.all}>
          {t(lang, "home.all")}
        </Link>
      </div>
      <ul className={styles.row}>
        {cards.map((c) => {
          const body = (
            <>
              <span className={styles.kicker} data-tone={c.tone}>
                {c.kicker}
              </span>
              <span className={styles.title}>{c.title}</span>
              <span className={styles.date}>{c.date}</span>
            </>
          );
          return (
            <li key={c.key}>
              {c.href ? (
                <Link href={c.href} className={styles.card}>
                  {body}
                </Link>
              ) : (
                <div className={styles.card}>{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
