"use client";

import dynamic from "next/dynamic";
import { useRef, type PointerEvent } from "react";
import { setPointer, useSceneMode, useSceneStatus } from "@/lib/scene-bridge";
import { BalanceFallback } from "./BalanceFallback";
import { useSceneGate } from "./gate";
import { useReducedMotion } from "./useReducedMotion";
import styles from "./JudgingScene.module.css";

/**
 * The balance in a box of its own, for the judging card. The host sizes it
 * through `className`; the module only gives a default aspect. Shows the
 * SVG first (and for good when WebGL is off, data saver is on or the context
 * is lost), then crossfades to the 3D scene framed for a card. The scene
 * mode belongs to whoever drives the run (JudgingOverlay), so nothing here
 * resets it.
 */

const BalanceScene = dynamic(() => import("./BalanceScene"), { ssr: false, loading: () => null });

// Pointer play is kept light: the box is small and sits under text.
const POINTER = 0.6;

function onMove(e: PointerEvent<HTMLDivElement>) {
  if (e.pointerType === "touch") return;
  const r = e.currentTarget.getBoundingClientRect();
  setPointer((((e.clientX - r.left) / r.width) * 2 - 1) * POINTER, (((e.clientY - r.top) / r.height) * 2 - 1) * POINTER);
}

function onLeave(e: PointerEvent<HTMLDivElement>) {
  if (e.pointerType !== "touch") setPointer(0, 0);
}

export default function JudgingScene({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const mode = useSceneMode();
  const status = useSceneStatus();
  const reduced = useReducedMotion();
  const go = useSceneGate(ref);
  const tugA = mode.kind === "verdict" ? mode.verdict.tugA : undefined;

  return (
    <div
      ref={ref}
      className={className ? `${styles.box} ${className}` : styles.box}
      data-scene-mode={mode.kind}
      data-scene-status={status}
      aria-hidden="true"
      onPointerMove={onMove}
      onPointerLeave={onLeave}
    >
      <BalanceFallback tugA={tugA} className={styles.fallback} />
      {go && status !== "fallback" ? <BalanceScene reduced={reduced} frame="card" className={styles.canvas} /> : null}
    </div>
  );
}
