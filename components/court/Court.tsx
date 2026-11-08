"use client";

import { useEffect, useRef } from "react";
import { useReducedMotion } from "@/components/scene/useReducedMotion";
import { createCourt, type Court as CourtHandle, type CourtScene } from "./engine";
import styles from "./Court.module.css";

/** The street court, drawing whatever `scene` says. */
export function Court({ scene, className }: { scene: CourtScene; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const court = useRef<CourtHandle | null>(null);
  const reduced = useReducedMotion();
  const key = JSON.stringify(scene);

  useEffect(() => {
    const c = createCourt(ref.current as HTMLCanvasElement, { src: (name) => `/court/${name}.png`, reduced: false });
    court.current = c;
    return () => {
      c.dispose();
      court.current = null;
    };
  }, []);

  useEffect(() => {
    court.current?.setReduced(reduced);
  }, [reduced]);

  useEffect(() => {
    court.current?.set(JSON.parse(key));
  }, [key]);

  return <canvas ref={ref} className={className ? `${styles.court} ${className}` : styles.court} aria-hidden />;
}
