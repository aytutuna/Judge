"use client";

import { useEffect, useRef } from "react";
import { getSceneMode, getSceneStatus, sceneOutput, setSceneStatus, setSceneTheme } from "@/lib/scene-bridge";
import { resolvedDark, useTheme } from "@/lib/theme";
import { avoidOpacityIn, watchAvoidLayout } from "./avoid";
import { createBalanceEngine, type BalanceEngine } from "./engine";
import { watchActivity } from "./engine/loop";

/**
 * The WebGL canvas. Loaded lazily by SceneStage and JudgingScene
 * (next/dynamic, ssr: false), so three.js lives in its own chunk and never
 * in the initial JS.
 *
 * Owns the engine's lifecycle: created on mount, sized to the sticky stage,
 * paused offscreen or in a hidden tab, disposed on unmount (client-side
 * navigation to another page frees the GPU context). Each engine gets a
 * canvas of its own, created here: dispose() force-loses its context, and a
 * remount on the same element (StrictMode, Fast Refresh) would otherwise
 * inherit a lost context.
 *
 * On the stage, under 960px, it also fades the canvas where the balance
 * would ghost through text (components/scene/avoid.ts). Judging always
 * shows the canvas. A card has no text over it and never fades.
 */

export default function BalanceScene({
  reduced,
  className,
  frame = "stage",
  play = false,
}: {
  reduced: boolean;
  className?: string;
  frame?: "stage" | "card";
  /** Balls can be grabbed and thrown with the pointer. */
  play?: boolean;
}) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const engineRef = useRef<BalanceEngine | null>(null);

  // Before the engine effect, so the first frame is already in the right
  // theme. System mode follows the OS and tracks its changes.
  const theme = useTheme();
  useEffect(() => {
    const dark = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => setSceneTheme(resolvedDark(theme) ? "dark" : "light");
    apply();
    dark.addEventListener("change", apply);
    return () => dark.removeEventListener("change", apply);
  }, [theme]);

  useEffect(() => {
    const stage = hostRef.current?.parentElement;
    if (!stage) return;
    const card = frame === "card";
    const wrap: Element = (!card && stage.closest("[data-scene-wrap]")) || stage;

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
        frame,
        play,
        onReady: () => setSceneStatus("ready"),
        onLost: () => setSceneStatus("fallback"),
        onFrame: card ? undefined : fade,
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

    let stopPlay = () => {};
    if (play) {
      const at = (e: { clientX: number; clientY: number }) => {
        const r = canvas.getBoundingClientRect();
        return [e.clientX - r.left, e.clientY - r.top] as const;
      };
      let grabId: number | null = null;
      const drop = () => {
        grabId = null;
        canvas.style.cursor = "";
      };
      const down = (e: PointerEvent) => {
        if (grabId !== null) return;
        if (e.pointerType === "mouse" && (e.button !== 0 || e.ctrlKey)) return;
        if (!eng.pointerDown(...at(e))) return;
        grabId = e.pointerId;
        e.preventDefault();
        canvas.setPointerCapture(e.pointerId);
        canvas.style.cursor = "grabbing";
      };
      const move = (e: PointerEvent) => {
        if (grabId === null) {
          if (e.pointerType !== "touch") canvas.style.cursor = eng.hitBall(...at(e)) ? "grab" : "";
        } else if (e.pointerId === grabId && !eng.pointerMove(...at(e))) drop();
      };
      const up = (e: PointerEvent) => {
        if (e.pointerId !== grabId) return;
        drop();
        eng.pointerUp(...at(e));
      };
      const cancel = (e: PointerEvent) => {
        if (e.pointerId !== grabId) return;
        drop();
        eng.pointerCancel();
      };
      // pointerdown runs before touchstart, so a grab is already on by then.
      // A swipe that starts off the balls still scrolls the page.
      const touch = (e: TouchEvent) => {
        if (grabId !== null || (e.touches.length === 1 && eng.hitBall(...at(e.touches[0])))) e.preventDefault();
      };
      const touchMove = (e: TouchEvent) => {
        if (grabId !== null) e.preventDefault();
      };
      canvas.addEventListener("pointerdown", down);
      canvas.addEventListener("pointermove", move);
      canvas.addEventListener("pointerup", up);
      canvas.addEventListener("pointercancel", cancel);
      canvas.addEventListener("lostpointercapture", cancel);
      canvas.addEventListener("touchstart", touch, { passive: false });
      canvas.addEventListener("touchmove", touchMove, { passive: false });
      stopPlay = () => {
        canvas.removeEventListener("pointerdown", down);
        canvas.removeEventListener("pointermove", move);
        canvas.removeEventListener("pointerup", up);
        canvas.removeEventListener("pointercancel", cancel);
        canvas.removeEventListener("lostpointercapture", cancel);
        canvas.removeEventListener("touchstart", touch);
        canvas.removeEventListener("touchmove", touchMove);
      };
    }

    const stopWatching = watchActivity(wrap, (active) => (active ? eng.start() : eng.stop()));

    // The fade also has to follow layout changes when no frames run
    // (reduced motion, a settled scene): scrolling, the hero's phase flip.
    const stopAvoid = card ? () => {} : watchAvoidLayout(wrap, fade);

    return () => {
      stopPlay();
      stopAvoid();
      stopWatching();
      ro.disconnect();
      engineRef.current = null;
      eng.dispose();
      canvas.remove();
      // A later mount must crossfade again from the SVG.
      if (getSceneStatus() === "ready") setSceneStatus("loading");
    };
  }, [className, frame, play]);

  useEffect(() => {
    engineRef.current?.setReduced(reduced);
  }, [reduced]);

  // The canvas is appended next to this marker, directly in the stage.
  return <span ref={hostRef} hidden />;
}
