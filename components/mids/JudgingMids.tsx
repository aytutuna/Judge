"use client";

import { useEffect, useRef, useState } from "react";
import type { Vote } from "@/lib/scene-bridge";
import { mid, pick, rand, run, seats, type Cast, type Mid, type Run } from "./cast";
import { Stage, useBox, useCast } from "./Stage";
import { agreement, type Waiting } from "./story";
import styles from "./Mids.module.css";

// The judging card's scene. JudgingStory picks the beat; this plays it.
// Mid 3 is the fact checker, not a judge: it comes in, searches, reports and
// goes. Judges never confer once they have their own copy, as on the server.

export type Beat = Waiting | "vote1" | "more" | "vote2" | "final";

const CALM: Partial<Mid> = { arms: "rest", eyes: "open", prop: null, bubble: null, motion: "stand", look: [0, 0] };
const CHECKER = 3;
const FIRST = [0, 1, 2];

type Thing = "letter" | null;

/** The judges in vote order: the first three, then any called in later. */
function judges(c: Cast): number[] {
  return c.mids.map((_, i) => i).filter((i) => i !== CHECKER);
}

function tintOf(v: Vote | undefined): Mid["tint"] {
  return v === "a" ? "a" : v === "b" ? "b" : v ? "o" : null;
}

/** Judges to their own seats, spread across the floor. */
async function spread(r: Run, ids: number[], fast = false) {
  const s = seats(ids.length);
  await Promise.all(ids.map((i, k) => r.go(i, s[k][0], s[k][1], fast)));
  ids.forEach((i) => r.set(i, { face: 1 }));
}

async function names(r: Run, setThing: (t: Thing) => void) {
  setThing("letter");
  const around: [number, number][] = [
    [0.36, 0.76],
    [0.5, 0.88],
    [0.64, 0.76],
  ];
  await Promise.all(FIRST.map((i, k) => r.go(i, around[k][0], around[k][1], true)));
  FIRST.forEach((i) => r.set(i, { ...CALM, face: r.cast.mids[i].x < 0.5 ? 1 : -1, eyes: "down" }));
  r.set(1, { face: 1, look: [0, -0.4] });
  for (let k = 0; r.alive(); k++) {
    // One scrubs the names off the page while the others watch it go.
    r.set(1, { arms: "write", prop: "pad", eyes: "down", bubble: null });
    await r.wait(rand(1600, 2200));
    r.set(1, { arms: "rest", prop: null, eyes: "happy", bubble: k % 2 ? "idea" : null });
    await r.wait(700);
  }
}

async function facts(r: Run) {
  FIRST.forEach((i) => r.set(i, { ...CALM, eyes: "squint", look: [-0.6, 0] }));
  r.set(CHECKER, { ...CALM, tint: "o", arms: "point", prop: "glass", bubble: "web" });
  await r.go(CHECKER, 0.2, 0.68);
  while (r.alive()) {
    for (const x of [0.12, 0.28, 0.2]) {
      r.set(CHECKER, { arms: "point", prop: "glass", eyes: "down", bubble: "web" });
      await r.go(CHECKER, x, rand(0.62, 0.72));
      await r.wait(rand(500, 900));
    }
    // Found something: it reads it out to the judges.
    r.set(CHECKER, { ...CALM, face: 1, arms: "hold", prop: "paper", bubble: "idea", eyes: "wide" });
    FIRST.forEach((i) => r.set(i, { eyes: "wide", look: [-0.8, 0], motion: "nod" }));
    await r.wait(1500);
    FIRST.forEach((i) => r.set(i, { eyes: "squint", motion: "stand" }));
  }
}

async function takeSeats(r: Run, setThing: (t: Thing) => void) {
  setThing(null);
  r.set(CHECKER, { ...CALM, arms: "wave", eyes: "happy" });
  void r.go(CHECKER, -0.3, 0.7, true);
  FIRST.forEach((i) => r.set(i, { ...CALM, arms: "hold", prop: "paper" }));
  await spread(r, FIRST);
  for (let k = 0; r.alive(); k++) {
    FIRST.forEach((i, j) =>
      r.set(i, { arms: "hold", prop: "paper", eyes: "down", motion: (j + k) % 2 ? "nod" : "stand" }),
    );
    await r.wait(rand(1400, 2000));
  }
}

async function bothSides(r: Run) {
  // Each weighs A against B on its own.
  for (const [k, i] of FIRST.entries()) {
    r.set(i, { ...CALM, face: 1, arms: "beam", eyes: "squint", look: [0, -0.6] });
    await r.wait(260 + k * 120);
  }
  while (r.alive()) {
    await r.wait(rand(1600, 2400));
    r.set(pick(FIRST), { look: [pick([-0.9, 0.9]), -0.4] });
  }
}

async function crux(r: Run) {
  const think: Partial<Mid> = { ...CALM, face: 1, arms: "chin", eyes: "squint", bubble: "think", look: [0.3, -0.8] };
  FIRST.forEach((i) => r.set(i, think));
  while (r.alive()) {
    await r.wait(rand(1800, 2600));
    const i = pick(FIRST);
    r.set(i, { arms: "up", eyes: "wide", bubble: "idea", motion: "hop", look: [0, 0] });
    await r.wait(620);
    r.set(i, { arms: "point", motion: "stand" });
    await r.wait(900);
    r.set(i, think);
  }
}

async function ruling(r: Run) {
  const jobs: Partial<Mid>[] = [
    { arms: "write", prop: "pad", eyes: "down", bubble: null },
    { arms: "hold", prop: "paper", eyes: "down", motion: "nod", bubble: null },
    { arms: "chin", eyes: "squint", bubble: "think" },
    { arms: "write", prop: "pad", eyes: "down", bubble: null },
  ];
  const s = seats(3);
  FIRST.forEach((i) => r.set(i, { ...CALM, face: 1, ...jobs[0] }));
  while (r.alive()) {
    await r.wait(rand(2200, 3200));
    const k = pick(FIRST);
    if (Math.random() < 0.3) {
      // A short pace, still alone.
      r.set(k, { ...CALM, arms: "chin", eyes: "squint" });
      await r.go(k, s[k][0] + rand(-0.07, 0.07), s[k][1] + rand(-0.05, 0.03));
    }
    r.set(k, { ...CALM, face: 1, ...pick(jobs) });
  }
}

async function vote(r: Run, ids: number[], votes: readonly Vote[], from: number) {
  for (const [k, i] of ids.entries()) {
    const v = votes[from + k];
    r.set(i, {
      ...CALM,
      face: 1,
      look: [0, 0.3],
      tint: tintOf(v),
      motion: v ? "hop" : "stand",
      eyes: v ? "open" : "squint",
    });
    await r.wait(420);
    r.set(i, { motion: "stand" });
  }
}

/** Brings the cast up to 3 + count judges; safe to call again. */
function callIn(c: Cast, count: number) {
  for (let k = judges(c).length - 3; k < count; k++) {
    const left = k % 2 === 0;
    const i = c.add(mid(left ? -0.12 : 1.12, 0.84, left ? 1 : -1));
    c.set(i, { arms: "hold", prop: "paper", eyes: "down" });
  }
}

async function more(r: Run, count: number) {
  // Fresh judges, called in for a close one. They start from the case alone.
  callIn(r.cast, count);
  const go = run(r.cast, r.cast.mids.map((_, i) => i));
  const ids = judges(go.cast);
  await spread(go, ids, true);
  ids.slice(3).forEach((i) => go.set(i, { arms: "hold", prop: "paper", eyes: "down", motion: "nod" }));
}

function final(r: Run, ids: number[], votes: readonly Vote[]) {
  const { side } = agreement(votes);
  ids.forEach((i, k) => {
    const v = votes[k];
    if (!v) r.set(i, { arms: "shrug", motion: "shake" });
    else if (v === side) r.set(i, { eyes: "happy", motion: "hop", arms: "up" });
    else r.set(i, { motion: "shake" });
  });
}

/** Plays one beat at a time; changing the beat cuts the last one short. */
export function JudgingMids({
  beat,
  votes,
  extra,
  className,
}: {
  beat: Beat;
  votes: readonly Vote[];
  /** Judges called in after the first three. */
  extra: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { cast, mids } = useCast(() => [
    mid(-0.12, 0.76, 1),
    mid(-0.24, 0.84, 1),
    mid(1.14, 0.76, -1),
    mid(-0.3, 0.7, 1),
  ]);
  const box = useBox(ref, cast);
  const [thing, setThing] = useState<Thing>(null);
  const sized = box.w > 0;
  const voteKey = votes.join(",");

  useEffect(() => {
    if (!sized) return;
    const play = () => {
      cast.stop();
      const r = run(cast, cast.mids.map((_, i) => i));
      if (beat === "names") void names(r, setThing);
      else if (beat === "facts") void facts(r);
      else if (beat === "judges") void takeSeats(r, setThing);
      else if (beat === "bothSides") void bothSides(r);
      else if (beat === "crux") void crux(r);
      else if (beat === "ruling") void ruling(r);
      else if (beat === "vote1") {
        setThing(null);
        r.set(CHECKER, { x: -0.3, t: 0 });
        void spread(r, FIRST, true).then(() => vote(r, FIRST, votes, 0));
      } else if (beat === "more") void more(r, extra);
      else {
        // Back from a hidden tab past "more": the late judges still need to be there.
        if (judges(cast).length < 3 + extra) {
          callIn(cast, extra);
          const r2 = run(cast, cast.mids.map((_, i) => i));
          void spread(r2, judges(cast), true);
        }
        const r3 = run(cast, cast.mids.map((_, i) => i));
        if (beat === "vote2") void vote(r3, judges(cast).slice(3), votes, 3);
        else final(r3, judges(cast), votes);
      }
    };
    // A hidden tab stops them; coming back picks the beat up again.
    const flip = () => (document.hidden ? cast.stop() : play());
    if (!document.hidden) play();
    document.addEventListener("visibilitychange", flip);
    return () => document.removeEventListener("visibilitychange", flip);
    // votes is read through voteKey so a new array with the same votes is no change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beat, voteKey, extra, cast, sized]);

  return (
    <Stage stageRef={ref} mids={mids} box={box} className={className}>
      {thing === "letter" ? (
        <span className={styles.letter} style={{ left: "50%", top: "72%" }}>
          <svg viewBox="0 0 44 34">
            <rect x="3" y="3" width="38" height="28" rx="3" fill="#fff" stroke="var(--ink)" strokeWidth="2" />
            <path d="M9 11h26M9 17h20M9 23h24" stroke="var(--muted)" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        </span>
      ) : null}
    </Stage>
  );
}
