"use client";

import Link from "next/link";
import { saveDraftForSignIn } from "@/lib/draft";
import { t, tWithDate, type Lang } from "@/lib/i18n";
import type { HistoryItem, HistoryView } from "./useHistory";
import styles from "./shell.module.css";

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
    const at = Date.parse(item.at);
    groups[at >= today ? 0 : at >= week ? 1 : 2].items.push(item);
  }
  return groups.filter((g) => g.items.length > 0);
}

/** The ruling from the viewer's side: "You're right", "{name} is right",
 * or the outcome itself. */
function rulingLabel(lang: Lang, item: HistoryItem): string {
  switch (item.verdict) {
    case "side_a":
    case "side_b": {
      const yours = item.verdict === (item.party === "a" ? "side_a" : "side_b");
      if (yours) return item.self ? t(lang, "verdict.win", { name: item.self }) : t(lang, "verdict.winSelf");
      return t(lang, "verdict.win", { name: item.other ?? t(lang, item.party === "a" ? "party.b" : "party.a") });
    }
    case "split":
      return t(lang, "verdict.split");
    case "conditional":
      return t(lang, "verdict.conditional");
    case "dissolved":
      return t(lang, "verdict.dissolved");
    case "too_close":
      return t(lang, "verdict.tooClose");
    default:
      return t(lang, "history.state.ready");
  }
}

/** The row's state in a few plain words; null when there is nothing to say. */
export function stateLabel(lang: Lang, item: HistoryItem): string | null {
  switch (item.state) {
    case "judging":
      return t(lang, "history.state.judging");
    case "rejudging":
      return t(lang, "history.state.rejudging");
    case "failed":
      return t(lang, "history.state.failed");
    case "rejudge_failed":
      return t(lang, "history.state.rejudgeFailed");
    case "waiting":
      return item.other ? t(lang, "history.state.waiting", { name: item.other }) : t(lang, "history.state.waitingOther");
    case "expired":
      return t(lang, "history.state.expired");
    case "removed":
      return t(lang, "history.state.removed");
    case "removed_by_other":
      return item.other ? t(lang, "history.state.removedBy", { name: item.other }) : t(lang, "history.state.removedByOther");
    case "ready":
      return rulingLabel(lang, item);
    default:
      return null;
  }
}

/** Green when the ruling went the viewer's way, red when it went the other's. */
function tone(item: HistoryItem): "yours" | "theirs" | undefined {
  if (item.state !== "ready" || (item.verdict !== "side_a" && item.verdict !== "side_b")) return undefined;
  return item.verdict === (item.party === "a" ? "side_a" : "side_b") ? "yours" : "theirs";
}

function Row({ lang, item }: { lang: Lang; item: HistoryItem }) {
  const ownRemoval = item.state === "removed";
  const title =
    item.title ??
    (item.kind === "case"
      ? tWithDate(lang, "case.list.untitled", item.at)
      : ownRemoval
        ? t(lang, "history.state.removed")
        : t(lang, "shell.untitled"));
  // A removed verdict says so in its title already.
  const state = item.kind === "verdict" && ownRemoval ? null : stateLabel(lang, item);
  const tags = [
    item.role === "respondent" ? t(lang, "history.answered") : null,
    item.contextAdded && item.state === "ready" ? t(lang, "history.contextAdded") : null,
  ].filter((x): x is string => x !== null);
  const inner = (
    <>
      <span className={styles.title}>
        {title}
        {tags.length ? <span className={styles.tags}>{tags.join(" · ")}</span> : null}
      </span>
      {state || item.yourMove ? (
        <span className={styles.state} data-tone={tone(item)}>
          {state}
          {item.yourMove ? <span className={styles.move}>{t(lang, "history.yourMove")}</span> : null}
        </span>
      ) : null}
    </>
  );
  const muted = item.removed || item.state === "expired" ? "" : undefined;
  return item.href ? (
    <Link href={item.href} className={styles.row} data-removed={muted}>
      {inner}
    </Link>
  ) : (
    <span className={styles.row} data-removed={muted}>
      {inner}
    </span>
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
