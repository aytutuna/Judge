"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { sceneVerdictFrom } from "@/lib/balance";
import type { Party } from "@/lib/palette";
import { resetScene, setSceneMode, setSceneYou } from "@/lib/scene-bridge";
import type { VerdictResult } from "@/lib/types";
import { tugFinal } from "@/lib/verdict-display";
import { BalanceFallback } from "../scene/BalanceFallback";
import JudgingScene from "../scene/JudgingScene";
import styles from "./verdict.module.css";

// The scene bridge holds one mode, so one card at a time drives the 3D
// scale; the others keep the drawing until it leaves the screen.
let holder: object | null = null;
const waiting = new Set<() => void>();

function useHolder(ref: RefObject<HTMLElement | null>): boolean {
  const [mine, setMine] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const me = {};
    let near = false;
    const release = () => {
      holder = null;
      setMine(false);
      for (const retry of [...waiting]) retry();
    };
    const update = () => {
      if (near && holder === null) {
        holder = me;
        setMine(true);
      } else if (!near && holder === me) release();
    };
    waiting.add(update);
    const io = new IntersectionObserver(
      (entries) => {
        near = entries[entries.length - 1].isIntersecting;
        update();
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      waiting.delete(update);
      if (holder === me) release();
    };
  }, [ref]);
  return mine;
}

/** The card's balance: the drawing, replaced by the playable 3D scale at the
 * verdict's tilt while the card is on screen. */
export function VerdictScale({ result, you }: { result: VerdictResult; you: Party | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const mine = useHolder(ref);
  const verdict = useMemo(() => sceneVerdictFrom(result), [result]);

  useEffect(() => {
    if (!mine) return;
    setSceneYou(you);
    setSceneMode({ kind: "verdict", verdict });
  }, [mine, you, verdict]);

  useEffect(() => {
    if (!mine) return;
    return () => {
      resetScene();
      setSceneYou(null);
    };
  }, [mine]);

  return (
    <div ref={ref} className={`${styles.scene} ${styles.sceneLive}`}>
      {mine ? (
        <JudgingScene play className={styles.sceneFill} />
      ) : (
        <BalanceFallback tugA={result.model_refused ? 50 : tugFinal(result)} you={you} />
      )}
    </div>
  );
}
