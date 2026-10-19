"use client";

import { useEffect, useRef } from "react";
import { getSceneMode, getSceneStatus, sceneOutput, setSceneStatus } from "@/lib/scene-bridge";
import { avoidOpacityIn, watchAvoidLayout } from "./avoid";
import { createBalanceEngine, type BalanceEngine } from "./engine";
import { watchActivity } from "./engine/loop";

/**
 * The WebGL canvas. Loaded lazily by SceneStage (next/dynamic, ssr: false),
 * so three.js lives in its own chunk and never in the initial JS.
 *
 * Owns the engine's lifecycle: created on mount, sized to the sticky stage,
 * paused offscreen or in a hidden tab, disposed on unmount (client-side
 * navigation to another page frees the GPU context). Each engine gets a
 * canvas of its own, created here: dispose() force-loses its context, and a
 * remount on the same element (StrictMode, Fast Refresh) would otherwise
 * inherit a lost context.
 *
 * Under 960px it also fades the canvas where the balance would ghost
 * through text (components/scene/avoid.ts). Judging always shows the canvas.
 */

export default function BalanceScene({ reduced, className }: { reduced: boolean; className?: string }) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const engineRef = useRef<BalanceEngine | null>(null);

  useEffect(() => {
    const stage = hostRef.current?.parentElement;
    if (!stage) return;
    const wrap: Element = stage.closest("[data-scene-wrap]") ?? stage;

    const canvas = document.createElement("canvas");
    if (className) canvas.className = className;
    canvas.setAttribute("role", "presentation");
    stage.appendChild(canvas);

    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const small = coarse || Math.min(window.innerWidth, window.innerHeight) < 700;
    const desktop = window.innerWidth >= 960;
    const startReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let opacity = -1;
    let engine: BalanceEngine | null = null;
    const setOpacity = (op: number) => {
      if (Math.abs(op - opacity) < 0.004 && (op === 0) === (opacity === 0)) return;
      opacity = op;
      canvas.style.opacity = op >= 1 ? "" : op.toFixed(3);
      canvas.style.visibility = op <= 0 ? "hidden" : "";
      engine?.setHidden(op <= 0);
    };

    const fade = () => {
      if (getSceneMode().kind === "judging") {
        setOpacity(1);
        return;
      }
      const r = sceneOutput.contentRect;
      if (!r) return;
      const c = canvas.getBoundingClientRect();
      setOpacity(
        avoidOpacityIn(wrap, {
          top: c.top + r.top,
          bottom: c.top + r.bottom,
          left: c.left + r.left,
          right: c.left + r.right,
        }),
      );
    };

    try {
      engine = createBalanceEngine(canvas, {
        small,
        shadows: !small && desktop,
        reduced: startReduced,
        onReady: () => setSceneStatus("ready"),
        onLost: () => setSceneStatus("fallback"),
        onFrame: fade,
      });
    } catch {
      canvas.remove();
      setSceneStatus("fallback");
      return;
    }
    engineRef.current = engine;
    const eng = engine;

    const size = () => eng.resize(stage.clientWidth, stage.clientHeight);
    size();
    const ro = new ResizeObserver(size);
    ro.observe(stage);

    const stopWatching = watchActivity(wrap, (active) => (active ? eng.start() : eng.stop()));

    // The fade also has to follow layout changes when no frames run
    // (reduced motion, a settled scene): scrolling, the hero's phase flip.
    const stopAvoid = watchAvoidLayout(wrap, fade);

    return () => {
      stopAvoid();
      stopWatching();
      ro.disconnect();
      engineRef.current = null;
      eng.dispose();
      canvas.remove();
      // A later mount must crossfade again from the SVG.
      if (getSceneStatus() === "ready") setSceneStatus("loading");
    };
  }, [className]);

  useEffect(() => {
    engineRef.current?.setReduced(reduced);
  }, [reduced]);

  // The canvas is appended next to this marker, directly in the stage.
  return <span ref={hostRef} hidden />;
}
