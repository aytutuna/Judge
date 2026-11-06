"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { useReducedMotion } from "@/components/scene/useReducedMotion";
import { Cast, type Mid } from "./cast";
import { ASPECT, MidView } from "./MidView";
import styles from "./Mids.module.css";

export type Toss = { from: number; to: number; y: number; key: number; ms: number } | null;

/** Mid width for a stage of w × h holding n of them. */
export function midSize(w: number, h: number, n: number): number {
  return Math.round(Math.max(40, Math.min(72, w * 0.18, h * 0.3, (w * 0.7) / Math.max(n, 3))));
}

export function useCast(initial: () => Mid[]) {
  const [cast] = useState(() => {
    const listeners = new Set<() => void>();
    const c = new Cast(initial(), () => listeners.forEach((fn) => fn()));
    return Object.assign(c, {
      subscribe(fn: () => void) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    });
  });
  const mids = useSyncExternalStore(
    cast.subscribe,
    () => cast.mids,
    () => cast.mids,
  );
  const reduced = useReducedMotion();
  useEffect(() => {
    cast.setReduced(reduced);
  }, [cast, reduced]);
  useEffect(() => () => cast.stop(), [cast]);
  return { cast, mids, reduced };
}

/** Measures the stage and keeps the cast's idea of its size current. */
export function useBox(ref: RefObject<HTMLDivElement | null>, cast: Cast) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const w = Math.round(e.contentRect.width);
      const h = Math.round(e.contentRect.height);
      cast.w = w || cast.w;
      cast.h = h || cast.h;
      setBox((b) => (b.w === w && b.h === h ? b : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, cast]);
  return box;
}

/** Runs `start` while the tab is showing, and `stop` while it is not. */
export function useWhileVisible(start: () => void, stop: () => void, ready: boolean) {
  const go = useRef(start);
  const halt = useRef(stop);
  useEffect(() => {
    go.current = start;
    halt.current = stop;
  });
  useEffect(() => {
    if (!ready) return;
    const flip = () => (document.hidden ? halt.current() : go.current());
    if (!document.hidden) go.current();
    document.addEventListener("visibilitychange", flip);
    return () => {
      document.removeEventListener("visibilitychange", flip);
      halt.current();
    };
  }, [ready]);
}

export function Stage({
  stageRef,
  mids,
  box,
  toss,
  gaze,
  className,
  onPointerDown,
  children,
}: {
  stageRef: RefObject<HTMLDivElement | null>;
  mids: Mid[];
  box: { w: number; h: number };
  toss?: Toss;
  gaze?: (m: Mid) => [number, number] | null;
  className?: string;
  onPointerDown?: (x: number, y: number) => void;
  children?: ReactNode;
}) {
  const size = midSize(box.w, box.h, mids.length);
  const hand = size * ASPECT * 0.62;
  return (
    <div
      ref={stageRef}
      className={className ? `${styles.stage} ${className}` : styles.stage}
      aria-hidden
      onPointerDown={
        onPointerDown
          ? (e) => {
              const r = e.currentTarget.getBoundingClientRect();
              onPointerDown(e.clientX - r.left, e.clientY - r.top);
            }
          : undefined
      }
    >
      {box.w > 0
        ? mids.map((m, i) => {
            const g = gaze?.(m);
            return (
              <MidView
                key={i}
                m={g ? { ...m, look: g } : m}
                size={size}
                delay={(i * 1730) % 4600}
                w={box.w}
                h={box.h}
              />
            );
          })
        : null}
      {box.w > 0 ? children : null}
      {toss && box.w > 0 ? <Ball key={toss.key} toss={toss} w={box.w} top={toss.y * box.h - hand} arc={Math.round(size * 0.9)} /> : null}
    </div>
  );
}

function Ball({ toss, w, top, arc }: { toss: NonNullable<Toss>; w: number; top: number; arc: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const { from, to, ms } = toss;
  // Set off from the thrower, then let the transition carry it over.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.transitionDuration = "0ms";
    el.style.left = `${from * w}px`;
    // Flush the start position so the change to `to` is a transition.
    void el.getBoundingClientRect();
    el.style.transitionDuration = `${ms}ms`;
    el.style.left = `${to * w}px`;
  }, [from, to, ms, w]);
  return (
    <span
      ref={ref}
      className={styles.toss}
      style={{ top, ["--t" as string]: `${ms}ms`, ["--arc" as string]: `${-arc}px` }}
    >
      <span />
    </span>
  );
}

/** Where a tap at (px, py) lands, as a mid index, or -1. */
export function hit(mids: Mid[], box: { w: number; h: number }, px: number, py: number): number {
  const size = midSize(box.w, box.h, mids.length);
  const tall = size * ASPECT;
  let best = -1;
  let bestD = size * 0.6;
  mids.forEach((m, i) => {
    const d = Math.hypot(m.x * box.w - px, m.y * box.h - tall * 0.5 - py);
    if (d < bestD) [best, bestD] = [i, d];
  });
  return best;
}
