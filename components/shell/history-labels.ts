import { t, tWithDate, type Lang } from "@/lib/i18n";
import { partyLabel } from "@/lib/names";
import type { HistoryItem } from "./useHistory";

/** The ruling from the viewer's side: "You're right", "{name} is right",
 * or the outcome itself. */
function rulingLabel(lang: Lang, item: HistoryItem): string {
  if (item.winner !== undefined) {
    if (item.winner === null) return t(lang, "verdict.tooClose");
    if (item.winner === item.party) return item.self ? t(lang, "verdict.win", { name: item.self }) : t(lang, "verdict.winSelf");
    return t(lang, "verdict.win", { name: item.other ?? partyLabel(lang, item.winner) });
  }
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
export function tone(item: HistoryItem): "yours" | "theirs" | undefined {
  if (item.state === "ready" && item.winner !== undefined) {
    return item.winner === null ? undefined : item.winner === item.party ? "yours" : "theirs";
  }
  if (item.state !== "ready" || (item.verdict !== "side_a" && item.verdict !== "side_b")) return undefined;
  return item.verdict === (item.party === "a" ? "side_a" : "side_b") ? "yours" : "theirs";
}

/** The row's headline, or a stand-in while it has none. */
export function titleOf(lang: Lang, item: HistoryItem): string {
  return (
    item.title ??
    (item.kind === "case"
      ? tWithDate(lang, "case.list.untitled", item.at)
      : item.state === "removed"
        ? t(lang, "history.state.removed")
        : t(lang, "shell.untitled"))
  );
}
