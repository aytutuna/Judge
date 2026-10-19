"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { sceneVerdictFrom } from "@/lib/balance";
import { t, type Lang } from "@/lib/i18n";
import {
  CHECKLIST_KEYS,
  REVEAL_HOLD_MS,
  checklistState,
  judgeDots,
  judgingBeatFor,
  premiumCaptionKey,
  progressAt,
} from "@/lib/judging-ui";
import { resetScene, setSceneMode } from "@/lib/scene-bridge";
import { INITIAL_STATE, announcement, plan, type DigState } from "@/lib/thinking";
import { KEY_BY_CAPTION } from "@/lib/thinking-keys";
import type { VerdictResult } from "@/lib/types";
import { PremiumSpark } from "./PremiumBadge";
import { useReducedMotion } from "./scene/useReducedMotion";
import styles from "./JudgingOverlay.module.css";

/**
 * Shown while a real verdict request is pending. lib/thinking.ts's plan()
 * drives the timing: the story is told once, later cycles just say the judges are still out, and a response
 * can land at any moment. Then the checklist completes, the judge dots take
 * each run's colour, the 3D balance tips (via the scene bridge), and after
 * a short hold onFinished hands over to the verdict.
 *
 * Accessibility: one polite live region (announcement() semantics); the
 * visible checklist and captions are aria-hidden so nothing is read twice.
 *
 * `premium` adds one plain-text line above the checklist for the web
 * fact-check and swaps the helper text; without it the markup is unchanged.
 */
export function JudgingOverlay({
  lang,
  done,
  result,
  onFinished,
  premium = false,
}: {
  lang: Lang;
  done: boolean;
  result: VerdictResult | null;
  onFinished: () => void;
  premium?: boolean;
}) {
  const reduced = useReducedMotion();
  const [state, setState] = useState<DigState>(INITIAL_STATE);
  const [finished, setFinished] = useState(false);
  const finish = useEffectEvent(onFinished);
  const barRef = useRef<HTMLSpanElement>(null);
  const startedAt = useRef(0);
  const publishedVerdict = useRef(false);

  // The lib/thinking.ts state machine.
  useEffect(() => {
    if (finished) return;
    const skip = reduced || document.hidden;
    const { to, delayMs } = plan(state, done, skip);
    const id = setTimeout(() => (to === "finish" ? setFinished(true) : setState(to)), delayMs);
    return () => clearTimeout(id);
  }, [state, done, reduced, finished]);

  // Hold so the votes and the tilt read, then hand off.
  useEffect(() => {
    if (!finished) return;
    const id = setTimeout(() => finish(), reduced ? 0 : REVEAL_HOLD_MS);
    return () => clearTimeout(id);
  }, [finished, reduced]);

  // Scene bridge: judging beats while waiting, the verdict once it is in.
  useEffect(() => {
    if (done && result) {
      setSceneMode({ kind: "verdict", verdict: sceneVerdictFrom(result) });
      publishedVerdict.current = true;
    } else if (!done) {
      setSceneMode({ kind: "judging", beat: judgingBeatFor(state) });
    }
  }, [state, done, result]);

  // Unmounted without a verdict (request error): back to idle.
  useEffect(
    () => () => {
      if (!publishedVerdict.current) resetScene();
    },
    [],
  );

  // Progress bar: written straight to the DOM, no re-renders.
  useEffect(() => {
    if (!startedAt.current) startedAt.current = performance.now();
    const paint = () => {
      const p = progressAt(performance.now() - startedAt.current, done);
      if (barRef.current) barRef.current.style.transform = `scaleX(${p.toFixed(4)})`;
    };
    paint();
    if (done) return;
    const id = setInterval(paint, 250);
    return () => clearInterval(id);
  }, [done]);

  const list = checklistState(state, done);
  const dots = judgeDots(result, done);

  return (
    <div className={styles.root} data-ready={list.ready ? "" : undefined}>
      <p className={styles.eyebrow}>{t(lang, "thinking.eyebrow")}</p>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {t(lang, KEY_BY_CAPTION[announcement(state, done)])}
      </p>

      {premium ? (
        <p className={`${styles.row} ${styles.premiumRow}`} data-status={done ? "done" : "active"}>
          <span className={styles.icon} />
          <span>{t(lang, premiumCaptionKey(done))}</span>
          <PremiumSpark className={styles.premiumSpark} />
        </p>
      ) : null}

      <ol className={styles.steps} aria-hidden="true">
        {CHECKLIST_KEYS.map((key, i) => (
          <li key={key} className={styles.row} data-status={list.rows[i]}>
            <span className={styles.icon} />
            <span>
              {list.stillJudging && list.rows[i] === "active" ? t(lang, "thinking.stillJudging") : t(lang, key)}
            </span>
          </li>
        ))}
      </ol>

      <div className={styles.bar} aria-hidden="true">
        <span ref={barRef} />
      </div>

      <div className={styles.judges} aria-hidden="true">
        {dots.map((d, i) => (
          <span
            key={i}
            className={styles.dot}
            data-vote={d}
            data-extra={i >= 3 ? "" : undefined}
            style={{ transitionDelay: `${i * 120}ms`, animationDelay: `${i * 120}ms` }}
          />
        ))}
      </div>

      <p className={styles.ready} aria-hidden="true">
        {t(lang, "thinking.ready")}
      </p>
      <p className={styles.helper}>{t(lang, premium ? "thinking.premiumHelper" : "thinking.helper")}</p>
    </div>
  );
}
