import { describe, expect, it } from "vitest";
import type { CaseView } from "../lib/case-types";
import { caseHistoryState, historyStateFromView, verdictHistoryState, type CaseFacts } from "../lib/history-state";
import { compareHistory } from "../lib/history-types";

const NOW = new Date("2026-10-28T12:00:00.000Z");
const LATER = "2026-11-01T12:00:00.000Z";

const facts = (over: Partial<CaseFacts> = {}): CaseFacts => ({
  party: "a",
  status: "judged",
  expiresAt: LATER,
  removedA: false,
  removedB: false,
  appeals: [],
  latest: { appealId: null, verdict: "side_b" },
  ...over,
});

const pick = (f: CaseFacts, now = NOW) => {
  const d = caseHistoryState(f, now);
  return [d.state, d.yourMove, d.removable];
};

describe("a case you started", () => {
  it("waits for the answer until the link closes, then reads as expired with your turn to judge it alone", () => {
    expect(pick(facts({ status: "awaiting_respondent", latest: null }))).toEqual(["waiting", false, true]);
    const past = facts({ status: "awaiting_respondent", expiresAt: "2026-10-28T11:59:59.000Z", latest: null });
    expect(pick(past)).toEqual(["expired", true, true]);
    expect(pick(facts({ status: "expired", latest: null }))).toEqual(["expired", true, true]);
  });

  it("stops saying it's your turn a week after the link expired", () => {
    const old = facts({ status: "expired", expiresAt: "2026-10-20T12:00:00.000Z", latest: null });
    expect(pick(old)).toEqual(["expired", false, true]);
  });

  it("judging can't be removed; a failed run is yours to retry", () => {
    expect(pick(facts({ status: "judging", latest: null }))).toEqual(["judging", false, false]);
    expect(pick(facts({ status: "failed", latest: null }))).toEqual(["failed", true, true]);
  });

  it("a ruling is ready, also one judged on your side alone", () => {
    expect(caseHistoryState(facts(), NOW)).toEqual({
      state: "ready",
      yourMove: false,
      removable: true,
      verdict: "side_b",
      contextAdded: false,
      contextBy: null,
    });
    expect(caseHistoryState(facts({ latest: { appealId: "ap1", verdict: "side_a" } }), NOW)).toMatchObject({
      state: "ready",
      verdict: "side_a",
      contextAdded: true,
    });
  });

  it("an unreadable latest ruling is still ready, with no verdict", () => {
    expect(caseHistoryState(facts({ latest: null }), NOW)).toMatchObject({ state: "ready", verdict: null });
  });

  it("re-judging on context from you or the other side keeps the standing ruling and can't be removed", () => {
    const mine = caseHistoryState(facts({ appeals: [{ id: "x", party: "a", status: "judging" }] }), NOW);
    expect(mine).toMatchObject({ state: "rejudging", contextBy: "you", removable: false, verdict: "side_b" });
    const theirs = caseHistoryState(facts({ appeals: [{ id: "x", party: "b", status: "judging" }] }), NOW);
    expect(theirs).toMatchObject({ state: "rejudging", contextBy: "other" });
  });

  it("your own failed context is yours to send again; the other side's failure leaves it ready", () => {
    const mine = caseHistoryState(facts({ appeals: [{ id: "x", party: "a", status: "failed" }] }), NOW);
    expect(mine).toMatchObject({ state: "rejudge_failed", yourMove: true, removable: true, verdict: "side_b" });
    const theirs = caseHistoryState(facts({ appeals: [{ id: "x", party: "b", status: "failed" }] }), NOW);
    expect(theirs.state).toBe("ready");
  });

  it("removed by you, or by the other side (the ruling stays listed for you)", () => {
    expect(caseHistoryState(facts({ removedA: true }), NOW)).toMatchObject({ state: "removed", verdict: null, removable: false });
    expect(caseHistoryState(facts({ removedB: true }), NOW)).toMatchObject({
      state: "removed_by_other",
      verdict: "side_b",
      removable: false,
    });
  });
});

describe("a case you answered", () => {
  const b = (over: Partial<CaseFacts> = {}) => facts({ party: "b", ...over });

  it("judging, failed (only the owner retries), ready", () => {
    expect(pick(b({ status: "judging", latest: null }))).toEqual(["judging", false, false]);
    expect(pick(b({ status: "failed", latest: null }))).toEqual(["failed", false, true]);
    expect(pick(b())).toEqual(["ready", false, true]);
  });

  it("context and removal from your side are yours, the owner's are the other side's", () => {
    expect(caseHistoryState(b({ appeals: [{ id: "x", party: "b", status: "judging" }] }), NOW).contextBy).toBe("you");
    expect(caseHistoryState(b({ appeals: [{ id: "x", party: "a", status: "judging" }] }), NOW).contextBy).toBe("other");
    expect(caseHistoryState(b({ appeals: [{ id: "x", party: "b", status: "failed" }] }), NOW).state).toBe("rejudge_failed");
    expect(caseHistoryState(b({ removedB: true }), NOW).state).toBe("removed");
    expect(caseHistoryState(b({ removedA: true }), NOW).state).toBe("removed_by_other");
  });
});

describe("a verdict of your own", () => {
  const base = { job: null, removed: false, round: null, verdict: "side_a" as const, fromRound: false };

  it("judging or failed before anything is stored: nothing to open or remove", () => {
    expect(verdictHistoryState({ ...base, job: "judging", verdict: null })).toMatchObject({ state: "judging", removable: false });
    expect(verdictHistoryState({ ...base, job: "failed", verdict: null })).toMatchObject({ state: "failed", removable: false });
  });

  it("ready, removed, and the states of added context", () => {
    expect(verdictHistoryState(base)).toMatchObject({ state: "ready", removable: true, verdict: "side_a" });
    expect(verdictHistoryState({ ...base, fromRound: true })).toMatchObject({ contextAdded: true });
    expect(verdictHistoryState({ ...base, removed: true })).toMatchObject({ state: "removed", removable: false, verdict: null });
    // Removing while a round runs is allowed: the round inherits the removal.
    expect(verdictHistoryState({ ...base, round: "judging" })).toMatchObject({
      state: "rejudging",
      contextBy: "you",
      removable: true,
    });
    expect(verdictHistoryState({ ...base, round: "failed" })).toMatchObject({ state: "rejudge_failed", yourMove: true });
    expect(verdictHistoryState({ ...base, round: "judged", fromRound: true })).toMatchObject({ state: "ready", contextAdded: true });
  });
});

describe("historyStateFromView", () => {
  const view = (over: Partial<CaseView>): CaseView =>
    ({
      id: "c1",
      role: "owner",
      yourParty: "a",
      status: "judged",
      mode: "two_sided",
      expiresAt: LATER,
      appeals: [],
      verdicts: [],
      removed: null,
      ...over,
    }) as CaseView;
  const verdict = (appealId: string | null, v: "side_a" | "side_b") =>
    ({ seq: 1, id: "v", appealId, createdAt: LATER, result: { verdict: v } }) as CaseView["verdicts"][number];

  it("agrees with the stored facts for the same case", () => {
    const cases: [Partial<CaseView>, CaseFacts][] = [
      [{ status: "awaiting_respondent" }, facts({ status: "awaiting_respondent", latest: null })],
      [{ verdicts: [verdict(null, "side_b")] }, facts()],
      [
        { yourParty: "b", role: "respondent", verdicts: [verdict("ap", "side_a")], appeals: [{ id: "q", party: "a", status: "judging" }] as CaseView["appeals"] },
        facts({ party: "b", latest: { appealId: "ap", verdict: "side_a" }, appeals: [{ id: "q", party: "a", status: "judging" }] }),
      ],
      [{ removed: { at: LATER, parties: ["b"] }, verdicts: [verdict(null, "side_b")] }, facts({ removedB: true })],
    ];
    for (const [v, f] of cases) expect(historyStateFromView(view(v), NOW)).toEqual(caseHistoryState(f, NOW));
  });
});

describe("compareHistory", () => {
  it("orders by time, then by key, newest first, as plain strings", () => {
    const rows = [
      { kind: "case" as const, id: "b", at: "2026-10-01T00:00:00.000Z" },
      { kind: "verdict" as const, id: "a", at: "2026-10-01T00:00:00.000Z" },
      { kind: "case" as const, id: "a", at: "2026-10-01T00:00:00.000Z" },
      { kind: "verdict" as const, id: "z", at: "2026-10-02T00:00:00.000Z" },
    ];
    expect([...rows].sort(compareHistory).map((r) => `${r.kind}:${r.id}`)).toEqual([
      "verdict:z",
      "verdict:a",
      "case:b",
      "case:a",
    ]);
  });
});
