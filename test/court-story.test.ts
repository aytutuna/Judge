import { describe, expect, it } from "vitest";
import {
  CATCH_UP_MS,
  ENDING_MAX_MS,
  NAMES_MIN_MS,
  TRIAL_MS,
  VOTE_MS,
  WAITING,
  agreement,
  ending,
  waitingAt,
  type Summary,
} from "../components/court/story";

const summary = (over: Partial<Summary> = {}): Summary => ({
  votes: ["a", "a", "a"],
  escalated: false,
  extra: 0,
  winner: "a",
  trial: null,
  ...over,
});

describe("waitingAt", () => {
  it("holds on names until the server has them out, then walks the steps", () => {
    expect(waitingAt(60000, null)).toBe(0);
    expect(waitingAt(1000, 400)).toBe(0);
    expect(waitingAt(NAMES_MIN_MS + 10, 400)).toBe(1);
    expect(waitingAt(5000, 4000)).toBe(1);
    expect(waitingAt(4000 + 9000 + 10, 4000)).toBe(2);
    expect(waitingAt(10 * 60000, 4000)).toBe(5);
  });
});

describe("agreement", () => {
  it("is the most common vote, with no side on a tie", () => {
    expect(agreement(["a", "b", "a"])).toEqual({ side: "a", n: 2 });
    expect(agreement(["a", "b"]).side).toBeNull();
    expect(agreement(["a", "b", "b", "other"])).toEqual({ side: null, n: 2 });
    expect(agreement(["b", "a", "a", "b", "b"])).toEqual({ side: "b", n: 3 });
    expect(agreement([])).toEqual({ side: null, n: 0 });
  });
});

describe("ending", () => {
  const plan = (from: number, s: Summary | null, reduced = false) =>
    ending(from, s, reduced).steps.map((x) => [x.at, x.beat, x.line?.key ?? null]);

  it("hands off at once without a result, shortly after with reduced motion", () => {
    expect(ending(2, null, false)).toEqual({ steps: [], finishAt: 0 });
    expect(ending(2, summary(), true)).toEqual({ steps: [], finishAt: 600 });
  });

  it("a unanimous verdict catches up, counts, agrees and is ready", () => {
    const hold = 1200 + 3 * VOTE_MS;
    expect(plan(4, summary())).toEqual([
      [0, "ruling", "story.ruling"],
      [CATCH_UP_MS, "vote1", "story.count"],
      [CATCH_UP_MS + hold + 600, "final", "story.agree"],
      [CATCH_UP_MS + hold + 600, "final", "thinking.ready"],
    ]);
    expect(ending(4, summary(), false).finishAt).toBe(CATCH_UP_MS + hold + 600 + 1900);
    expect(ending(4, summary(), false).steps[2].line?.vars).toEqual({ n: 3, total: 3 });
  });

  it("catches the remaining waiting lines up one after another", () => {
    const beats = ending(0, summary(), false).steps.slice(0, 5);
    expect(beats.map((x) => x.beat)).toEqual(WAITING.slice(1));
    expect(beats.map((x) => x.at)).toEqual([0, 1, 2, 3, 4].map((i) => i * CATCH_UP_MS));
  });

  it("starts the votes straight away when the story was already at the ruling", () => {
    expect(plan(5, summary()).slice(0, 1)).toEqual([[CATCH_UP_MS, "vote1", "story.count"]]);
  });

  it("a split says so", () => {
    const keys = plan(5, summary({ votes: ["a", "b", "other"], winner: null })).map((x) => x[2]);
    expect(keys).toEqual(["story.count", "story.split", "thinking.ready"]);
  });

  it("a refusal with no votes skips to the end", () => {
    const e = ending(5, summary({ votes: [], winner: null }), false);
    expect(e.steps.map((x) => [x.at, x.beat, x.line?.key])).toEqual([[600, "final", "thinking.ready"]]);
    expect(e.finishAt).toBe(2500);
  });

  it("a close call brings more judges, and a second round when there are extra votes", () => {
    const votes = ["a", "b", "a", "a", "b"] as const;
    const s = summary({ votes: [...votes], escalated: true, extra: 2 });
    const first = CATCH_UP_MS;
    const more = first + 1200 + 3 * VOTE_MS + 400;
    expect(plan(5, s)).toEqual([
      [first, "vote1", "story.count"],
      [more, "more", "story.closeCall"],
      [more + 2600, "vote2", null],
      [more + 2600 + 2 * VOTE_MS + 600, "final", "story.agree"],
      [more + 2600 + 2 * VOTE_MS + 600, "final", "thinking.ready"],
    ]);
  });

  it("a close call with no extra votes has no second round", () => {
    const beats = plan(5, summary({ escalated: true, extra: 0 })).map((x) => x[1]);
    expect(beats).toEqual(["vote1", "more", "final", "final"]);
  });

  it.each(["survived", "uncertain", "overturned"] as const)("a %s trial comes before the final", (outcome) => {
    const e = ending(5, summary({ trial: outcome }), false);
    const trial = e.steps.find((x) => x.beat === "trial");
    const count = e.steps.find((x) => x.beat === "vote1");
    expect(trial?.line?.key).toBe(`trial.${outcome}`);
    expect(trial?.at).toBe(count!.at + 1200 + 3 * VOTE_MS + 600);
    expect(e.steps.find((x) => x.beat === "final")!.at).toBe(trial!.at + TRIAL_MS + 600);
  });

  it("a trial needs votes", () => {
    const beats = plan(5, summary({ votes: [], winner: null, trial: "survived" })).map((x) => x[1]);
    expect(beats).toEqual(["final"]);
  });

  it("the longest ending fits in ENDING_MAX_MS", () => {
    const s = summary({ votes: ["a", "b", "a", "a", "b"], escalated: true, extra: 2, trial: "overturned" });
    expect(ending(0, s, false).finishAt).toBeLessThanOrEqual(ENDING_MAX_MS);
  });
});
