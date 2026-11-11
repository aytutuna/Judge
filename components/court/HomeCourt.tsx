"use client";

import { useEffect, useRef, useState } from "react";
import { useGame } from "@/lib/game";
import { freshVenue } from "@/lib/venues";
import { Court } from "./Court";
import styles from "./Court.module.css";

// The New page's court: scouts shooting hoops in whatever room the form
// leaves, and nothing at all when that is too little to see.
export function HomeCourt({ busy, className }: { busy: boolean; className?: string }) {
  const game = useGame();
  const ref = useRef<HTMLDivElement>(null);
  const [roomy, setRoomy] = useState(false);
  const [venue] = useState(freshVenue);

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      setRoomy(false);
      return;
    }
    const ro = new ResizeObserver(([e]) => setRoomy(e.contentRect.height >= 110));
    ro.observe(el);
    return () => ro.disconnect();
  }, [game]);

  if (!game) return null;
  return (
    <div ref={ref} className={className ? `${styles.home} ${className}` : styles.home} aria-hidden>
      {roomy ? <Court scene={{ kind: "home", busy, venue }} className={styles.fit} /> : null}
    </div>
  );
}
