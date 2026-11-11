"use client";

import { t, type Lang } from "@/lib/i18n";
import { partyLabel } from "@/lib/names";
import type { VerdictResult } from "@/lib/types";
import { JudgingStory } from "./court/JudgingStory";
import styles from "./JudgingScreen.module.css";

export type JudgedSide = { name: string; text: string };

/** The home page while a verdict is being made: the sides as submitted, the
 * judges at work with what they're doing written under them, and a way out.
 * `more` holds sides C and D. */
export function JudgingScreen({
  lang,
  mine,
  theirs,
  more = [],
  venue,
  accepted = false,
  done,
  result,
  onFinished,
  onCancel,
}: {
  lang: Lang;
  mine: JudgedSide | null;
  theirs: JudgedSide | null;
  more?: readonly JudgedSide[];
  venue?: string;
  accepted?: boolean;
  done: boolean;
  result: VerdictResult | null;
  onFinished: () => void;
  onCancel: () => void;
}) {
  return (
    <div className={styles.root}>
      <div className={styles.tiles}>
        {mine ? (
          <div className={styles.tile} data-side="A">
            <p className={styles.name}>{mine.name.trim() || t(lang, "input.labelTwoSided")}</p>
            <p className={styles.text}>{mine.text}</p>
          </div>
        ) : null}
        {theirs ? (
          <div className={styles.tile} data-side="B">
            <p className={styles.name}>{theirs.name.trim() || t(lang, "home.theirSide")}</p>
            <p className={styles.text}>{theirs.text}</p>
          </div>
        ) : null}
        {more.map((side, i) => {
          const party = i ? "d" : "c";
          return (
            <div key={party} className={styles.tile} data-side={party.toUpperCase()}>
              <p className={styles.name}>{side.name.trim() || partyLabel(lang, party)}</p>
              <p className={styles.text}>{side.text}</p>
            </div>
          );
        })}
      </div>
      <div className={styles.card}>
        <JudgingStory
          lang={lang}
          accepted={accepted}
          done={done}
          result={result}
          sides={2 + more.length}
          venue={venue}
          onFinished={onFinished}
        />
      </div>
      {done ? null : (
        <button type="button" className={styles.cancel} onClick={onCancel}>
          {t(lang, "case.cancel")}
        </button>
      )}
    </div>
  );
}
