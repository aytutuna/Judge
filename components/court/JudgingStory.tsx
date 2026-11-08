"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { t, type Lang } from "@/lib/i18n";
import { stripLeadingEmoji } from "@/lib/text";
import type { VerdictResult } from "@/lib/types";
import { useReducedMotion } from "@/components/scene/useReducedMotion";
import { Court } from "./Court";
import { WAITING, ending, summarize, waitingAt, type Beat, type Line } from "./story";
import styles from "./Story.module.css";

function TypeLine({ text, reduced }: { text: string; reduced: boolean }) {
  const [n, setN] = useState(reduced ? text.length : 0);
  useEffect(() => {
    if (reduced) return;
    const id = setInterval(() => setN((c) => (c >= text.length ? c : c + 1)), 22);
    return () => clearInterval(id);
  }, [text, reduced]);
  return (
    <>
      {text.slice(0, reduced ? text.length : n)}
      <span className={styles.rest}>{reduced ? "" : text.slice(n)}</span>
    </>
  );
}

/**
 * The judging card: the street court acting out each step, and a running log
 * of what the system is doing under it. Holds the hand-off to the verdict
 * until the votes have played out.
 */
export function JudgingStory({
  lang,
  accepted,
  done,
  result,
  onFinished,
}: {
  lang: Lang;
  /** The server has the case, names out (its 202). */
  accepted: boolean;
  done: boolean;
  result: VerdictResult | null;
  onFinished: () => void;
}) {
  const reduced = useReducedMotion();
  const finish = useEffectEvent(onFinished);
  const started = useRef(0);
  const isAccepted = useRef(accepted);
  const [now, setNow] = useState(0);
  const [acceptedAt, setAcceptedAt] = useState<number | null>(null);
  const [reached, setReached] = useState(0);

  useEffect(() => {
    if (!started.current) started.current = performance.now();
    if (done) return;
    const id = setInterval(() => {
      const el = performance.now() - started.current;
      setNow(el);
      if (isAccepted.current) setAcceptedAt((a) => a ?? el);
    }, 250);
    return () => clearInterval(id);
  }, [done]);

  useEffect(() => {
    isAccepted.current = accepted;
  }, [accepted]);

  // The clock stops when the verdict lands, so this is where the story was then.
  const waiting = waitingAt(now, acceptedAt);
  const summary = useMemo(() => (result ? summarize(result) : null), [result]);
  const plan = useMemo(
    () => (done ? ending(waiting, summary, reduced || document.hidden) : null),
    // Planned once, when the verdict lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [done],
  );

  useEffect(() => {
    if (!plan) return;
    const timers = plan.steps.map((s, i) => setTimeout(() => setReached(i + 1), s.at));
    timers.push(setTimeout(() => finish(), plan.finishAt));
    return () => timers.forEach(clearTimeout);
  }, [plan]);

  const steps = plan ? plan.steps.slice(0, reached) : [];
  const lines: Line[] = [
    ...WAITING.slice(0, waiting + 1).map((k): Line => ({ key: `story.${k}` })),
    ...steps.flatMap((s) => (s.line ? [s.line] : [])),
  ];
  const beat: Beat = steps.length ? steps[steps.length - 1].beat : WAITING[waiting];
  const over = beat === "final";
  const last = lines.length - 1;
  const text = (l: Line) => {
    const s = t(lang, l.key, l.vars);
    return l.key.startsWith("trial.") ? stripLeadingEmoji(s) : s;
  };

  return (
    <div className={styles.root}>
      <p className={styles.eyebrow}>{t(lang, "thinking.eyebrow")}</p>
      <Court
        className={styles.stage}
        scene={{
          kind: "judging",
          beat,
          votes: summary?.votes ?? [],
          extra: summary?.extra ?? 0,
          winner: summary?.winner ?? null,
          trial: summary?.trial ?? null,
        }}
      />
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {text(lines[last])}
      </p>
      <ol className={styles.log} aria-hidden="true">
        {lines.map((l, i) => {
          const live = i === last && !over;
          return (
            <li key={`${l.key}${i}`} className={styles.line} data-live={live ? "" : undefined}>
              <span className={styles.mark}>
                {live ? (
                  <span className={styles.dots}>
                    <i />
                    <i />
                    <i />
                  </span>
                ) : (
                  <svg viewBox="0 0 20 20">
                    <path d="M4.5 10.5 8.5 14.5 15.5 6" />
                  </svg>
                )}
              </span>
              <span className={styles.text}>{i === last ? <TypeLine text={text(l)} reduced={reduced} /> : text(l)}</span>
            </li>
          );
        })}
      </ol>
      <p className={styles.helper}>{t(lang, "thinking.premiumHelper")}</p>
    </div>
  );
}
