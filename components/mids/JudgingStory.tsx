"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { sceneVerdictFrom } from "@/lib/balance";
import { t, type Key, type Lang } from "@/lib/i18n";
import type { VerdictResult } from "@/lib/types";
import { useReducedMotion } from "@/components/scene/useReducedMotion";
import { JudgingMids, type Beat } from "./JudgingMids";
import { WAITING, agreement, waitingAt } from "../court/story";
import styles from "./Story.module.css";

type Line = { key: Key; vars?: Record<string, number> };

// Once the verdict is in, the lines still to come go by at this pace.
const CATCH_UP_MS = 450;
const VOTE_MS = 420;

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
 * The judging card: the Mids acting out each step, and a running log of
 * what the system is doing under them. Holds the hand-off to the verdict
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
  const [end, setEnd] = useState<{ shown: number; extra: Line[]; beat: Beat | null; over: boolean }>({
    shown: 0,
    extra: [],
    beat: null,
    over: false,
  });

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

  const waiting = waitingAt(now, acceptedAt);
  const votes = result ? sceneVerdictFrom(result).votes : [];
  // Judges called in for a close one; the first round is the usual three.
  const extra = result?.escalated ? Math.max(0, votes.length - 3) : 0;

  // The verdict is in: finish the story, play the votes, then hand off.
  useEffect(() => {
    if (!done) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (reduced || document.hidden || !result) {
      timers.push(setTimeout(() => finish(), reduced ? 600 : 0));
      return () => timers.forEach(clearTimeout);
    }
    let at = 0;
    const later = (ms: number, fn: () => void) => {
      at += ms;
      timers.push(setTimeout(fn, at));
    };
    for (let i = waiting + 1; i < WAITING.length; i++) {
      later(i === waiting + 1 ? 0 : CATCH_UP_MS, () => setEnd((e) => ({ ...e, shown: i, beat: WAITING[i] })));
    }
    // A refusal has no votes to count, so it skips straight to the end.
    if (votes.length) {
      const first = Math.min(3, votes.length);
      later(CATCH_UP_MS, () =>
        setEnd((e) => ({ ...e, shown: WAITING.length - 1, extra: [{ key: "story.count" }], beat: "vote1" })),
      );
      at += 1200 + first * VOTE_MS;
    }
    if (result.escalated) {
      later(400, () => setEnd((e) => ({ ...e, extra: [...e.extra, { key: "story.closeCall" }], beat: "more" })));
      if (extra > 0) {
        later(2600, () => setEnd((e) => ({ ...e, beat: "vote2" })));
        at += extra * VOTE_MS;
      }
    }
    const { side, n } = agreement(votes);
    const verdictLine: Line | null = !votes.length
      ? null
      : side
        ? { key: "story.agree", vars: { n, total: votes.length } }
        : { key: "story.split" };
    later(600, () =>
      setEnd((e) => ({
        ...e,
        extra: [...e.extra, ...(verdictLine ? [verdictLine] : []), { key: "thinking.ready" }],
        beat: "final",
        over: true,
      })),
    );
    later(1900, () => finish());
    return () => timers.forEach(clearTimeout);
    // Runs once, when the verdict lands; `waiting` is where the story was then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, reduced]);

  const shown = done ? Math.max(waiting, end.shown) : waiting;
  const lines: Line[] = [...WAITING.slice(0, shown + 1).map((k) => ({ key: `story.${k}` as Key })), ...end.extra];
  const beat: Beat = done ? (end.beat ?? WAITING[waiting]) : WAITING[waiting];
  const last = lines.length - 1;
  const text = (l: Line) => t(lang, l.key, l.vars);

  return (
    <div className={styles.root}>
      <p className={styles.eyebrow}>{t(lang, "thinking.eyebrow")}</p>
      <JudgingMids className={styles.stage} beat={beat} votes={votes} extra={extra} />
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {text(lines[last])}
      </p>
      <ol className={styles.log} aria-hidden="true">
        {lines.map((l, i) => {
          const live = i === last && !end.over;
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
