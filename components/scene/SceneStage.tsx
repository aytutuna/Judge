"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, type ReactNode } from "react";
import { tiltFromTug } from "@/lib/balance";
import type { Lang } from "@/lib/i18n";
import { resetScene, setPointer, useSceneMode, useSceneStatus, useSceneYou } from "@/lib/scene-bridge";
import { avoidOpacityIn, watchAvoidLayout } from "./avoid";
import { BalanceFallback } from "./BalanceFallback";
import { useSceneGate } from "./gate";
import { useReducedMotion } from "./useReducedMotion";
import styles from "./SceneStage.module.css";

/**
 * One sticky stage behind the hero and the story, holding one WebGL canvas.
 *
 * SSR renders the SVG balance in the same box (first paint, no layout
 * shift). three.js is only fetched once useSceneGate passes: after `load`
 * plus an idle callback, with the stage near the viewport, WebGL available
 * and no data saver. Otherwise the status becomes "fallback" and the SVG
 * stays. When the engine reports "ready" the canvas crossfades in.
 *
 * Children (hero, story) sit above the stage at z-index 1. Text that the
 * balance must never ghost through on mobile carries `data-scene-avoid`;
 * the overlap fade applies to the canvas (BalanceScene) and to the SVG
 * alike, so no-WebGL and data-saver visitors, and anyone scrolling before
 * three.js has loaded, never see the drawing under the text either.
 * `data-tilt` mirrors the verdict tilt from the bridge (debugging, e2e).
 */

const BalanceScene = dynamic(() => import("./BalanceScene"), { ssr: false, loading: () => null });

export function SceneStage({ lang, children }: { lang: Lang; children: ReactNode }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const mode = useSceneMode();
  const status = useSceneStatus();
  const you = useSceneYou();
  const reduced = useReducedMotion();
  const go = useSceneGate(stageRef);

  // The judging overlay keeps its verdict tilt published after it unmounts
  // (home, cases), so a stage opened by client navigation starts level, and
  // leaving clears it for the next one.
  useEffect(() => {
    resetScene();
    return () => resetScene();
  }, []);

  // Pointer parallax: fine pointers only, passive, no React state.
  useEffect(() => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const onMove = (e: PointerEvent) =>
      setPointer((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
    // Leaving the window recentres the balance instead of freezing it tilted.
    const onLeave = () => setPointer(0, 0);
    const root = document.documentElement;
    window.addEventListener("pointermove", onMove, { passive: true });
    root.addEventListener("mouseleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      root.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  const tugA = mode.kind === "verdict" ? mode.verdict.tugA : undefined;
  const tilt = tugA === undefined ? 0 : tiltFromTug(tugA);

  // Overlap fade for the SVG: its drawn extent (getBBox, which includes the
  // tipped beam and a sphere lifted above the viewBox) against the text.
  // Written to --avoid so the "ready" crossfade rule still wins.
  useEffect(() => {
    const stage = stageRef.current;
    const wrap = stage?.parentElement;
    const svg = stage?.querySelector<SVGSVGElement>("svg");
    if (!stage || !wrap || !svg) return;
    const fade = () => {
      const r = svg.getBoundingClientRect();
      const vbWidth = svg.viewBox.baseVal?.width;
      if (!r.width || !vbWidth) return;
      let b: DOMRect;
      try {
        b = svg.getBBox();
      } catch {
        return;
      }
      const k = r.width / vbWidth;
      const op = avoidOpacityIn(wrap, {
        top: r.top + b.y * k,
        bottom: r.top + (b.y + b.height) * k,
        left: r.left + b.x * k,
        right: r.left + (b.x + b.width) * k,
      });
      svg.style.setProperty("--avoid", op.toFixed(3));
    };
    return watchAvoidLayout(wrap, fade);
  }, [tugA]);

  return (
    <div
      className={styles.wrap}
      data-scene-wrap=""
      data-scene-status={status}
      data-scene-mode={mode.kind}
      data-tilt={tilt.toFixed(3)}
      data-lang={lang}
    >
      <div ref={stageRef} className={styles.stage} aria-hidden="true">
        <BalanceFallback tugA={tugA} you={you} className={styles.fallback} />
        {go && status !== "fallback" ? <BalanceScene reduced={reduced} className={styles.canvas} /> : null}
      </div>
      {children}
    </div>
  );
}
