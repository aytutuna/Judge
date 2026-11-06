"use client";

import { useEffect, useRef, useState } from "react";
import { mid, pick, rand, run, weighted, type Cast, type Mid, type Run } from "./cast";
import { Stage, hit, midSize, useBox, useCast, useWhileVisible, type Toss } from "./Stage";
import styles from "./Mids.module.css";

// The New page's idle Mids: they wander, keep busy, pair up for a chat or a
// game of catch, and bunch up on send.

type Solo = (r: Run, i: number) => Promise<void>;
type Duo = (r: Run, a: number, b: number) => Promise<void>;

const CALM: Partial<Mid> = { arms: "rest", eyes: "open", prop: null, bubble: null, motion: "stand", look: [0, 0] };

// The fire pit, where the feet would be if a mid stood in it.
const FIRE: [number, number] = [0.5, 0.74];

function inFire(x: number, y: number): boolean {
  return Math.abs(x - FIRE[0]) < 0.11 && Math.abs(y - FIRE[1]) < 0.07;
}

function spot(cast: Cast, i: number): [number, number] {
  let best: [number, number] = [0.2, 0.75];
  let bestGap = -1;
  for (let k = 0; k < 10; k++) {
    const p: [number, number] = [rand(0.1, 0.9), rand(0.42, 0.94)];
    if (inFire(p[0], p[1])) continue;
    const gap = Math.min(
      ...cast.mids.filter((_, j) => j !== i).map((m) => Math.hypot(m.x - p[0], (m.y - p[1]) * 0.6)),
    );
    if (gap > 0.22) return p;
    if (gap > bestGap) [best, bestGap] = [p, gap];
  }
  return best;
}

const stroll: Solo = async (r, i) => {
  const [x, y] = spot(r.cast, i);
  if (Math.random() < 0.3) r.set(i, { bubble: "note" });
  await r.go(i, x, y);
  r.set(i, { bubble: null });
};

const wave: Solo = async (r, i) => {
  r.set(i, { arms: "wave", eyes: "happy", look: [0, 0.3] });
  await r.wait(rand(1300, 2000));
  r.set(i, CALM);
};

const hop: Solo = async (r, i) => {
  r.set(i, { motion: "hop", eyes: Math.random() < 0.5 ? "happy" : "open" });
  await r.wait(620 * pick([1, 2, 3]));
  r.set(i, CALM);
};

const rest: Solo = async (r, i) => {
  r.set(i, { motion: "sit", look: [0.4, 0.2] });
  await r.wait(rand(1800, 3000));
  if (Math.random() < 0.5) {
    r.set(i, { eyes: "closed", bubble: "sleep", look: [0, 0] });
    await r.wait(rand(3000, 5000));
    r.set(i, { eyes: "wide", bubble: null });
    await r.wait(500);
  }
  r.set(i, CALM);
};

const look: Solo = async (r, i) => {
  for (const g of [
    [-1, 0],
    [1, 0],
    [0, -0.8],
  ] as [number, number][]) {
    r.set(i, { look: g });
    await r.wait(rand(500, 900));
  }
  r.set(i, CALM);
};

const stretch: Solo = async (r, i) => {
  r.set(i, { arms: "stretch", eyes: "closed", motion: "lean" });
  await r.wait(1500);
  r.set(i, CALM);
};

const read: Solo = async (r, i) => {
  r.set(i, { arms: "hold", prop: "paper", eyes: "down", motion: "nod" });
  await r.wait(rand(2600, 4200));
  if (Math.random() < 0.5) {
    r.set(i, { bubble: "idea", eyes: "wide", motion: "stand" });
    await r.wait(900);
  }
  r.set(i, CALM);
};

const dance: Solo = async (r, i) => {
  r.set(i, { arms: "up", motion: "dance", eyes: "happy", bubble: "note" });
  await r.wait(rand(2000, 3200));
  r.set(i, CALM);
};

const spin: Solo = async (r, i) => {
  r.set(i, { motion: "spin", eyes: "happy" });
  await r.wait(1400);
  r.set(i, CALM);
};

const inspect: Solo = async (r, i) => {
  r.set(i, { arms: "point", prop: "glass", eyes: "down" });
  const m = r.cast.mids[i];
  for (let k = 0; k < 2; k++) {
    await r.go(i, Math.min(0.9, Math.max(0.1, m.x + rand(-0.18, 0.18))), Math.min(0.94, Math.max(0.42, m.y + rand(-0.1, 0.1))));
    r.set(i, { arms: "point", prop: "glass", eyes: "down" });
    await r.wait(rand(600, 1100));
  }
  r.set(i, { bubble: "think", eyes: "squint", look: [0.3, -0.6] });
  await r.wait(1000);
  r.set(i, CALM);
};

const write: Solo = async (r, i) => {
  r.set(i, { arms: "write", prop: "pad", eyes: "down" });
  await r.wait(rand(2200, 3400));
  r.set(i, CALM);
};

const clap: Solo = async (r, i) => {
  r.set(i, { arms: "clap", eyes: "happy", motion: "bounce" });
  await r.wait(1200);
  r.set(i, CALM);
};

/** Walks a and b to stand gap apart, facing each other. */
async function meet(r: Run, a: number, b: number, gap: number) {
  const ma = r.cast.mids[a];
  const mb = r.cast.mids[b];
  const cx = Math.min(0.9 - gap / 2, Math.max(0.1 + gap / 2, (ma.x + mb.x) / 2));
  const cy = (ma.y + mb.y) / 2;
  const [la, lb] = ma.x <= mb.x ? [a, b] : [b, a];
  await Promise.all([r.go(la, cx - gap / 2, cy), r.go(lb, cx + gap / 2, cy)]);
  r.set(la, { face: 1 });
  r.set(lb, { face: -1 });
}

const chat: Duo = async (r, a, b) => {
  await meet(r, a, b, 0.2);
  let [s, l] = Math.random() < 0.5 ? [a, b] : [b, a];
  const turns = Math.round(rand(3, 6));
  for (let k = 0; k < turns; k++) {
    r.set(s, { bubble: "talk", motion: "stand", arms: Math.random() < 0.3 ? "point" : "rest" });
    r.set(l, { bubble: null, motion: "nod", arms: "rest" });
    await r.wait(rand(1000, 1600));
    [s, l] = [l, s];
  }
  r.set(a, CALM);
  r.set(b, CALM);
  if (Math.random() < 0.5) {
    r.set(a, { eyes: "happy", motion: "hop" });
    r.set(b, { eyes: "happy", motion: "hop" });
    await r.wait(620);
  }
};

const highFive: Duo = async (r, a, b) => {
  await meet(r, a, b, 0.15);
  r.set(a, { arms: "high", eyes: "happy" });
  r.set(b, { arms: "high", eyes: "happy" });
  await r.wait(350);
  r.set(a, { motion: "hop" });
  r.set(b, { motion: "hop" });
  await r.wait(620);
  r.set(a, { ...CALM, eyes: "happy" });
  r.set(b, { ...CALM, eyes: "happy" });
  await r.wait(600);
};

const whisper: Duo = async (r, a, b) => {
  await meet(r, a, b, 0.13);
  r.set(a, { motion: "lean", bubble: "talk" });
  await r.wait(1400);
  r.set(a, { motion: "stand", bubble: null });
  r.set(b, { eyes: "wide", bubble: "idea" });
  await r.wait(900);
  r.set(b, { eyes: "happy", bubble: null, motion: "hop" });
  r.set(a, { eyes: "happy" });
  await r.wait(620);
};

const follow: Duo = async (r, a, b) => {
  for (let k = 0; k < 3; k++) {
    const [x, y] = spot(r.cast, a);
    const behind = x < r.cast.mids[a].x ? 0.13 : -0.13;
    await Promise.all([r.go(a, x, y), r.go(b, Math.min(0.92, Math.max(0.08, x + behind)), y)]);
    r.set(b, { face: r.cast.mids[a].x < r.cast.mids[b].x ? -1 : 1 });
  }
  r.set(a, { motion: "spin" });
  await r.wait(700);
  r.set(a, { face: r.cast.mids[b].x < r.cast.mids[a].x ? -1 : 1, motion: "stand", eyes: "wide" });
  r.set(b, { arms: "wave", eyes: "happy" });
  await r.wait(1100);
};

const catcher = (setToss: (t: Toss) => void): Duo =>
  async (r, a, b) => {
    await meet(r, a, b, 0.34);
    let [from, to] = [a, b];
    const throws = Math.round(rand(3, 6));
    for (let k = 0; k < throws; k++) {
      const ms = 700;
      const ma = r.cast.mids[from];
      const mb = r.cast.mids[to];
      r.set(from, { arms: "up", eyes: "open" });
      r.set(to, { arms: "rest", eyes: "wide" });
      setToss({ from: ma.x, to: mb.x, y: (ma.y + mb.y) / 2, key: k + Math.random(), ms });
      await r.wait(ms);
      r.set(from, { arms: "rest", eyes: "open" });
      r.set(to, { arms: "clap", eyes: "happy" });
      await r.wait(260);
      [from, to] = [to, from];
    }
    setToss(null);
    r.set(a, { ...CALM, eyes: "happy" });
    r.set(b, { ...CALM, eyes: "happy", motion: "hop" });
    await r.wait(620);
  };

// Seats on the ring round the fire, as angles: the sides first, then the front.
const RING = [Math.PI, 0, Math.PI * 0.75, Math.PI * 0.25, Math.PI * 1.25, Math.PI * 1.75];

/** The free seat by the fire nearest to the mid. */
function byFire(cast: Cast, i: number): [number, number] {
  const m = cast.mids[i];
  const seats = RING.map((a): [number, number] => [FIRE[0] + 0.18 * Math.cos(a), FIRE[1] + 0.1 * Math.sin(a)]);
  const free = seats.filter(([x, y]) =>
    cast.mids.every((o, j) => j === i || Math.hypot(o.x - x, (o.y - y) * 0.6) > 0.1),
  );
  const pool = free.length ? free : seats;
  return pool.reduce((best, p) => (Math.hypot(p[0] - m.x, p[1] - m.y) < Math.hypot(best[0] - m.x, best[1] - m.y) ? p : best));
}

const warm: Solo = async (r, i) => {
  const [x, y] = byFire(r.cast, i);
  await r.go(i, x, y);
  r.set(i, { face: x < FIRE[0] ? 1 : -1, motion: "sit", arms: "hold", eyes: "happy", look: [0.5, 0.3] });
  await r.wait(rand(3000, 5200));
  if (Math.random() < 0.35) {
    r.set(i, { eyes: "closed", bubble: "sleep", arms: "rest" });
    await r.wait(rand(2500, 4000));
  }
  r.set(i, CALM);
};

const circle: Solo = async (r, i) => {
  r.set(i, { arms: "up", eyes: "happy", bubble: "note" });
  for (const a of [Math.PI, Math.PI * 1.5, 0, Math.PI * 0.5, Math.PI]) {
    await r.go(i, FIRE[0] + 0.2 * Math.cos(a), FIRE[1] + 0.11 * Math.sin(a), true);
    r.set(i, { arms: "up", eyes: "happy", bubble: "note" });
  }
  r.set(i, CALM);
};

const poker = (flare: () => void): Solo =>
  async (r, i) => {
    const [x, y] = byFire(r.cast, i);
    await r.go(i, x, y);
    r.set(i, { face: x < FIRE[0] ? 1 : -1, arms: "point", motion: "nod", eyes: "down" });
    await r.wait(700);
    flare();
    r.set(i, { motion: "hop", eyes: "wide", arms: "up" });
    await r.wait(620);
    r.set(i, { ...CALM, face: x < FIRE[0] ? 1 : -1, eyes: "happy" });
    await r.wait(900);
  };

/** Two settle down by the fire and one tells a story. */
const fireside: Duo = async (r, a, b) => {
  const left: [number, number] = [FIRE[0] - 0.17, FIRE[1] + 0.02];
  const right: [number, number] = [FIRE[0] + 0.17, FIRE[1] + 0.02];
  await Promise.all([r.go(a, ...left), r.go(b, ...right)]);
  r.set(a, { face: 1, motion: "sit", arms: "hold", look: [0.4, 0.2] });
  r.set(b, { face: -1, motion: "sit", arms: "hold", look: [0.4, 0.2] });
  let [s, l] = Math.random() < 0.5 ? [a, b] : [b, a];
  for (let k = 0; k < Math.round(rand(3, 6)); k++) {
    r.set(s, { bubble: "talk", eyes: "open", arms: "rest" });
    r.set(l, { bubble: null, eyes: "happy", arms: "hold" });
    await r.wait(rand(1300, 1900));
    [s, l] = [l, s];
  }
  r.set(a, CALM);
  r.set(b, CALM);
};

const SOLO: [Solo, number][] = [
  [warm, 3],
  [circle, 0.6],
  [stroll, 5],
  [wave, 1.4],
  [hop, 1],
  [rest, 1.2],
  [look, 1.4],
  [stretch, 0.8],
  [read, 1],
  [dance, 0.6],
  [spin, 0.5],
  [inspect, 0.9],
  [write, 0.7],
  [clap, 0.5],
];

function director(cast: Cast, setToss: (t: Toss) => void, flare: () => void) {
  const solo: [Solo, number][] = [...SOLO, [poker(flare), 1]];
  const free = new Set<number>();
  const partner = new Map<number, number>();
  let catching: number[] = [];

  function start(i: number) {
    free.delete(i);
    const r = run(cast, [i]);
    r.set(i, CALM);
    void life(r, i);
  }

  async function pair(i: number, j: number, duo: Duo, isCatch: boolean) {
    free.delete(j);
    partner.set(i, j).set(j, i);
    if (isCatch) catching = [i, j];
    const r = run(cast, [i, j]);
    await duo(r, i, j);
    release(i);
    start(i);
  }

  /** Ends whatever pair i is in; the other one goes back to its own life. */
  function release(i: number) {
    free.delete(i);
    const j = partner.get(i);
    if (j === undefined) return;
    partner.delete(i);
    partner.delete(j);
    if (catching.includes(i)) {
      catching = [];
      setToss(null);
    }
    start(j);
  }

  async function life(r: Run, i: number) {
    await r.wait(rand(300, 1800));
    while (r.alive()) {
      const others = [...free].filter((j) => j !== i && !partner.has(j));
      if (others.length && Math.random() < 0.28) {
        const isCatch = !catching.length && Math.random() < 0.3;
        const duo = isCatch
          ? catcher(setToss)
          : weighted<Duo>([
              [chat, 3],
              [fireside, 2.5],
              [highFive, 1.2],
              [whisper, 1],
              [follow, 1],
            ]);
        void pair(i, pick(others), duo, isCatch);
        return;
      }
      await weighted(solo)(r, i);
      free.add(i);
      await r.wait(rand(700, 2600));
      free.delete(i);
    }
  }

  return {
    start,
    release,
    startAll: () => cast.mids.forEach((_, i) => start(i)),
    stop() {
      cast.stop();
      free.clear();
      partner.clear();
      catching = [];
      setToss(null);
    },
  };
}

/** The idle Mids; `busy` is the moment of sending. */
export function HomeMids({ busy, className }: { busy: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { cast, mids, reduced } = useCast(() => [mid(0.2, 0.68, 1), mid(0.54, 0.9, -1), mid(0.8, 0.52, -1)]);
  const box = useBox(ref, cast);
  const [toss, setToss] = useState<Toss>(null);
  const [gaze, setGaze] = useState<[number, number] | null>(null);
  const [flare, setFlare] = useState(0);
  const [d] = useState(() => director(cast, setToss, () => setFlare((f) => f + 1)));
  const mode = useRef<"idle" | "busy">("idle");
  const roomy = box.h >= 110;
  const ready = box.w > 0 && roomy && !reduced;

  useWhileVisible(
    () => mode.current === "idle" && d.startAll(),
    () => d.stop(),
    ready,
  );

  // Sent: they bunch up, ready to go. A send that fails lets them go again.
  useEffect(() => {
    if (!ready) return;
    if (!busy) {
      if (mode.current === "busy") {
        mode.current = "idle";
        d.stop();
        d.startAll();
      }
      return;
    }
    mode.current = "busy";
    d.stop();
    const r = run(cast, cast.mids.map((_, i) => i));
    cast.mids.forEach((_, i) => {
      const x = 0.42 + i * 0.08;
      void r.go(i, x, 0.86 + (i === 1 ? 0.04 : 0), true).then(() =>
        r.set(i, { ...CALM, face: x < 0.5 ? 1 : -1, motion: "bounce", eyes: "wide", bubble: i === 1 ? "idea" : null }),
      );
    });
  }, [busy, ready, cast, d]);

  // Fine pointers: the eyes follow it while nobody's scripted a look.
  useEffect(() => {
    if (reduced || !window.matchMedia("(pointer: fine)").matches) return;
    let frame = 0;
    const move = (e: PointerEvent) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const el = ref.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        setGaze([e.clientX - r.left, e.clientY - r.top]);
      });
    };
    const leave = () => setGaze(null);
    window.addEventListener("pointermove", move);
    document.addEventListener("pointerleave", leave);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      document.removeEventListener("pointerleave", leave);
    };
  }, [reduced]);

  function poke(px: number, py: number) {
    if (!ready || mode.current !== "idle") return;
    const i = hit(cast.mids, box, px, py);
    if (i < 0) return;
    d.release(i);
    const r = run(cast, [i]);
    void (async () => {
      r.set(i, { ...CALM, eyes: "wide", bubble: "idea", motion: "hop" });
      await r.wait(620);
      r.set(i, { ...CALM, eyes: "happy", arms: "wave" });
      await r.wait(1200);
      d.start(i);
    })();
  }

  return (
    <Stage
      stageRef={ref}
      mids={roomy ? mids : []}
      box={box}
      toss={toss}
      className={className}
      onPointerDown={poke}
      gaze={
        gaze
          ? (m) => {
              if (m.look[0] || m.look[1] || m.eyes === "closed" || m.eyes === "happy") return null;
              const dx = (gaze[0] - m.x * box.w) / Math.max(box.w, 1);
              const dy = (gaze[1] - m.y * box.h * 0.8) / Math.max(box.h, 1);
              return [Math.max(-1, Math.min(1, dx * 2.4 * m.face)), Math.max(-1, Math.min(1, dy * 2))];
            }
          : undefined
      }
    >
      {roomy ? <FirePit size={midSize(box.w, box.h, 3)} flare={flare} /> : null}
    </Stage>
  );
}

function FirePit({ size, flare }: { size: number; flare: number }) {
  return (
    <span
      className={styles.fire}
      style={{ left: `${FIRE[0] * 100}%`, top: `${FIRE[1] * 100}%`, width: size * 0.9, zIndex: Math.round(FIRE[1] * 100) }}
    >
      <svg viewBox="0 0 80 70">
        <g key={flare} className={styles.flames} data-flare={flare ? "" : undefined}>
          <path className={styles.outer} d="M40 4C52 20 62 30 60 44c-2 10-10 16-20 16s-18-6-20-16C18 32 30 24 32 12c4 6 6 10 8 12 1-8 0-14 0-20Z" />
          <path className={styles.inner} d="M40 24c7 9 12 15 11 23-1 6-5 9-11 9s-10-3-11-9c-1-7 4-12 7-18 1 3 3 5 4 6 0-4 0-7 0-11Z" />
          <path className={styles.core} d="M40 40c3 4 5 7 5 10 0 3-2 5-5 5s-5-2-5-5c0-3 2-6 5-10Z" />
        </g>
        <path className={styles.logs} d="M14 64 66 52M14 52 66 64" />
      </svg>
      <span className={styles.spark} />
      <span className={styles.spark} />
      <span className={styles.spark} />
    </span>
  );
}
