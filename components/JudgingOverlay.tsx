"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { sceneVerdictFrom } from "@/lib/balance";
import { t, type Lang } from "@/lib/i18n";
import { REVEAL_HOLD_MS, judgeDots, judgingBeatFor, progressAt } from "@/lib/judging-ui";
import { resetScene, setSceneMode } from "@/lib/scene-bridge";
import { INITIAL_STATE, announcement, plan, type DigState } from "@/lib/thinking";
import { KEY_BY_CAPTION } from "@/lib/thinking-keys";
import type { VerdictResult } from "@/lib/types";
import { useReducedMotion } from "./scene/useReducedMotion";
import styles from "./JudgingOverlay.module.css";

/**
 * Shown while a real verdict request is pending. lib/thinking.ts's plan()
 * drives the timing: the story is told once, later cycles just say the judges are still out, and a response
 * can land at any moment. Then the judge dots take each run's colour, the
 * 3D balance tips (via the scene bridge), and after a short hold onFinished
 * hands over to the verdict.
 *
 * Accessibility: one polite live region (announcement() semantics, plus
 * the premium web-check line below); the visible caption and fact-check row
 * are aria-hidden so nothing is read twice.
 *
 * `premium` adds the web fact-check row and swaps the helper text. The row
 * says "finished" only once `done`.
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

  const dots = judgeDots(result, done);
  const caption = t(lang, KEY_BY_CAPTION[announcement(state, done)]);
  const checkText = t(lang, done ? "thinking.factcheckDone" : "thinking.factcheck");

  return (
    <div className={styles.root}>
      <p className={styles.eyebrow}>{t(lang, "thinking.eyebrow")}</p>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {caption}
      </p>

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

      <p className={styles.caption} aria-hidden="true">
        {caption}
      </p>

      <div className={styles.bar} aria-hidden="true">
        <span ref={barRef} />
      </div>

      {/* The row is aria-hidden, so the web check gets its own
          screen-reader line, mounted from the start: it reads as in
          progress and is announced as finished only once the verdict is in. */}
      {premium ? (
        <>
          <p className={styles.check} aria-hidden="true">
            <svg viewBox="0 0 20 20">
              {done ? (
                <path d="M4.5 10.5 8.5 14.5 15.5 6" strokeWidth="2" />
              ) : (
                <path
                  d="M10 2.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15ZM2.5 10h15M10 2.5c2 2.2 3 4.7 3 7.5s-1 5.3-3 7.5c-2-2.2-3-4.7-3-7.5s1-5.3 3-7.5Z"
                  strokeWidth="1.5"
                />
              )}
            </svg>
            {checkText}
          </p>
          <p className="sr-only" aria-live="polite" aria-atomic="true">
            {checkText}
          </p>
        </>
      ) : null}
      <p className={styles.helper}>{t(lang, premium ? "thinking.premiumHelper" : "thinking.helper")}</p>
    </div>
  );
}
