"use client";

import { useGame } from "@/lib/game";
import type { Venue } from "@/lib/venues";
import { Court } from "./Court";

// The New page's court: scouts shooting hoops in a fixed 16:9 frame that
// scrolls with the page.
export function HomeCourt({ busy, venue, className }: { busy: boolean; venue: Venue; className?: string }) {
  const game = useGame();
  if (!game) return null;
  return (
    <div className={className} aria-hidden>
      <Court scene={{ kind: "home", busy, venue }} />
    </div>
  );
}
