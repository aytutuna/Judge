"use client";

import { t, type Lang } from "@/lib/i18n";
import type { VerdictResult } from "@/lib/types";
import { JudgingOverlay } from "./JudgingOverlay";
import JudgingScene from "./scene/JudgingScene";
import styles from "./JudgingScreen.module.css";

export type JudgedSide = { name: string; text: string };

/** The home page while a verdict is being made: the sides as submitted, the
 * scene with the judging overlay under it, and a way out. */
export function JudgingScreen({
  lang,
  mine,
  theirs,
  done,
  result,
  onFinished,
  onCancel,
}: {
  lang: Lang;
  mine: JudgedSide | null;
  theirs: JudgedSide | null;
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
      </div>
      <div className={styles.card}>
        <JudgingScene className={styles.scene} />
        <JudgingOverlay lang={lang} done={done} result={result} onFinished={onFinished} premium />
      </div>
      {done ? null : (
        <button type="button" className={styles.cancel} onClick={onCancel}>
          {t(lang, "case.cancel")}
        </button>
      )}
    </div>
  );
}
