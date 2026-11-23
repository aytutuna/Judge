import { describe, expect, it } from "vitest";
import { ZONE_R, createPlay, type Beam } from "../lib/scene-play";

const level: Beam = { theta: 0, omega: 0, rise: 0 };

function setup() {
  let seed = 7;
  const play = createPlay(() => (seed = (seed * 16807) % 2147483647) / 2147483647);
  play.reset(level);
  return play;
}

function run(play: ReturnType<typeof setup>, seconds: number) {
  for (let t = 0; t < seconds; t += 1 / 60) play.step(1 / 60, level);
}

const seated = (play: ReturnType<typeof setup>) => play.balls.length === 2 && play.balls.every((b) => b.state === "seat");

/** Press on side A's ball and drag it past the tap distance to `at`. */
function drag(play: ReturnType<typeof setup>, at: { x: number; y: number }) {
  const ball = play.current(-1)!;
  play.grab(ball, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: ball.x, y: ball.y });
  play.drag({ x: 30, y: 0 }, at);
  return ball;
}

describe("ball play", () => {
  it("throws a tapped ball and seats the one that drops in", () => {
    const play = setup();
    const ball = play.current(-1)!;
    play.grab(ball, { x: 0, y: 0 }, { x: 5, y: 5 }, null);
    play.drag({ x: 7, y: 6 }, null);
    play.release(true);
    expect(ball.state).toBe("free");
    expect(play.current(-1)).toBeUndefined();
    run(play, 0.1);
    expect(play.weight(-1)).toBe(0);
    run(play, 5);
    expect(seated(play)).toBe(true);
    expect(play.balls).not.toContain(ball);
  });

  it("does not throw on a cancelled tap", () => {
    const play = setup();
    const ball = play.current(-1)!;
    play.grab(ball, { x: 0, y: 0 }, { x: 5, y: 5 }, null);
    play.release(false);
    expect(ball.state).toBe("seat");
  });

  it("pulls a gently released ball back into its cup", () => {
    const play = setup();
    const s = play.seats[0];
    const ball = drag(play, { x: s.x - 0.8, y: s.y + 0.5 });
    run(play, 0.2);
    play.release(true);
    expect(ball.armed).toBe(true);
    run(play, 3);
    expect(ball.state).toBe("seat");
    expect(seated(play)).toBe(true);
  });

  it("throws a ball released outside the zone or flung", () => {
    const play = setup();
    const s = play.seats[0];
    const far = drag(play, { x: s.x - ZONE_R - 1, y: s.y + 2 });
    run(play, 0.2);
    play.release(true);
    expect(far.armed).toBe(false);
    expect(far.state).toBe("free");

    const fling = setup();
    const t = fling.seats[0];
    const ball = drag(fling, { x: t.x - 0.5, y: t.y });
    for (let i = 1; i <= 5; i++) {
      fling.drag({ x: 30 + i, y: 0 }, { x: t.x - 0.5 + i * 0.2, y: t.y });
      run(fling, 1 / 60);
    }
    fling.release(true);
    expect(ball.armed).toBe(false);
  });

  it("tilts toward the side that still holds a ball", () => {
    const play = setup();
    expect(play.tilt()).toBe(0);
    play.grab(play.current(-1)!, { x: 0, y: 0 }, { x: 0, y: 0 }, null);
    play.release(true);
    run(play, 0.1);
    expect(play.tilt()).toBeLessThan(0);
  });

  it("seats everything again on reset", () => {
    const play = setup();
    drag(play, { x: 5, y: 5 });
    run(play, 0.2);
    play.reset(level);
    expect(play.grabbing).toBe(false);
    expect(seated(play)).toBe(true);
  });

  it("keeps one current ball per side when a thrown ball is dragged", () => {
    const play = setup();
    const s = play.seats[0];
    const old = drag(play, { x: s.x - 0.8, y: s.y + 0.5 });
    run(play, 0.2);
    play.release(true);
    expect(old.armed).toBe(true);
    play.grab(old, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: old.x, y: old.y });
    old.x = s.x - 5;
    old.y = s.y;
    run(play, 0.1);
    expect(old.armed).toBe(false);
    run(play, 0.5);
    const fresh = play.current(-1)!;
    expect(fresh).not.toBe(old);
    play.drag({ x: 30, y: 0 }, { x: old.x, y: old.y });
    expect(play.grabbing).toBe(false);
    expect(old.state).toBe("free");
    run(play, 8);
    expect(seated(play)).toBe(true);
  });

  it("flings from the last pointer samples, even on the release event", () => {
    const play = setup();
    const s = play.seats[0];
    const ball = play.current(-1)!;
    play.grab(ball, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: ball.x, y: ball.y }, 1);
    play.drag({ x: 40, y: 0 }, { x: s.x - 0.5, y: s.y }, 1.01);
    play.drag({ x: 41, y: 0 }, { x: s.x - 1, y: s.y }, 1.02);
    play.release(true);
    expect(ball.armed).toBe(false);
    expect(ball.state).toBe("free");
  });
});
