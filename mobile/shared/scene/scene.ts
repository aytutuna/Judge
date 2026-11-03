import { createBalanceEngine, type BalanceEngine } from "@/components/scene/engine";
import { watchActivity } from "@/components/scene/engine/loop";
import { greenParty, type Party } from "@/lib/palette";
import {
  getSceneMode,
  getSceneYou,
  resetScene,
  sceneInput,
  setPointer,
  setSceneMode,
  setSceneTheme,
  setSceneYou,
  subscribeScene,
  type JudgingBeat,
  type SceneMode,
  type SceneTheme,
  type Vote,
} from "@/lib/scene-bridge";
import { tiltDeg, tiltTransform } from "./fallback";

/**
 * Entry of the page the native apps show in the judging card (bundled by
 * build-scene.ts). Native code drives it through window.judgeScene and gets
 * "ready", "fallback" and "lost" back through its message handler.
 */

type SceneEvent = "ready" | "fallback" | "lost";

declare global {
  interface Window {
    judgeScene: {
      setMode(mode: SceneMode | string): void;
      setYou(party: Party | null): void;
      setTheme(theme: SceneTheme): void;
      setReduced(on: boolean): void;
      setPointer(x: number, y: number): void;
      reset(): void;
    };
    webkit?: { messageHandlers?: { judgeScene?: { postMessage(msg: unknown): void } } };
    JudgeScene?: { onEvent(type: string): void };
  }
}

const BEATS: readonly JudgingBeat[] = ["lift", "sort", "dig", "crux", "orbs", "deliberate"];
const VOTES: readonly Vote[] = ["a", "b", "other"];

function post(type: SceneEvent) {
  window.webkit?.messageHandlers?.judgeScene?.postMessage({ type });
  window.JudgeScene?.onEvent(type);
}

function parseMode(input: SceneMode | string): SceneMode {
  const m = typeof input === "string" ? JSON.parse(input) : input;
  if (m?.kind === "idle") return { kind: "idle" };
  if (m?.kind === "judging" && BEATS.includes(m.beat)) return { kind: "judging", beat: m.beat };
  const v = m?.kind === "verdict" ? m.verdict : null;
  if (v && Number.isFinite(v.tugA) && Array.isArray(v.votes) && v.votes.every((x: Vote) => VOTES.includes(x))) {
    return { kind: "verdict", verdict: { tugA: Math.max(0, Math.min(100, v.tugA)), votes: [...v.votes] } };
  }
  throw new Error(`bad scene mode: ${JSON.stringify(m)}`);
}

const body = document.body;
const fallback = document.getElementById("fallback");
const beam = document.getElementById("beam");
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
let engine: BalanceEngine | null = null;

function setStatus(status: "ready" | "fallback") {
  body.dataset.status = status;
  post(status === "ready" ? "ready" : "fallback");
}

function tiltFallback() {
  const mode = getSceneMode();
  beam?.setAttribute("transform", tiltTransform(tiltDeg(mode.kind === "verdict" ? mode.verdict.tugA : undefined)));
  if (fallback) fallback.dataset.you = greenParty(getSceneYou());
}

subscribeScene(tiltFallback);
// The system's choice until native code says which theme the app is in.
setSceneTheme(matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
body.dataset.reduced = String(reduced);

const canvas = document.createElement("canvas");
canvas.setAttribute("role", "presentation");
body.appendChild(canvas);

const coarse = matchMedia("(pointer: coarse)").matches;
const small = coarse || Math.min(innerWidth, innerHeight) < 700;

try {
  engine = createBalanceEngine(canvas, {
    small,
    shadows: !small,
    reduced,
    frame: "card",
    onReady: () => setStatus("ready"),
    onLost: () => {
      body.dataset.status = "fallback";
      post("lost");
    },
  });
} catch {
  canvas.remove();
  setStatus("fallback");
}

if (engine) {
  const eng = engine;
  const size = () => eng.resize(innerWidth, innerHeight);
  size();
  new ResizeObserver(size).observe(document.documentElement);
  watchActivity(canvas, (active) => (active ? eng.start() : eng.stop()));
}

window.judgeScene = {
  setMode: (mode) => setSceneMode(parseMode(mode)),
  setYou: (party) => setSceneYou(party === "a" || party === "b" ? party : null),
  setTheme(theme) {
    const t = theme === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = t;
    setSceneTheme(t);
  },
  setReduced(on) {
    body.dataset.reduced = String(on);
    engine?.setReduced(on);
  },
  setPointer,
  reset() {
    resetScene();
    sceneInput.px = 0;
    sceneInput.py = 0;
  },
};
