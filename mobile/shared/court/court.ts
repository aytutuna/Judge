import { createCourt, type CourtScene } from "@/components/court/engine";

/**
 * Entry of the page the native apps show for the street court (bundled by
 * build-scene.ts, with the art inlined as COURT_ART). Native code drives it
 * through window.judgeCourt and hears "ready" back through its message handler.
 */

declare const COURT_ART: Record<string, string>;

declare global {
  interface Window {
    judgeCourt: {
      set(scene: CourtScene | string): void;
      setReduced(on: boolean): void;
    };
    webkit?: { messageHandlers?: { judgeCourt?: { postMessage(msg: unknown): void } } };
    JudgeCourt?: { onEvent(type: string): void };
  }
}

const BEATS = ["names", "facts", "judges", "bothSides", "crux", "ruling", "vote1", "more", "vote2", "trial", "final"];
const VOTES = ["a", "b", "other"];
const TRIALS = ["survived", "uncertain", "overturned"];

function post(type: string) {
  window.webkit?.messageHandlers?.judgeCourt?.postMessage({ type });
  window.JudgeCourt?.onEvent(type);
}

function parse(input: CourtScene | string): CourtScene {
  const s = typeof input === "string" ? JSON.parse(input) : input;
  if (s?.kind === "home") return { kind: "home", busy: !!s.busy };
  if (s?.kind === "judging" && BEATS.includes(s.beat) && Array.isArray(s.votes) && s.votes.every((v: string) => VOTES.includes(v))) {
    return {
      kind: "judging",
      beat: s.beat,
      votes: [...s.votes],
      extra: Math.max(0, Number(s.extra) || 0),
      winner: s.winner === "a" || s.winner === "b" ? s.winner : null,
      trial: TRIALS.includes(s.trial) ? s.trial : null,
    };
  }
  throw new Error(`bad court scene: ${JSON.stringify(s)}`);
}

const canvas = document.createElement("canvas");
canvas.setAttribute("role", "presentation");
document.body.appendChild(canvas);

const court = createCourt(canvas, {
  src: (name) => COURT_ART[name],
  reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
  onReady: () => post("ready"),
});

window.judgeCourt = {
  set: (scene) => court.set(parse(scene)),
  setReduced: (on) => court.setReduced(!!on),
};
