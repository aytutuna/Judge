"use client";

import Link from "next/link";
import type { CaseStatus } from "@/lib/case-types";
import { saveDraftForSignIn } from "@/lib/draft";
import { t, tWithDate, type Key, type Lang } from "@/lib/i18n";
import type { HistoryItem, HistoryView } from "./useHistory";
import styles from "./shell.module.css";

const CASE_KEY = {
  awaiting_respondent: "shell.case.waiting",
  judging: "shell.case.judging",
  judged: "shell.case.judged",
  failed: "shell.case.failed",
  expired: "shell.case.expired",
} as const satisfies Record<CaseStatus, Key>;

const GROUP_KEY = { today: "shell.today", week: "shell.week", earlier: "shell.earlier" } as const;

export type HistoryGroup = { key: keyof typeof GROUP_KEY; items: HistoryItem[] };

/** Today, the six days before it, and everything older, in local time.
 * Empty groups are left out. */
export function groupHistory(items: HistoryItem[], now: number): HistoryGroup[] {
  const d = new Date(now);
  const today = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const week = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 6).getTime();
  const groups: HistoryGroup[] = [
    { key: "today", items: [] },
    { key: "week", items: [] },
    { key: "earlier", items: [] },
  ];
  for (const item of items) {
    const at = Date.parse(item.createdAt);
    groups[at >= today ? 0 : at >= week ? 1 : 2].items.push(item);
  }
  return groups.filter((g) => g.items.length > 0);
}

export function historyHref(item: HistoryItem): string {
  return `/${item.kind === "verdict" ? "v" : "c"}/${encodeURIComponent(item.id)}`;
}

function Row({ lang, item }: { lang: Lang; item: HistoryItem }) {
  const removed = t(lang, "account.verdicts.removed");
  if (item.kind === "verdict" && item.removed) {
    // Its share page no longer opens: listed, not linked.
    return (
      <span className={styles.row} data-removed="">
        <span className={styles.title}>{removed}</span>
      </span>
    );
  }
  const title =
    item.title ??
    (item.kind === "case" ? tWithDate(lang, "case.list.untitled", item.createdAt) : t(lang, "shell.untitled"));
  if (item.pending) {
    // Its share page 404s until the verdict is stored.
    return (
      <span className={styles.row}>
        <span className={styles.title}>{title}</span>
        <span className={styles.state}>{t(lang, "shell.case.judging")}</span>
      </span>
    );
  }
  const state = item.kind === "case" ? (item.removed ? removed : item.status ? t(lang, CASE_KEY[item.status]) : null) : null;
  return (
    <Link href={historyHref(item)} className={styles.row} data-removed={item.removed ? "" : undefined}>
      <span className={styles.title}>{title}</span>
      {state ? <span className={styles.state}>{state}</span> : null}
    </Link>
  );
}

/** The viewer's verdicts and cases by date, with "Show more" while a page
 * is left. `signIn`: signed out where accounts are offered, so the list is
 * this browser's own. Stateless for tests: the page supplies the data. */
export function HistoryList({
  lang,
  history,
  now,
  signIn = false,
  onLoadMore,
}: {
  lang: Lang;
  history: HistoryView;
  /** For the date groups (ms). */
  now: number;
  signIn?: boolean;
  onLoadMore?: () => void;
}) {
  const groups = groupHistory(history.items, now);
  return (
    <div className={styles.history}>
      {signIn ? (
        <p className={styles.local}>
          {t(lang, "shell.local")}{" "}
          <Link href="/signin?next=%2Fverdicts" onClick={saveDraftForSignIn}>
            {t(lang, "shell.localSignIn")}
          </Link>
        </p>
      ) : null}
      {groups.map((g) => (
        <section key={g.key} aria-labelledby={`history-${g.key}`}>
          <h2 id={`history-${g.key}`} className={styles.group}>
            {t(lang, GROUP_KEY[g.key])}
          </h2>
          <ul className={styles.rows}>
            {g.items.map((item) => (
              <li key={`${item.kind}-${item.id}`}>
                <Row lang={lang} item={item} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {history.status === "loading" && groups.length === 0 ? (
        <p className={styles.note} role="status">
          {t(lang, "shell.loading")}
        </p>
      ) : history.status === "error" && groups.length === 0 ? (
        <p className={styles.note}>{t(lang, "shell.loadFailed")}</p>
      ) : groups.length === 0 ? (
        <p className={styles.note}>{t(lang, "shell.empty")}</p>
      ) : null}
      {history.more ? (
        <button type="button" className={styles.more} disabled={history.loadingMore} onClick={onLoadMore}>
          {history.loadingMore ? t(lang, "shell.loading") : t(lang, "shell.loadMore")}
        </button>
      ) : null}
    </div>
  );
}
