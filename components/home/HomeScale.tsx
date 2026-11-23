"use client";

import { useEffect } from "react";
import { useGame } from "@/lib/game";
import { resetScene } from "@/lib/scene-bridge";
import JudgingScene from "@/components/scene/JudgingScene";
import styles from "./HomeScale.module.css";

// With the court art off, the same frame holds the balance, which can be played with.
export function HomeScale({ className }: { className?: string }) {
  const game = useGame();
  // A verdict left published by a case page would freeze the scale in its pose.
  useEffect(() => {
    resetScene();
  }, []);
  if (game) return null;
  return (
    <div className={className} aria-hidden>
      <JudgingScene play className={styles.scale} />
    </div>
  );
}
