// The street court: a pixel basketball court where the judging story plays
// out. Framework-free; the web wraps it in Court.tsx and the apps bundle it
// into a page (mobile/shared/court). It never shows text, and it only reads
// the story's beats, so the log and the court stay in step by construction.

import type { Vote } from "@/lib/scene-bridge";
import type { CruxTrialOutcome } from "@/lib/types";
import { parseVenue, type Venue } from "@/lib/venues";
import type { Beat } from "./story";

export type CourtScene =
  | { kind: "home"; busy: boolean; venue?: string }
  | {
      kind: "judging";
      /** The scene the court is set in (lib/venues); anything else is the street court. */
      venue?: string;
      beat: Beat;
      votes: readonly Vote[];
      /** Judges called in after the first three. */
      extra: number;
      winner: Side | null;
      trial: CruxTrialOutcome | null;
      /** How many sides stand at centre court; two when left out. */
      sides?: number;
    };

/** A side of the case; A and C shoot at the left hoop, B and D at the right. */
export type Side = "a" | "b" | "c" | "d";

export type CourtOptions = {
  /** Where a picture lives: "ground", "props/ball", "people/scout1-0". */
  src: (name: string) => string;
  reduced: boolean;
  /** Once the art is in and the first frame is drawn. */
  onReady?: () => void;
};

export type Court = {
  set(scene: CourtScene): void;
  setReduced(on: boolean): void;
  dispose(): void;
};

export type Point = { x: number; y: number };

const W = 320;
const H = 180;
const PX = 2;
const CENTER = { x: 160, y: 101 };
// Where the ball goes in, per venue: the hoops' rims in the court picture, a bin
// or basket baked into the others. Sides A and C shoot left, B and D right.
const TARGETS: Record<Venue, { a: Point; b: Point }> = {
  court: { a: { x: 81, y: 64 }, b: { x: 238, y: 64 } },
  beach: { a: { x: 100, y: 82 }, b: { x: 212, y: 82 } },
  camp: { a: { x: 100, y: 84 }, b: { x: 222, y: 84 } },
  farm: { a: { x: 70, y: 88 }, b: { x: 250, y: 89 } },
  ice: { a: { x: 75, y: 64 }, b: { x: 245, y: 64 } },
  library: { a: { x: 80, y: 84 }, b: { x: 240, y: 84 } },
  museum: { a: { x: 78, y: 86 }, b: { x: 242, y: 86 } },
  street: { a: { x: 72, y: 82 }, b: { x: 248, y: 82 } },
  tv: { a: { x: 70, y: 88 }, b: { x: 250, y: 88 } },
};
const SIDES: readonly Side[] = ["a", "b", "c", "d"];
const SPEED = 34;
const JOG = 70;
// Keep in step with VOTE_MS in story.ts.
const VOTE_S = 0.42;
const TRIAL_SPEED = 110;

// Where the sides stand at centre court, left to right, and what the rest of
// the cast does around them. Two sides are as they always were; with three or
// four the row is wider, so the anonymizer, the fact-checker and the review
// pair stand further out, and walkers go round a wider ring.
export type Stand = { at: Partial<Record<Side, Point>>; look: Partial<Record<Side, "right" | "left" | "down">> };
export const STAND: Record<number, Stand> = {
  2: { at: { a: { x: 149, y: 100 }, b: { x: 171, y: 100 } }, look: { a: "right", b: "left" } },
  3: {
    at: { a: { x: 132, y: 104 }, c: { x: 160, y: 97 }, b: { x: 188, y: 104 } },
    look: { a: "right", c: "down", b: "left" },
  },
  4: {
    at: { a: { x: 127, y: 105 }, c: { x: 149, y: 98 }, d: { x: 171, y: 98 }, b: { x: 193, y: 105 } },
    look: { a: "right", c: "right", d: "left", b: "left" },
  },
};
export const SPOTS = {
  2: { a: { x: 128, y: 108 }, b: { x: 192, y: 108 }, atk: { x: 192, y: 124 }, adj: { x: 128, y: 124 }, ring: { x: 30, y: 22 } },
  many: { a: { x: 108, y: 118 }, b: { x: 212, y: 118 }, atk: { x: 214, y: 124 }, adj: { x: 106, y: 124 }, ring: { x: 46, y: 24 } },
};

const C = {
  paper: "#efe6d2",
  out: "#1a1410",
  sage: "#6fb58a",
  ember: "#f2a93b",
  core: "#ffe38a",
  flame: "#c8553d",
  violet: "#a07ad0",
};

// Side colours (base, light, dark) and a 3x5 letter for each.
const SIDE: Record<Side, string[]> = {
  a: ["#6fb58a", "#a6dcbb", "#3b8f60"],
  b: ["#c8553d", "#e98a72", "#8e3624"],
  c: ["#3f7cc4", "#8fb8e6", "#2b5f9e"],
  d: ["#8b63c4", "#bd9fe2", "#6b459f"],
};
const LETTER: Record<Side, string> = { a: "010101111101101", b: "110101110101110", c: "111100100100111", d: "110101101101110" };
const DIGITS = [
  "111101101101111", "010110010010111", "111001111100111", "111001111001111", "101101111001001",
  "111100111001111", "111100111101111", "111001001001001", "111101111101111", "111101111001111",
];

// Trees, benches and the rest, baked into the backdrop: [picture, x, baseline y].
const LAYOUT: [string, number, number][] = [
  ["tree", 14, 50], ["tree2", 306, 52], ["bench", 24, 112], ["bag", 16, 104], ["bottle", 30, 103],
  ["bench", 296, 112], ["ball", 288, 124], ["bush", 22, 146], ["bush", 298, 150], ["tree2", 12, 204], ["tree", 310, 202],
];

// Each scout is a 384x160 sheet of 16x32 frames. Rows: idle and walk (six
// frames per direction), then phone and book (twelve, facing out) and
// arms-up (fourteen, facing out).
const PEOPLE = [0, 1, 2].flatMap((tone) => [1, 2, 3, 4, 5, 6].map((n) => `scout${n}-${tone}`));
const DIR = { right: 0, up: 6, left: 12, down: 18 };
type Dir = keyof typeof DIR;

const ORDER: Beat[] = ["names", "facts", "judges", "bothSides", "crux", "ruling", "vote1", "more", "vote2", "trial", "final"];

// Where each agent waits, when it isn't off stage. Only a few are ever
// needed, so the others stay off the sides until their beat.
const AGENTS = [
  { id: "anon", home: { x: 40, y: 120 } },
  { id: "fact", home: { x: 280, y: 120 } },
  { id: "j1", home: { x: 112, y: 146 } },
  { id: "j2", home: { x: 160, y: 176 } },
  { id: "j3", home: { x: 208, y: 146 } },
  { id: "x1", home: { x: 76, y: 168 }, optional: true },
  { id: "x2", home: { x: 244, y: 168 }, optional: true },
  { id: "atk", home: { x: 300, y: 152 }, optional: true },
  { id: "adj", home: { x: 20, y: 152 }, optional: true },
];

// Each case the agents stand in loose groups that never cover each other,
// the two at centre court or the hoops: the judges together below the centre
// circle, the anonymizer and fact-checker on the left, the review pair on the
// right. A group's middle moves a little and its members scatter around it.
const GROUPS = [
  { ids: ["j1", "j2", "j3", "x1", "x2"], x: [148, 172], y: [158, 164], rx: 54, ry: 20 },
  { ids: ["anon", "fact"], x: [80, 94], y: [128, 150], rx: 16, ry: 16 },
  { ids: ["atk", "adj"], x: [226, 240], y: [128, 150], rx: 16, ry: 16 },
];
const BLOCKED = [
  { x0: 124, x1: 196, y0: 54, y1: 114 },
  { x0: 48, x1: 104, y0: 26, y1: 108 },
  { x0: 216, x1: 272, y0: 26, y1: 108 },
];

type Box = { x0: number; x1: number; y0: number; y1: number };
const boxAt = (p: Point): Box => ({ x0: p.x - 8, x1: p.x + 8, y0: p.y - 28, y1: p.y + 1 });
const hit = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const inside = (p: Point) => p.x > 62 && p.x < 258 && p.y > 76 && p.y < H - 2;

export function seeded(s: number): () => number {
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(a: readonly T[], rand: () => number): T[] {
  const out = a.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Where every agent stands this visit: scattered in its group, off the two at centre court and the hoops, off each other. */
export function pickSpots(rand: () => number): Record<string, Point> {
  for (let tries = 0; tries < 60; tries++) {
    const at: Record<string, Point> = {};
    const boxes: Box[] = [boxAt(SPOTS[2].atk), boxAt(SPOTS[2].adj)];
    let ok = true;
    for (const g of GROUPS) {
      const mx = g.x[0] + rand() * (g.x[1] - g.x[0]);
      const my = g.y[0] + rand() * (g.y[1] - g.y[0]);
      for (const id of shuffle(g.ids, rand)) {
        let spot: Point | null = null;
        for (let k = 0; k < 200 && !spot; k++) {
          const p = { x: mx + (rand() * 2 - 1) * g.rx, y: my + (rand() * 2 - 1) * g.ry };
          const box = boxAt(p);
          if (!inside(p) || BLOCKED.some((b) => hit(b, box)) || boxes.some((b) => hit(b, box))) continue;
          spot = p;
          boxes.push(box);
        }
        if (!spot) {
          ok = false;
          break;
        }
        at[id] = spot;
      }
      if (!ok) break;
    }
    if (ok) return at;
  }
  return Object.fromEntries(AGENTS.map((a) => [a.id, a.home]));
}

type BubbleKind = "think" | "redact" | "search" | "object" | "holds" | "crack" | "unsure" | "talk";
type Bubble = { kind: BubbleKind; side?: Side; start: number; until: number };

type Actor = {
  id: string;
  side?: Side;
  optional: boolean;
  who: string;
  img: HTMLImageElement | null;
  home: Point;
  off: Point;
  x: number;
  y: number;
  path: Point[];
  speed: number;
  facing: Dir;
  glance: number;
  glanceTo: Dir;
  nextMove: number;
  phase: number;
  bubble: Bubble | null;
  flag: Side | null;
  /** Where a scout at centre court looks while standing. */
  look: "right" | "left" | "down";
  hop: { start: number; n: number } | null;
  cheer: number | null;
  // Home: the next walk, and whether the shot comes on arrival.
  wait: number;
  shoot: boolean;
};

// How the judges read: how long a thought lasts, and the pause between.
const READING: Partial<Record<Beat, [number, number]>> = {
  judges: [3.2, 0.3],
  bothSides: [2.8, 0.6],
  crux: [2.4, 0.9],
  ruling: [4, 1.8],
};

export function createCourt(canvas: HTMLCanvasElement, opts: CourtOptions): Court {
  const rand = seeded((Math.random() * 2 ** 32) | 0);
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  canvas.width = W * PX;
  canvas.height = H * PX;
  ctx.imageSmoothingEnabled = false;

  let reduced = opts.reduced;
  let disposed = false;
  let ready = false;
  let dirty = true;
  let clock = 0;
  let events: { t: number; fn: () => void }[] = [];
  // Votes scheduled but not yet cast; a beat that ends early casts them at once.
  let owed: { c: Actor; v: Vote }[] = [];
  let scene: CourtScene | null = null;
  let busy = false;
  let over = false;
  let win: Side | null = null;
  const tags = { redacted: { a: false, b: false, c: false, d: false }, checked: false };
  let score = { a: 0, b: 0, c: 0, d: 0 };
  let shots: { side: Side; x: number; y: number; t: number }[] = [];
  let swish = { a: -9, b: -9, c: -9, d: -9 };
  let talkNext = 0;
  let talkAt = 1;

  // A different scout for every actor, for the whole visit.
  const spots = pickSpots(rand);
  const pick = shuffle(PEOPLE, rand);
  const actor = (id: string, home: Point, optional: boolean, who: string, side?: Side, r = rand): Actor => ({
    id,
    side,
    optional,
    who,
    img: null,
    home,
    off: { x: home.x < W / 2 ? -24 : W + 24, y: home.y },
    x: home.x,
    y: home.y,
    path: [],
    speed: SPEED,
    facing: "down",
    glance: 0,
    glanceTo: "left",
    nextMove: 2 + r() * 5,
    phase: r() * 10,
    bubble: null,
    flag: null,
    look: side === "a" ? "right" : side === "b" ? "left" : "down",
    hop: null,
    cheer: null,
    wait: 0,
    shoot: false,
  });
  const agents = AGENTS.map((a, i) => actor(a.id, { x: Math.round(spots[a.id].x), y: Math.round(spots[a.id].y) }, !!a.optional, pick[i]));
  const byId = Object.fromEntries(agents.map((a) => [a.id, a]));
  // The two who disagree, face to face at centre court. A third and fourth
  // scout, for a case with more sides, have a random stream of their own, so
  // a two-sided court draws exactly what it always did.
  const more = seeded(0x5ca7);
  const all = SIDES.map((side, i) =>
    actor(side, STAND[2].at[side] ?? { x: 160, y: 100 }, false, pick[agents.length + i], side, i < 2 ? rand : more),
  );
  all.forEach((p) => (p.facing = "up"));
  let pair = all.slice(0, 2);
  const everyone = () => [...agents, ...pair];
  const spots2 = SPOTS[2];
  let spot = spots2;
  const { anon, fact, j1, j2, j3, x1, x2, atk, adj } = byId;
  // The review pair come in from opposite edges, so both arrive in time to be heard.
  adj.off = { x: -24, y: adj.home.y };
  const judges = [j1, j2, j3];
  const crew = agents.slice(0, rand() < 0.5 ? 4 : 5);

  // Art
  const pics: Record<string, HTMLImageElement> = {};
  const bg = document.createElement("canvas");
  bg.width = W;
  bg.height = H;
  const names = ["ground", ...new Set(LAYOUT.map((p) => `props/${p[0]}`))];
  const load = (name: string) =>
    new Promise<HTMLImageElement | null>((ok) => {
      const img = new Image();
      img.onload = () => ok(img);
      img.onerror = () => ok(null);
      img.src = opts.src(name);
    });
  // The backdrop is the street court's ground and props, or one picture with
  // the venue's decoration baked in. `shown` is what the backdrop holds now.
  let venue: Venue = "court";
  let shown: Venue = "court";
  const venueArt = (v: Venue) => `venues/${v}`;
  const loadVenue = (v: Venue) =>
    v === "court" || pics[venueArt(v)] ? Promise.resolve() : load(venueArt(v)).then((img) => void (img && (pics[venueArt(v)] = img)));
  const hoopOf = (side: Side) => {
    const target = TARGETS[shown];
    return side === "a" || side === "c" ? target.a : target.b;
  };
  function paint() {
    const g = bg.getContext("2d") as CanvasRenderingContext2D;
    if (venue === "court") {
      if (pics.ground) g.drawImage(pics.ground, 0, 0);
      for (const [k, x, y] of LAYOUT) {
        const img = pics[`props/${k}`];
        if (img) g.drawImage(img, Math.round(x - img.width / 2), y - img.height);
      }
    } else {
      const img = pics[venueArt(venue)];
      if (!img) return;
      g.drawImage(img, 0, 0);
    }
    shown = venue;
  }
  function switchVenue(id: string | undefined) {
    venue = parseVenue(id) ?? "court";
    if (!ready || venue === shown) return;
    const v = venue;
    loadVenue(v).then(() => {
      if (disposed || venue !== v) return;
      paint();
      dirty = true;
    });
  }
  Promise.all([
    ...names.map((n) => load(n).then((img) => void (img && (pics[n] = img)))),
    ...everyone().map((c) => load(`people/${c.who}`).then((img) => void (c.img = img))),
  ]).then(() => {
    if (disposed) return;
    const first = () => {
      if (disposed) return;
      paint();
      ready = true;
      draw();
      opts.onReady?.();
    };
    if (venue === "court") first();
    else loadVenue(venue).then(first);
  });

  // Movement
  function route(c: Actor, p: Point) {
    c.path = [];
    if (scene?.kind === "judging") {
      // Round the two at centre court rather than through them.
      const dx = p.x - c.x;
      const dy = p.y - c.y;
      const len2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((CENTER.x - c.x) * dx + (CENTER.y - 10 - c.y) * dy) / len2));
      const qx = (c.x + dx * t - CENTER.x) / spot.ring.x;
      const qy = (c.y + dy * t - CENTER.y + 10) / spot.ring.y;
      const d = Math.hypot(qx, qy);
      if (d < 1) {
        const n = d < 0.01 ? [0, 1] : [qx / d, qy / d];
        c.path.push({ x: CENTER.x + n[0] * (spot.ring.x + 6), y: CENTER.y - 10 + n[1] * (spot.ring.y + 4) });
      }
    }
    c.path.push(p);
  }
  /** Walks there; the seconds it takes. */
  function go(c: Actor, p: Point, speed = SPEED): number {
    c.speed = speed;
    route(c, p);
    let len = 0;
    let from: Point = c;
    for (const q of c.path) {
      len += Math.hypot(q.x - from.x, q.y - from.y);
      from = q;
    }
    return len / speed;
  }
  function place(c: Actor, p: Point) {
    c.x = p.x;
    c.y = p.y;
    c.path = [];
  }
  const move = (c: Actor, p: Point, snap: boolean, speed = SPEED) => {
    if (!snap) return go(c, p, speed);
    place(c, p);
    return 0;
  };

  // Timeline
  const at = (t: number, fn: () => void) => events.push({ t: clock + t, fn });
  const loop = (t: number, every: () => number, fn: () => void) =>
    at(t, () => {
      fn();
      loop(every(), every, fn);
    });
  const bubble = (c: Actor, kind: BubbleKind, dur: number) => {
    c.bubble = { kind, start: clock, until: clock + dur };
  };
  const castAt = (t: number, c: Actor, v: Vote) => {
    const o = { c, v };
    owed.push(o);
    at(t, () => {
      owed.splice(owed.indexOf(o), 1);
      vote(c, v, false);
    });
  };
  const hold = (c: Actor, kind: BubbleKind) => bubble(c, kind, Infinity);

  /** A vote: the flag goes up, arms too, and the ball leaves for that side's hoop. */
  function vote(c: Actor, v: Vote, snap: boolean) {
    if (v === "other") {
      if (!snap) bubble(c, "unsure", 1.4);
      return;
    }
    c.flag = v;
    if (snap) {
      score[v]++;
      return;
    }
    c.cheer = clock;
    shots.push({ side: v, x: c.x, y: c.y - 30, t: clock + 0.5 });
  }

  function clear() {
    events = [];
    owed = [];
    shots = [];
    score = { a: 0, b: 0, c: 0, d: 0 };
    swish = { a: -9, b: -9, c: -9, d: -9 };
    over = false;
    win = null;
    busy = false;
    tags.redacted = { a: false, b: false, c: false, d: false };
    tags.checked = false;
    for (const c of [...agents, ...all]) {
      c.bubble = null;
      c.flag = null;
      c.hop = null;
      c.cheer = null;
      c.shoot = false;
      c.path = [];
    }
  }

  /** Who stands at centre court: two scouts, or three or four with their own images loaded on first use. */
  function setSides(n: number) {
    const count = Math.max(2, Math.min(4, Math.round(n) || 2));
    const stand = STAND[count];
    pair = all.filter((p) => p.side && stand.at[p.side]);
    spot = count > 2 ? SPOTS.many : spots2;
    for (const p of pair) {
      const side = p.side as Side;
      p.home = stand.at[side] as Point;
      p.look = stand.look[side] ?? "down";
      if (!p.img && p !== all[0] && p !== all[1]) {
        const img = new Image();
        img.onload = () => {
          p.img = img;
          dirty = true;
        };
        img.src = opts.src(`people/${p.who}`);
      }
    }
  }

  function startJudging() {
    clear();
    for (const c of agents) place(c, c.optional ? c.off : c.home);
    for (const p of pair) place(p, p.home);
  }

  const applicable = (b: Beat, s: Extract<CourtScene, { kind: "judging" }>) =>
    b === "vote1" ? s.votes.length > 0 : b === "more" || b === "vote2" ? s.extra > 0 : b === "trial" ? s.trial !== null && s.votes.length > 0 : true;

  /** Plays a beat. "skip" jumps to where it ends, "still" also shows its bubble (reduced motion). */
  function enter(beat: Beat, s: Extract<CourtScene, { kind: "judging" }>, mode: "play" | "skip" | "still") {
    const snap = mode !== "play";
    const still = mode === "still";
    const i = ORDER.indexOf(beat);
    for (const o of owed) vote(o.c, o.v, true);
    owed = [];
    events = [];
    for (const c of everyone()) c.bubble = null;
    tags.redacted = { a: i > 0, b: i > 0, c: i > 0, d: i > 0 };
    tags.checked = i > 1;
    const to = (c: Actor, p: Point, speed = SPEED) => move(c, p, snap, speed);
    const read = (cs: Actor[], t: number) => {
      const [dur, gap] = READING[beat] ?? [2.4, 0.6];
      cs.forEach((c, k) => {
        if (still) hold(c, "think");
        else loop(t + 0.2 + k * 0.6, () => dur + gap * (0.5 + rand()), () => bubble(c, "think", dur));
      });
    };

    if (beat === "names") {
      const eta = to(anon, spot.a, JOG);
      if (snap) {
        tags.redacted = { a: true, b: true, c: true, d: true };
        if (still) hold(anon, "redact");
      } else {
        loop(eta, () => 2.2, () => bubble(anon, "redact", 1.6));
        pair.forEach((p, k) => at(eta + 0.4 + k * 0.5, () => (tags.redacted[p.side as Side] = true)));
      }
    } else if (beat === "facts") {
      to(anon, anon.home);
      const eta = to(fact, spot.b);
      if (still) hold(fact, "search");
      else if (!snap) loop(eta, () => 2.4, () => bubble(fact, "search", 2.2));
    } else if (beat === "judges" || beat === "bothSides" || beat === "crux" || beat === "ruling") {
      to(anon, anon.home);
      to(fact, fact.home);
      if (!snap || still) read(judges, 0);
    } else if (beat === "vote1") {
      const n = Math.min(3, s.votes.length);
      for (let k = 0; k < n; k++) {
        if (snap) vote(judges[k], s.votes[k], true);
        else castAt(k * VOTE_S, judges[k], s.votes[k]);
      }
    } else if (beat === "more" || beat === "vote2") {
      const eta = Math.max(to(x1, x1.home, JOG), to(x2, x2.home, JOG));
      if (beat === "more") {
        if (!snap || still) read([x1, x2], eta);
      } else {
        [x1, x2].forEach((c, k) => {
          const v = s.votes[3 + k];
          if (v === undefined) return;
          if (snap) vote(c, v, true);
          else castAt(k * VOTE_S, c, v);
        });
      }
    } else if (beat === "trial") {
      const eta = Math.max(to(atk, spot.atk, TRIAL_SPEED), to(adj, spot.adj, TRIAL_SPEED));
      const answer = s.trial === "survived" ? "holds" : s.trial === "overturned" ? "crack" : "unsure";
      if (still) hold(adj, answer);
      else if (!snap) {
        at(eta + 0.1, () => bubble(atk, "object", 1.1));
        at(eta + 1.0, () => bubble(adj, answer, 2));
      }
    } else {
      over = true;
      win = s.winner;
      const leaving = [x1, x2, atk, adj];
      if (snap) {
        leaving.forEach((c) => {
          place(c, c.off);
          c.flag = null;
        });
      } else {
        const w = pair.find((p) => p.side === s.winner);
        if (w) {
          w.hop = { start: clock, n: 3 };
          w.cheer = clock;
        }
        at(1.6, () =>
          leaving.forEach((c) => {
            c.flag = null;
            go(c, c.off, JOG);
          }),
        );
      }
    }
  }

  function resnap(s: Extract<CourtScene, { kind: "judging" }>, to: number) {
    startJudging();
    for (let i = 0; i < to; i++) if (applicable(ORDER[i], s)) enter(ORDER[i], s, "skip");
    enter(ORDER[to], s, reduced ? "still" : "play");
  }

  function judging(prev: CourtScene | null, s: Extract<CourtScene, { kind: "judging" }>) {
    const to = ORDER.indexOf(s.beat);
    const from = prev?.kind === "judging" ? ORDER.indexOf(prev.beat) : -1;
    const standing = pair.length;
    setSides(s.sides ?? 2);
    const regrouped = pair.length !== standing;
    if (from === to && !regrouped) return;
    // The next beat in the story plays on from here; a jump, a step back or reduced motion starts over at the right place.
    const skipped = ORDER.slice(from + 1, to).some((b) => applicable(b, s));
    if (!reduced && from >= 0 && to > from && !skipped && !regrouped) enter(s.beat, s, "play");
    else resnap(s, to);
  }

  // Home: a few scouts shooting hoops, who huddle at centre court while the case is sent.
  const gather = (k: number): Point => ({ x: 160 + (k - (crew.length - 1) / 2) * 20, y: 106 + (k % 2) * 9 });
  function freeSpot(c: Actor): Point {
    const others = crew.filter((o) => o !== c).map((o) => boxAt(o.path.length ? o.path[o.path.length - 1] : o));
    let p = { x: 160, y: 140 };
    for (let k = 0; k < 40; k++) {
      p = { x: 70 + rand() * 180, y: 82 + rand() * 94 };
      const box = boxAt(p);
      if (inside(p) && !BLOCKED.some((b) => hit(b, box)) && !others.some((b) => hit(b, box))) break;
    }
    return p;
  }
  function startHome(b: boolean) {
    clear();
    for (const c of agents) place(c, c.off);
    for (const p of all) place(p, { x: p.home.x, y: H + 30 });
    busy = b;
    crew.forEach((c, k) => {
      if (busy) place(c, gather(k));
      else place(c, freeSpot(c));
      c.wait = clock + 1 + rand() * 3;
    });
  }
  function sendCrew(b: boolean) {
    busy = b;
    crew.forEach((c, k) => {
      c.shoot = false;
      c.wait = clock + 0.5 + rand() * 2;
      if (busy) go(c, gather(k), SPEED * 1.6);
    });
  }

  function replay() {
    if (!scene) return;
    if (scene.kind === "home") startHome(scene.busy);
    else resnap(scene, ORDER.indexOf(scene.beat));
    dirty = true;
  }

  // Frame
  function update(dt: number) {
    clock += dt;
    while (events.length) {
      const i = events.findIndex((e) => e.t <= clock);
      if (i < 0) break;
      events.splice(i, 1)[0].fn();
    }
    shots = shots.filter((sh) => {
      if (clock < sh.t + 0.8) return true;
      score[sh.side]++;
      swish[sh.side] = clock;
      return false;
    });
    if (scene?.kind === "judging" && !over && pair.every((p) => !p.path.length) && clock > talkNext) {
      talkAt = (talkAt + 1) % pair.length;
      const speaker = pair[talkAt];
      speaker.bubble = { kind: "talk", side: speaker.side, start: clock, until: clock + 1.1 };
      talkNext = clock + 1.4;
    }
    for (const c of everyone()) {
      if (c.path.length) {
        const p = c.path[0];
        const dx = p.x - c.x;
        const dy = p.y - c.y;
        const d = Math.hypot(dx, dy);
        const step = c.speed * dt;
        if (d > 0.01) c.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
        if (d <= step) {
          c.x = p.x;
          c.y = p.y;
          c.path.shift();
        } else {
          c.x += (dx / d) * step;
          c.y += (dy / d) * step;
        }
      }
      if (c.bubble && clock > c.bubble.until) c.bubble = null;
      if (clock > c.nextMove) {
        c.nextMove = clock + 3 + rand() * 5;
        if (!c.path.length) {
          c.glance = clock + 0.8 + rand() * 1.2;
          c.glanceTo = rand() < 0.5 ? "left" : "right";
        }
      }
    }
    if (scene?.kind === "home" && !busy) for (const c of crew) shootAround(c);
  }

  function shootAround(c: Actor) {
    if (c.path.length) return;
    if (c.shoot) {
      c.shoot = false;
      c.cheer = clock;
      const near: Side = c.x < W / 2 ? "a" : "b";
      const side: Side = rand() < 0.75 ? near : near === "a" ? "b" : "a";
      shots.push({ side, x: c.x, y: c.y - 30, t: clock + 0.5 });
      c.wait = clock + 2.5 + rand() * 3;
    } else if (clock > c.wait) {
      go(c, freeSpot(c));
      c.shoot = true;
    }
  }

  function lift(c: Actor): number {
    if (c.hop) {
      const k = (clock - c.hop.start) / 0.34;
      if (k >= c.hop.n) c.hop = null;
      else return Math.round(Math.abs(Math.sin(k * Math.PI)) * 6);
    }
    if (reduced) return 0;
    if (c.path.length) return Math.floor(clock * 8 + c.phase) % 2;
    if (busy && scene?.kind === "home") return Math.round(Math.abs(Math.sin(((clock + c.phase) * Math.PI) / 0.45)) * 3);
    return 0;
  }

  function drawLetter(side: Side, x: number, y: number, col: string) {
    ctx.fillStyle = col;
    for (let p = 0; p < 15; p++) if (LETTER[side][p] === "1") ctx.fillRect(x + (p % 3), y + Math.floor(p / 3), 1, 1);
  }
  function drawNum(n: number, x: number, y: number) {
    ctx.fillStyle = C.paper;
    [...String(n)].forEach((d, i) => {
      for (let p = 0; p < 15; p++) if (DIGITS[+d][p] === "1") ctx.fillRect(x + i * 4 + (p % 3), y + Math.floor(p / 3), 1, 1);
    });
  }
  // The scoreboard over the top of the court: side A's letter and score, side B's score and letter.
  // With more sides it holds one cell each, in the same space: letter, score, divider.
  function drawBoard() {
    const x = 138;
    const y = 3;
    const w = 44;
    const h = 11;
    ctx.fillStyle = C.out;
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = "#2b2723";
    ctx.fillRect(x, y, w, h);
    if (pair.length > 2) {
      const cw = Math.floor((w - 1) / pair.length);
      pair.forEach((p, i) => {
        const side = p.side as Side;
        const cx = x + 1 + i * cw + ((cw - 10) >> 1);
        ctx.fillStyle = SIDE[side][0];
        ctx.fillRect(cx, y + 1, 5, 9);
        drawLetter(side, cx + 1, y + 3, C.paper);
        drawNum(Math.min(9, score[side]), cx + 6, y + 3);
        if (i < pair.length - 1) {
          ctx.fillStyle = "#4a433c";
          ctx.fillRect(x + 1 + (i + 1) * cw - 1, y + 2, 1, h - 4);
        }
      });
      return;
    }
    ctx.fillStyle = "#4a433c";
    ctx.fillRect(x + w / 2, y + 2, 1, h - 4);
    ctx.fillStyle = SIDE.a[0];
    ctx.fillRect(x + 1, y + 1, 9, 9);
    drawLetter("a", x + 4, y + 3, C.paper);
    ctx.fillStyle = SIDE.b[0];
    ctx.fillRect(x + w - 10, y + 1, 9, 9);
    drawLetter("b", x + w - 7, y + 3, C.paper);
    drawNum(score.a, x + 12, y + 3);
    drawNum(score.b, x + w - 13 - (score.b > 9 ? 4 : 0), y + 3);
  }

  function drawBubble(x: number, top: number, b: Bubble) {
    const w = 13;
    const h = 9;
    const l = Math.round(x - w / 2);
    const t = top - h - 4;
    ctx.fillStyle = C.out;
    ctx.fillRect(l - 1, t - 1, w + 2, h + 2);
    ctx.fillRect(Math.round(x) - 1, t + h, 3, 2);
    ctx.fillStyle = C.paper;
    ctx.fillRect(l, t, w, h);
    ctx.fillRect(Math.round(x), t + h, 1, 1);
    const dots = (col: string, pts: number[][]) => {
      ctx.fillStyle = col;
      for (const [px, py] of pts) ctx.fillRect(l + px, t + py, 1, 1);
    };
    if (b.kind === "think") {
      ctx.fillStyle = "#5b5248";
      const n = reduced ? 3 : 1 + (Math.floor(clock * 3) % 3);
      for (let i = 0; i < n; i++) ctx.fillRect(l + 3 + i * 3, t + 4, 2, 2);
    } else if (b.kind === "redact") {
      ctx.fillStyle = "#b9ae98";
      ctx.fillRect(l + 2, t + 2, 9, 1);
      ctx.fillRect(l + 2, t + 6, 7, 1);
      ctx.fillStyle = C.out;
      ctx.fillRect(l + 2, t + 4, 6, 1);
    } else if (b.kind === "search") {
      dots(C.ember, [[4, 1], [5, 1], [6, 1], [3, 2], [7, 2], [3, 3], [7, 3], [3, 4], [7, 4], [4, 5], [5, 5], [6, 5], [8, 6], [9, 7]]);
    } else if (b.kind === "object") {
      dots(C.violet, [[5, 1], [6, 1], [7, 2], [6, 3], [6, 4], [6, 6]]);
    } else if (b.kind === "holds") {
      dots(C.sage, [[3, 5], [4, 6], [5, 5], [6, 4], [7, 3], [8, 2], [9, 1]]);
    } else if (b.kind === "crack") {
      dots(C.flame, [[3, 1], [4, 2], [5, 3], [6, 2], [7, 3], [8, 4], [7, 5], [8, 6], [9, 7]]);
    } else if (b.kind === "unsure") {
      dots(C.ember, [[5, 1], [6, 1], [7, 1], [8, 2], [7, 3], [6, 4], [6, 6]]);
    } else if (b.kind === "talk" && b.side) {
      ctx.fillStyle = SIDE[b.side][2];
      const n = 1 + (Math.floor((clock - b.start) * 5) % 3);
      for (let i = 0; i < n; i++) ctx.fillRect(l + 2, t + 2 + i * 2, [9, 6, 8][i], 1);
    }
  }

  // A name tag in the side's colour: its letter and the name, which the anonymizer blacks out; a tick once facts are checked.
  function drawTag(x: number, top: number, side: Side) {
    const l = Math.round(x) - 7;
    const t = top - 9;
    const hidden = tags.redacted[side];
    ctx.fillStyle = C.out;
    ctx.fillRect(l - 1, t - 1, 16, 9);
    ctx.fillStyle = SIDE[side][0];
    ctx.fillRect(l, t, 14, 7);
    drawLetter(side, l + 1, t + 1, C.paper);
    ctx.fillStyle = hidden ? C.out : C.paper;
    ctx.fillRect(l + 6, t + 2, 7, hidden ? 3 : 1);
    if (!hidden) ctx.fillRect(l + 6, t + 4, 5, 1);
    if (tags.checked) {
      ctx.fillStyle = C.core;
      ctx.fillRect(l + 12, t - 2, 1, 1);
      ctx.fillRect(l + 13, t - 1, 1, 1);
      ctx.fillRect(l + 14, t - 2, 1, 1);
      ctx.fillRect(l + 15, t - 3, 1, 1);
    }
  }

  function drawFlag(x: number, top: number, side: Side) {
    const px = Math.round(x) + 7;
    const py = top + 2;
    ctx.fillStyle = C.paper;
    ctx.fillRect(px, py - 4, 1, 12);
    ctx.fillStyle = C.out;
    ctx.fillRect(px + 1, py - 5, 8, 9);
    ctx.fillStyle = SIDE[side][0];
    ctx.fillRect(px + 1, py - 4, 7, 7);
    drawLetter(side, px + 3, py - 3, C.paper);
  }

  function draw() {
    if (!ready) return;
    dirty = false;
    ctx.setTransform(PX, 0, 0, PX, 0, 0);
    ctx.drawImage(bg, 0, 0);
    if (!scene) return;

    const heads: { c: Actor; x: number; top: number }[] = [];
    const seen = everyone().filter((c) => c.x > -16 && c.x < W + 16 && c.y < H + 29).sort((p, q) => p.y - q.y);
    for (const c of seen) {
      const up = lift(c);
      const kind = c.bubble?.kind;
      const cheer = c.cheer != null && !reduced ? Math.floor((clock - c.cheer) * 12) : 99;
      let row = 0;
      let col: number;
      if (cheer < 14 && !c.path.length) {
        row = 4;
        col = cheer;
      } else if (c.path.length) {
        row = 1;
        col = DIR[c.facing] + (reduced ? 0 : Math.floor(clock * 10 * (c.speed / SPEED) + c.phase) % 6);
      } else if (kind === "search" && c.bubble) {
        row = 2;
        const k = Math.floor((clock - c.bubble.start) * 8);
        col = reduced ? 5 : k < 4 ? k : 4 + ((k - 4) % 6);
      } else if ((kind === "think" || kind === "redact") && c.bubble) {
        row = 3;
        const k = Math.floor((clock - c.bubble.start) * 8);
        col = reduced ? 3 : k < 1 ? 0 : 1 + ((k - 1) % 6);
      } else {
        const dir: Dir = c.side
          ? c.look
          : c.id === "atk" && kind ? "left"
          : c.id === "adj" && kind ? "right"
          : clock < c.glance ? c.glanceTo
          : "down";
        col = DIR[dir] + (reduced ? 0 : Math.floor(clock * 6 + c.phase) % 6);
      }
      const x = Math.round(c.x);
      const y = Math.round(c.y);
      ctx.globalAlpha = c.side && win && win !== c.side ? 0.45 : 1;
      ctx.fillStyle = "rgba(0,0,0,.25)";
      ctx.fillRect(x - 5, y - 1, 10, 2);
      if (c.img && c.img.naturalWidth) ctx.drawImage(c.img, col * 16, row * 32, 16, 32, x - 8, y - 32 - up, 16, 32);
      ctx.globalAlpha = 1;
      heads.push({ c, x, top: y - 26 - up });
    }
    const ball = pics["props/ball"];
    for (const sh of shots) {
      const k = (clock - sh.t) / 0.8;
      if (k < 0 || !ball) continue;
      const h = hoopOf(sh.side);
      const x = sh.x + (h.x - sh.x) * k;
      const y = sh.y + (h.y - 6 - sh.y) * k - Math.sin(k * Math.PI) * 34;
      ctx.drawImage(ball, Math.round(x - 4), Math.round(y - 4));
    }
    for (const side of SIDES) {
      if (clock - swish[side] > 0.5) continue;
      const h = hoopOf(side);
      ctx.fillStyle = SIDE[side][1];
      for (let i = -3; i <= 3; i += 2) ctx.fillRect(h.x + i, h.y + 2 + ((i + Math.floor(clock * 20)) & 1), 1, 2);
    }
    drawBoard();
    for (const hd of heads) {
      if (hd.c.flag) drawFlag(hd.x, hd.top, hd.c.flag);
      if (hd.c.side && scene?.kind === "judging" && !hd.c.path.length) drawTag(hd.x, hd.top, hd.c.side);
      if (hd.c.bubble) drawBubble(hd.x, hd.top - (hd.c.side ? 9 : 0), hd.c.bubble);
    }
  }

  let raf = 0;
  let last = performance.now();
  function frame(now: number) {
    raf = 0;
    if (disposed || document.hidden) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!reduced) {
      update(dt);
      draw();
    } else if (dirty) {
      draw();
    }
    raf = requestAnimationFrame(frame);
  }
  function start() {
    if (raf || disposed || document.hidden) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function onVisibility() {
    if (document.hidden) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else start();
  }
  function onPointer(e: PointerEvent) {
    const r = canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const y = ((e.clientY - r.top) / r.height) * H;
    const hitIt = agents
      .filter((c) => Math.abs(c.x - x) < 8 && y < c.y + 2 && y > c.y - 30)
      .sort((p, q) => q.y - p.y)[0];
    if (hitIt) hitIt.hop = { start: clock, n: 2 };
  }
  canvas.addEventListener("pointerdown", onPointer);
  document.addEventListener("visibilitychange", onVisibility);
  start();

  return {
    set(next) {
      const prev = scene;
      scene = next;
      switchVenue(next.venue);
      if (next.kind === "home") {
        if (prev?.kind !== "home") startHome(next.busy);
        else if (prev.busy !== next.busy) {
          if (reduced) startHome(next.busy);
          else sendCrew(next.busy);
        }
      } else {
        judging(prev, next);
      }
      dirty = true;
    },
    setReduced(on) {
      if (on === reduced) return;
      reduced = on;
      replay();
      start();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      canvas.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}
