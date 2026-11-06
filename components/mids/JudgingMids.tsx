"use client";

import { useEffect, useRef, useState } from "react";
import type { JudgingBeat, Vote } from "@/lib/scene-bridge";
import { useSceneMode } from "@/lib/scene-bridge-react";
import { majority, mid, pick, rand, run, seats, type Cast, type Mid, type Run } from "./cast";
import { Stage, useBox, useCast } from "./Stage";
import styles from "./Mids.module.css";

// The judges at work, following the overlay's beats through the scene
// bridge: they gather, take a page each, dig through the evidence, weigh it,
// go quiet just before the votes, then each raise their own flag.

const CALM: Partial<Mid> = { arms: "rest", eyes: "open", prop: null, bubble: null, motion: "stand", look: [0, 0] };

type Scene = "lift" | JudgingBeat | "verdict";
type Thing = "file" | null;

const all = (c: Cast) => c.mids.map((_, i) => i);

function faceCentre(r: Run, i: number) {
  const x = r.cast.mids[i].x;
  if (Math.abs(x - 0.5) > 0.02) r.face(i, 0.5);
}

/** Everyone to their seat; resolves when the last one sits. */
async function toSeats(r: Run, fast = false) {
  const s = seats(r.cast.size);
  await Promise.all(r.ids.map((i) => r.go(i, s[i][0], s[i][1], fast)));
}

async function huddle(r: Run, fast: boolean, rounds = Infinity) {
  const n = r.cast.size;
  await Promise.all(
    r.ids.map((i) => {
      const k = i - (n - 1) / 2;
      return r.go(i, 0.5 + k * 0.12, 0.8 - Math.abs(k) * 0.07 + (k === 0 ? 0.04 : 0), fast);
    }),
  );
  r.ids.forEach((i) => faceCentre(r, i));
  for (let turn = 0; r.alive() && turn < rounds; turn++) {
    const s = r.ids[turn % n];
    r.ids.forEach((i) =>
      r.set(i, i === s ? { bubble: "talk", motion: "stand", arms: turn % 3 === 2 ? "point" : "rest" } : { bubble: null, motion: "nod", arms: "rest" }),
    );
    await r.wait(rand(1100, 1600));
  }
}

async function sort(r: Run, setThing: (t: Thing) => void) {
  setThing("file");
  await Promise.all(r.ids.map((i, k) => r.go(i, 0.42 + k * 0.08, 0.7)));
  for (const i of r.ids) {
    r.set(i, { ...CALM, face: 1, arms: "hold", prop: "paper", eyes: "down" });
    await r.wait(260);
  }
  setThing(null);
  await toSeats(r);
  r.ids.forEach((i) => r.set(i, { face: 1, arms: "hold", prop: "paper", eyes: "down", motion: "nod" }));
  while (r.alive()) {
    await r.wait(rand(1400, 2200));
    const i = pick(r.ids);
    // A page turn: the sheet drops and comes back up.
    r.set(i, { prop: null, motion: "stand" });
    await r.wait(140);
    r.set(i, { prop: "paper", motion: "nod", bubble: Math.random() < 0.3 ? "think" : null });
  }
}

type Role = "glass" | "write" | "think" | "talk" | "read" | "idea";

function role(r: Run, i: number, what: Role) {
  const base = { ...CALM, face: (r.cast.mids[i].x < 0.5 ? 1 : -1) as 1 | -1 };
  const look: Record<Role, Partial<Mid>> = {
    glass: { arms: "point", prop: "glass", eyes: "down" },
    write: { arms: "write", prop: "pad", eyes: "down" },
    think: { arms: "chin", eyes: "squint", bubble: "think", look: [0.3, -0.8] },
    talk: { bubble: "talk", motion: "nod" },
    read: { arms: "hold", prop: "paper", eyes: "down", motion: "nod" },
    idea: { arms: "up", eyes: "wide", bubble: "idea", motion: "hop" },
  };
  r.set(i, { ...base, ...look[what] });
}

async function dig(r: Run) {
  await toSeats(r);
  const pool: Role[] = ["glass", "write", "think", "talk", "read", "idea"];
  let last: Role[] = [];
  while (r.alive()) {
    // A fresh mix each round, nobody keeping the same job twice running.
    const roles = r.ids.map((_, k) => {
      const options = pool.filter((p) => p !== last[k]);
      return pick(options);
    });
    if (!roles.includes("idea") && Math.random() < 0.5) roles[Math.floor(Math.random() * roles.length)] = "idea";
    last = roles;
    for (const [k, i] of r.ids.entries()) {
      role(r, i, roles[k]);
      await r.wait(180);
    }
    // The one with the glass searches about a bit; the one with an idea settles.
    const g = roles.indexOf("glass");
    const idea = roles.indexOf("idea");
    const s = seats(r.cast.size);
    if (idea >= 0) {
      void r.wait(620).then(() => r.set(r.ids[idea], { motion: "stand", arms: "point", bubble: "idea" }));
    }
    if (g >= 0) {
      const i = r.ids[g];
      await r.go(i, s[g][0] + rand(-0.08, 0.08), s[g][1] + rand(-0.06, 0.06));
      role(r, i, "glass");
    }
    await r.wait(rand(2000, 2800));
  }
}

async function crux(r: Run) {
  const n = r.cast.size;
  const centre = Math.floor(n / 2);
  const others = r.ids.filter((i) => i !== centre);
  await Promise.all([
    r.go(centre, 0.5, 0.86),
    ...others.map((i, k) => {
      const left = k < others.length / 2;
      return r.go(i, left ? 0.24 - k * 0.04 : 0.76 + (k - others.length / 2) * 0.04, 0.76);
    }),
  ]);
  r.set(centre, { ...CALM, face: 1, arms: "beam", eyes: "squint", look: [0, -0.6] });
  others.forEach((i) => {
    faceCentre(r, i);
    r.set(i, { ...CALM, arms: "chin", eyes: "squint", face: r.cast.mids[i].x < 0.5 ? 1 : -1 });
  });
  for (let k = 0; r.alive(); k++) {
    others.forEach((i, j) => r.set(i, { bubble: (j + k) % 2 ? "dots" : "think" }));
    await r.wait(rand(1600, 2200));
  }
}

async function orbs(r: Run) {
  await toSeats(r);
  r.ids.forEach((i) => r.set(i, { ...CALM, face: 1, eyes: "squint", motion: "bounce", bubble: "dots" }));
}

async function deliberate(r: Run) {
  while (r.alive()) {
    const kind = pick(["huddle", "pace", "book", "recheck"] as const);
    if (kind === "huddle") {
      await huddle(r, false, Math.round(rand(3, 5)));
      continue;
    }
    if (kind === "pace") {
      await toSeats(r);
      for (let k = 0; k < 2; k++) {
        await Promise.all(
          r.ids.map(async (i, j) => {
            const s = seats(r.cast.size)[j];
            r.set(i, { arms: "chin", eyes: "squint", bubble: Math.random() < 0.5 ? "think" : null });
            await r.go(i, s[0] + rand(-0.1, 0.1), s[1] + rand(-0.08, 0.06));
            r.set(i, { arms: "chin", eyes: "squint" });
          }),
        );
        await r.wait(600);
      }
    } else if (kind === "book") {
      const reader = pick(r.ids);
      const rest = r.ids.filter((i) => i !== reader);
      await r.go(reader, 0.5, 0.84);
      r.set(reader, { ...CALM, face: 1, arms: "hold", prop: "book", eyes: "down", motion: "nod" });
      await Promise.all(rest.map((i, k) => r.go(i, k % 2 ? 0.66 + k * 0.03 : 0.34 - k * 0.03, 0.78)));
      rest.forEach((i) => {
        faceCentre(r, i);
        r.set(i, { motion: "lean", eyes: "down", look: [0.6, 0.4] });
      });
      await r.wait(rand(3000, 4200));
      r.set(reader, { bubble: "idea", eyes: "wide" });
      await r.wait(900);
      r.ids.forEach((i) => r.set(i, CALM));
    } else {
      await toSeats(r);
      r.ids.forEach((i, k) => role(r, i, k % 2 ? "read" : "glass"));
      await r.wait(rand(3000, 4000));
    }
  }
}

async function verdict(r: Run, votes: readonly Vote[]) {
  await toSeats(r, true);
  r.ids.forEach((i) => r.set(i, { ...CALM, face: 1, look: [0, 0.3] }));
  if (!votes.length) {
    r.ids.forEach((i) => r.set(i, { arms: "shrug", motion: "shake", bubble: "think" }));
    return;
  }
  // One flag per run, in the dots' order; a judge without a run keeps its hands down.
  for (const [k, i] of r.ids.entries()) {
    const v = votes[k];
    if (!v) continue;
    r.set(i, { arms: "vote", prop: v === "a" ? "flag-a" : v === "b" ? "flag-b" : "flag-o" });
    await r.wait(150);
  }
  await r.wait(350);
  const win = majority(votes);
  r.ids.forEach((i, k) => {
    if (k >= votes.length) return;
    r.set(i, votes[k] === win ? { eyes: "happy", motion: "hop" } : { eyes: "open", motion: "shake" });
  });
  await r.wait(win ? 1240 : 500);
  r.ids.forEach((i) => r.set(i, { motion: "stand" }));
}

/** The judging card's Mids. Starts them off stage so they walk on. */
export function JudgingMids({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const mode = useSceneMode();
  const { cast, mids, reduced } = useCast(() => [mid(-0.12, 0.78, 1), mid(-0.24, 0.84, 1), mid(1.14, 0.78, -1)]);
  const box = useBox(ref, cast);
  const [thing, setThing] = useState<Thing>(null);
  const scene: Scene = mode.kind === "judging" ? mode.beat : mode.kind === "verdict" ? "verdict" : "lift";
  const votes = mode.kind === "verdict" ? mode.verdict.votes : null;
  const voteKey = votes?.join(",") ?? "";
  const sized = box.w > 0;

  useEffect(() => {
    if (!sized) return;
    const play = () => {
      cast.stop();
      const n = Math.max(3, votes?.length ?? 0);
      while (cast.size < n) cast.add(mid(1.14 + (cast.size - 3) * 0.1, 0.8, -1));
      const r = run(cast, all(cast));
      if (scene !== "sort") setThing(null);
      if (scene === "lift") void huddle(r, !reduced);
      else if (scene === "sort") void sort(r, setThing);
      else if (scene === "dig") void dig(r);
      else if (scene === "crux") void crux(r);
      else if (scene === "orbs") void orbs(r);
      else if (scene === "deliberate") void deliberate(r);
      else void verdict(r, votes ?? []);
    };
    // A hidden tab stops them; coming back picks the current beat up again.
    const flip = () => (document.hidden ? cast.stop() : play());
    if (!document.hidden) play();
    document.addEventListener("visibilitychange", flip);
    return () => {
      document.removeEventListener("visibilitychange", flip);
      cast.stop();
    };
    // votes is read through voteKey so a new array with the same votes is no change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, voteKey, cast, reduced, sized]);

  return (
    <Stage stageRef={ref} mids={mids} box={box} className={className}>
      {thing === "file" ? (
        <span className={styles.thing} style={{ left: "50%", top: "60%", width: 60, height: 44, zIndex: 1 }}>
          <svg viewBox="0 0 46 34">
            <rect x="6" y="4" width="34" height="26" rx="3" fill="var(--paper)" stroke="var(--line-2, var(--line))" strokeWidth="2" transform="rotate(-6 23 17)" />
            <rect x="6" y="6" width="34" height="26" rx="3" fill="var(--paper)" stroke="var(--line-2, var(--line))" strokeWidth="2" />
            <path d="M12 13h20M12 19h16M12 25h20" stroke="var(--party-a-strong)" strokeWidth="2.5" strokeLinecap="round" opacity=".6" />
          </svg>
        </span>
      ) : null}
    </Stage>
  );
}
