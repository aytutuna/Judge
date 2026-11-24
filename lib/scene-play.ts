import { PIVOT_Y, PLINTH, SPHERE_R, sphereCentre } from "./scene-poses";

/** Radius of the magnet zone around each seat. */
export const ZONE_R = 1.6;

const G = 22;
const PULL = 120;
const PULL_DAMP = 22;
const STEP = 1 / 240;
const TAP_PX = 8;
const NEAR_RING = 0.35;

export type Side = -1 | 1;

export type Ball = {
  side: Side;
  /** Seated in the cup, held by the pointer, or free (armed or thrown). */
  state: "seat" | "held" | "free";
  /** A free ball the magnet takes back; a thrown one flies and fades. */
  armed: boolean;
  entered: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Scale 0..1: grows in when it drops, shrinks away when thrown. */
  k: number;
  age: number;
  /** Magnet strength 0..1 while it is pulled in. */
  pull: number;
  /** Weight on the cup while held over it, in ball weights (0..3). */
  load: number;
  tx: number;
  ty: number;
};

export type Beam = { theta: number; omega: number; rise: number };
type Pt = { x: number; y: number };
type Seat = { x: number; y: number; vx: number; vy: number };
type Sample = { t: number; x: number; y: number };
type Grab = { ball: Ball; n: Pt; from: Pt; dragging: boolean; offX: number; offY: number; samples: Sample[] };

const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/** Two balls on the scale: seated, picked up, thrown, and pulled back by a
 * magnet around each cup. Positions are world units; `rand` picks where a
 * new ball drops. */
export function createPlay(rand: () => number) {
  const balls: Ball[] = [];
  const seats: [Seat, Seat] = [
    { x: 0, y: 0, vx: 0, vy: 0 },
    { x: 0, y: 0, vx: 0, vy: 0 },
  ];
  const pending = [0, 0];
  let grab: Grab | null = null;
  let clock = 0;
  let acc = 0;

  const seatOf = (side: Side) => seats[side < 0 ? 0 : 1];

  function place(beam: Beam) {
    for (const side of [-1, 1] as const) {
      const c = sphereCentre(side, beam.theta, 0, beam.rise);
      const s = seatOf(side);
      s.x = c.x;
      s.y = c.y;
      s.vx = -beam.omega * (c.y - PIVOT_Y - beam.rise);
      s.vy = beam.omega * c.x;
    }
  }

  function add(side: Side, state: Ball["state"], x: number, y: number, z: number) {
    const b: Ball = {
      side,
      state,
      armed: state === "free",
      entered: false,
      x,
      y,
      z,
      vx: 0,
      vy: 0,
      vz: 0,
      k: state === "seat" ? 1 : 0,
      age: 0,
      pull: 0,
      load: 0,
      tx: 0,
      ty: 0,
    };
    balls.push(b);
    return b;
  }

  const occupied = (side: Side) => balls.some((b) => b.side === side && b.state !== "free");

  function current(side: Side) {
    return balls.find((b) => b.side === side && (b.state !== "free" || b.armed));
  }

  /** How much of its weight a side puts on the beam. */
  function weight(side: Side) {
    const b = current(side);
    if (!b) return 0;
    return b.state === "seat" ? 1 : b.state === "held" ? b.load : b.pull;
  }

  function reset(beam: Beam) {
    balls.length = 0;
    grab = null;
    pending[0] = pending[1] = 0;
    acc = 0;
    place(beam);
    for (const side of [-1, 1] as const) {
      const s = seatOf(side);
      add(side, "seat", s.x, s.y, 0);
    }
  }

  function toss(b: Ball, vx: number, vy: number, vz: number) {
    b.state = "free";
    b.armed = false;
    b.pull = 0;
    b.load = 0;
    b.age = 0;
    b.vx = vx;
    b.vy = vy;
    b.vz = vz;
    pending[b.side < 0 ? 0 : 1] = clock + 0.6;
  }

  function disarm(b: Ball) {
    b.armed = false;
    b.pull = 0;
    b.age = 0;
    pending[b.side < 0 ? 0 : 1] = clock + 0.3;
  }

  function sub(h: number) {
    clock += h;
    for (let i = balls.length - 1; i >= 0; i--) {
      const b = balls[i];
      const s = seatOf(b.side);
      b.age += h;
      if (b.k < 1 && (b.state !== "free" || b.armed)) b.k = Math.min(1, b.k + h / 0.22);

      if (b.state === "seat") {
        b.x = s.x;
        b.y = s.y;
        b.z = 0;
      } else if (b.state === "held") {
        // Over its cup, a pointer at or below the seat rests the ball in the
        // cup and pushes it down; anywhere else the ball is off the scale.
        const over = Math.abs(b.tx - s.x) < 0.45;
        b.load = over ? Math.min(3, Math.max(0, 1 + (PULL / G) * (s.y - b.ty))) : 0;
        if (over && b.ty <= s.y) {
          b.x = s.x;
          b.y = s.y;
        } else {
          b.x = b.tx;
          b.y = Math.max(b.ty, over ? s.y : PLINTH.h + SPHERE_R);
        }
        b.z = 0;
      } else {
        b.pull = 0;
        if (b.armed && !occupied(b.side)) {
          const dx = s.x - b.x;
          const dy = s.y - b.y;
          const dz = -b.z;
          const d = Math.hypot(dx, dy, dz);
          if (d < ZONE_R) {
            b.entered = true;
            b.pull = smooth((1 - d / ZONE_R) / NEAR_RING);
            b.vx += b.pull * (PULL * dx - PULL_DAMP * (b.vx - s.vx)) * h;
            b.vy += b.pull * (PULL * dy - PULL_DAMP * (b.vy - s.vy)) * h;
            b.vz += b.pull * (PULL * dz - PULL_DAMP * b.vz) * h;
            if (d < 0.1 && Math.hypot(b.vx - s.vx, b.vy - s.vy, b.vz) < 4) {
              b.state = "seat";
              b.pull = 0;
              b.vx = b.vy = b.vz = 0;
              continue;
            }
          } else if (b.entered || b.age > 3) disarm(b);
        }
        b.vy -= G * (1 - b.pull) * h;
        b.x += b.vx * h;
        b.y += b.vy * h;
        b.z += b.vz * h;
        if (b.pull) continue;

        const r = SPHERE_R * b.k;
        let rolling = false;
        const onPlinth = Math.abs(b.x) < PLINTH.w / 2 && Math.abs(b.z) < PLINTH.d / 2;
        if (onPlinth && b.y < PLINTH.h + r && b.y > PLINTH.h + r - 0.3 && b.vy < 0) {
          b.y = PLINTH.h + r;
          b.vy = Math.abs(b.vy) < 0.8 ? 0 : -b.vy * 0.42;
          rolling = true;
        } else if (b.y < r) {
          b.y = r;
          b.vy = Math.abs(b.vy) < 0.8 ? 0 : -b.vy * 0.42;
          rolling = true;
        }
        if (rolling) {
          b.vx *= 1 - 1.4 * h;
          b.vz *= 1 - 1.4 * h;
        }
        if (!b.armed && b.age > 1.6) b.k -= h * 2;
        if (b.k <= 0) balls.splice(i, 1);
      }
    }

    for (const side of [-1, 1] as const) {
      const i = side < 0 ? 0 : 1;
      if (!pending[i] || clock < pending[i]) continue;
      pending[i] = 0;
      if (balls.some((b) => b.side === side && (b.state !== "free" || b.armed))) continue;
      // The new ball drops in beside the cup and the magnet pulls it the
      // rest of the way.
      const s = seatOf(side);
      add(side, "free", s.x + side * (0.7 + rand() * 0.5), 6.2, -rand() * 0.5);
    }
  }

  return {
    balls,
    seats,
    current,
    reset,
    get grabbing() {
      return grab !== null;
    },
    /** Something is moving or about to: keep the frames running. */
    get busy() {
      return grab !== null || pending[0] > 0 || pending[1] > 0 || balls.some((b) => b.state !== "seat");
    },
    step(dt: number, beam: Beam) {
      place(beam);
      acc += dt;
      while (acc >= STEP) {
        acc -= STEP;
        sub(STEP);
      }
      for (const b of balls) {
        if (b.state === "seat") {
          const s = seatOf(b.side);
          b.x = s.x;
          b.y = s.y;
        }
      }
    },
    weight,
    /** Beam tilt target from the weights, positive with side A down. */
    tilt() {
      return Math.max(-0.4, Math.min(0.4, 0.35 * (weight(-1) - weight(1))));
    },
    /** `n`: where the pointer met the ball, in radii from its centre. `at`:
     * the pointer on the z = 0 plane. `css`: the pointer in screen pixels. */
    grab(ball: Ball, n: Pt, css: Pt, at: Pt | null, t = clock) {
      grab = {
        ball,
        n,
        from: { x: css.x, y: css.y },
        dragging: false,
        offX: at ? at.x - ball.x : 0,
        offY: at ? at.y - ball.y : 0,
        samples: at ? [{ t, x: ball.x, y: ball.y }] : [],
      };
    },
    /** `t`: the pointer event's time in seconds; release speed comes from
     * the last few of these. */
    drag(css: Pt, at: Pt | null, t = clock) {
      if (!grab) return;
      const b = grab.ball;
      if (!balls.includes(b)) {
        grab = null;
        return;
      }
      if (!grab.dragging && Math.hypot(css.x - grab.from.x, css.y - grab.from.y) > TAP_PX) {
        // A ball thrown since the press is no longer the player's to hold.
        if (b.state === "free" && !b.armed) {
          grab = null;
          return;
        }
        grab.dragging = true;
        b.state = "held";
        b.armed = false;
        b.pull = 0;
        b.vx = b.vy = b.vz = 0;
        b.k = 1;
        b.tx = b.x;
        b.ty = b.y;
      }
      if (at) {
        const x = Math.min(6, Math.max(-6, at.x - grab.offX));
        const y = Math.min(6, Math.max(PIVOT_Y - 1.2, at.y - grab.offY));
        if (grab.dragging) {
          b.tx = x;
          b.ty = y;
        }
        const list = grab.samples;
        list.push({ t, x, y });
        while (list.length > 2 && t - list[0].t > 0.09) list.shift();
      }
    },
    /** A cancelled press never throws a ball it only tapped. */
    release(up: boolean) {
      if (!grab) return;
      const { ball: b, n, dragging, samples } = grab;
      grab = null;
      if (!balls.includes(b)) return;
      const s = seatOf(b.side);
      if (!dragging) {
        if (up && (b.state !== "free" || b.armed)) toss(b, (b.state === "free" ? b.vx : s.vx) - n.x * 4, Math.max(3.5, 5 - n.y * 3), -11);
        return;
      }
      b.load = 0;
      const first = samples[0];
      const last = samples[samples.length - 1];
      const span = last && first ? last.t - first.t : 0;
      let vx = span > 0 ? (last.x - first.x) / span : 0;
      let vy = span > 0 ? (last.y - first.y) / span : 0;
      const speed = Math.hypot(vx, vy);
      if (speed > 18) {
        vx *= 18 / speed;
        vy *= 18 / speed;
      }
      // Let go gently inside the zone and the magnet takes it back; a fling
      // or a release outside sends it off the scale.
      if (speed < 5 && Math.hypot(b.x - s.x, b.y - s.y) < ZONE_R) {
        b.state = "free";
        b.armed = b.entered = true;
        b.age = 0;
        b.vx = vx;
        b.vy = vy;
        b.vz = 0;
      } else toss(b, vx, vy, -3 - Math.min(speed, 18) * 0.15);
    },
  };
}

export type Play = ReturnType<typeof createPlay>;
