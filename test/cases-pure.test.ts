import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  derivedSecret: (purpose: string) => createHmac("sha256", "k").update(purpose).digest(),
  getAuth: vi.fn(),
}));
vi.mock("@/lib/evidence", () => ({ evidenceBlock: () => null }));

import { appealSection, composeCaseDocument, composeForJudging, evidenceCounts, evidenceGroups } from "../lib/cases/compose";
import type { AppealRow, CaseBundle, CaseRow, EvidenceRow, SideRow } from "../lib/cases/db";
import { claimMatches, inviteHash, inviteToken, inviteUrl, isInviteToken, publicOrigin, respondentClaim } from "../lib/cases/invite";
import { normalizeCaseResult } from "../lib/cases/judging";
import { effectiveStatus } from "../lib/cases/sweep";
import { buildCaseView, excerptOf, structuralAppealBlock } from "../lib/cases/view";
import type { VerdictResult } from "../lib/types";

const NOW = new Date("2026-10-20T12:00:00.000Z");

const RESULT: VerdictResult = {
  verdict: "side_a",
  dispute_type: "factual",
  headline: "h",
  crux: "c",
  split_points: null,
  conditional: null,
  argument_map: { side_a: [{ claim: "a", kind: "fact" }], side_b: [{ claim: "b", kind: "fact" }], bedrock_a: "a", bedrock_b: "b" },
  facts_relied_on: [],
  losing_side_best_point: "p",
  confidence: 4,
  runs: ["side_a"],
  demo: false,
};

function row(over: Partial<CaseRow> = {}): CaseRow {
  return {
    id: "case00000001",
    ownerId: "owner",
    status: "awaiting_respondent",
    mode: null,
    framework: { preset: "balanced" },
    lang: "en",
    inviteNonce: "n",
    inviteHash: "h",
    idempotencyKey: null,
    reservationId: "r1",
    judgingToken: null,
    judgingStartedAt: null,
    respondentIdem: null,
    respondentUserId: null,
    respondentClaimNonce: null,
    attempts: 0,
    lastError: null,
    ownerNotified: false,
    expiresAt: "2026-10-27T12:00:00.000Z",
    judgedAt: null,
    createdAt: "2026-10-20T11:00:00.000Z",
    updatedAt: "2026-10-20T11:00:00.000Z",
    namesVisible: true,
    displayASealed: null,
    displayBSealed: null,
    removedAt: null,
    removedAAt: null,
    removedBAt: null,
    ...over,
  };
}

const SIDES: SideRow[] = [
  { party: "a", text: "Party A's account", submittedAt: "t1" },
  { party: "b", text: "Party B's account", submittedAt: "t2" },
];
const EVIDENCE: EvidenceRow[] = [
  { id: "e2", party: "a", appealId: null, seq: 2, kind: "chat", transcript: "A two" },
  { id: "e1", party: "a", appealId: null, seq: 1, kind: "chat", transcript: "A one" },
  { id: "e3", party: "b", appealId: null, seq: 1, kind: "document", transcript: "B one" },
  { id: "e4", party: "a", appealId: "ap1", seq: 1, kind: "photo", transcript: "A appeal" },
];

function appeal(over: Partial<AppealRow> = {}): AppealRow {
  return {
    id: "ap1",
    party: "a",
    userId: "owner",
    text: "New context",
    status: "judged",
    error: null,
    reservationId: "r2",
    attemptToken: "t",
    baseSeq: 1,
    resultSeq: 2,
    outcome: "upheld",
    createdAt: "t3",
    updatedAt: "t3",
    ...over,
  };
}

function bundle(over: Partial<CaseBundle> = {}): CaseBundle {
  return { row: row(), sides: [SIDES[0]], evidence: [], appeals: [], verdicts: [], people: [], ...over };
}

const judged = (mode: "two_sided" | "one_sided", over: Partial<CaseBundle> = {}) =>
  bundle({
    row: row({ status: "judged", mode, judgedAt: "t4" }),
    sides: mode === "two_sided" ? SIDES : [SIDES[0]],
    evidence: EVIDENCE,
    verdicts: [{ seq: 1, verdictId: "v1", appealId: null, mode, createdAt: "t4", result: RESULT }],
    ...over,
  });

const ctx = (role: "owner" | "respondent", over = {}) => ({
  role,
  now: NOW,
  inviteUrl: "http://x/r/tok",
  ownInvite: false,
  appealBlock: null,
  ...over,
});

describe("compose", () => {
  it("labels both accounts, and a one-sided document is side A exactly", () => {
    expect(composeCaseDocument("A text", "B text")).toBe(
      "PARTY A'S ACCOUNT (written by Party A, without seeing Party B's):\nA text\n\nPARTY B'S ACCOUNT (written by Party B, without seeing Party A's):\nB text",
    );
    expect(composeCaseDocument("A text", null)).toBe("A text");
  });

  it("appends earlier appeals oldest first, then the new context", () => {
    const doc = composeForJudging(SIDES, "two_sided", {
      earlier: [appeal()],
      current: appeal({ id: "ap2", party: "b", text: "B context", status: "judging" }),
    });
    expect(doc.indexOf("CONTEXT ADDED EARLIER BY PARTY A")).toBeGreaterThan(doc.indexOf("PARTY B'S ACCOUNT"));
    expect(doc.endsWith(
      "NEW CONTEXT FROM PARTY B (added after an earlier verdict; Party B had seen that verdict and Party A's account; Party A has not answered it):\nB context",
    )).toBe(true);
    expect(appealSection("a", "x", "one_sided", true)).toBe(
      "NEW CONTEXT FROM PARTY A (added after an earlier verdict, which Party A had seen):\nx",
    );
  });

  it("groups evidence per side in seq order, appeal evidence apart, and counts it", () => {
    const groups = evidenceGroups(EVIDENCE, "two_sided", { earlier: [], current: appeal({ status: "judging" }) });
    expect(groups.map((g) => [g.party, g.idPrefix, g.items.map((i) => i.transcript)])).toEqual([
      ["a", "A", ["A one", "A two"]],
      ["b", "B", ["B one"]],
      ["a", "A-new", ["A appeal"]],
    ]);
    const one = evidenceGroups(EVIDENCE, "one_sided", { earlier: [], current: null });
    expect(one).toEqual([{ party: null, idPrefix: "E", items: [{ kind: "chat", transcript: "A one" }, { kind: "chat", transcript: "A two" }] }]);
    expect(evidenceCounts(EVIDENCE, new Set())).toEqual({ a: 2, b: 1 });
    expect(evidenceCounts(EVIDENCE, new Set(["ap1"]))).toEqual({ a: 3, b: 1 });
  });
});

describe("normalizeCaseResult", () => {
  it("caps and cleans the two-sided fields, with at most one decisive fact", () => {
    const long = "x".repeat(400);
    const out = normalizeCaseResult(
      {
        ...RESULT,
        agreed_facts: ["1", "2", "3", "4", "5", "6", " "],
        disputed_facts: Array.from({ length: 6 }, (_, i) => ({
          fact: i === 0 ? long : `f${i}`,
          party_a: "a",
          party_b: "b",
          finding: "unsettled" as const,
          decisive: true,
        })),
        would_change: ["w1", "w2", "w3", "w4"],
      },
      { twoSided: true, evidenceUsed: { a: 1, b: 0 } },
    );
    expect(out.two_sided).toBe(true);
    expect(out.agreed_facts).toEqual(["1", "2", "3", "4", "5"]);
    expect(out.disputed_facts).toHaveLength(4);
    expect(out.disputed_facts!.filter((d) => d.decisive)).toHaveLength(1);
    expect(out.disputed_facts![0].fact.length).toBeLessThanOrEqual(300);
    expect(out.would_change).toEqual(["w1", "w2", "w3"]);
    expect(out.evidence_used).toEqual({ a: 1, b: 0 });
  });

  it("fills missing arrays on two-sided, and strips them on one-sided", () => {
    const two = normalizeCaseResult(RESULT, { twoSided: true, evidenceUsed: { a: 0, b: 0 } });
    expect([two.agreed_facts, two.disputed_facts, two.would_change]).toEqual([[], [], []]);
    expect(two.evidence_used).toEqual({ a: 0, b: 0 });
    const one = normalizeCaseResult({ ...RESULT, agreed_facts: ["x"], two_sided: true }, { twoSided: false, evidenceUsed: { a: 0, b: 0 } });
    expect(one).not.toHaveProperty("agreed_facts");
    expect(one).not.toHaveProperty("two_sided");
    expect(one).not.toHaveProperty("evidence_used");
    expect(normalizeCaseResult(RESULT, { twoSided: false, evidenceUsed: { a: 2, b: 0 } }).evidence_used).toEqual({ a: 2, b: 0 });
  });

  it("unsettles the decisive dispute when the crux trial overturned the ruling", () => {
    const disputed = [
      { fact: "Swap", party_a: "No swap", party_b: "Swap", finding: "b" as const, decisive: true },
      { fact: "Other", party_a: "x", party_b: "y", finding: "a" as const, decisive: false },
    ];
    const trial = (outcome: "overturned" | "uncertain" | "survived") => ({
      outcome,
      attack: "The memo is Party B's own text.",
      reasoning: "r",
    });
    const over = normalizeCaseResult(
      { ...RESULT, disputed_facts: disputed, crux_trial: trial("overturned") },
      { twoSided: true, evidenceUsed: { a: 0, b: 0 } },
    );
    expect(over.disputed_facts!.map((d) => d.finding)).toEqual(["unsettled", "a"]);
    expect(over.disputed_facts![0].decisive).toBe(true);
    for (const outcome of ["uncertain", "survived"] as const) {
      const kept = normalizeCaseResult(
        { ...RESULT, disputed_facts: disputed, crux_trial: trial(outcome) },
        { twoSided: true, evidenceUsed: { a: 0, b: 0 } },
      );
      expect(kept.disputed_facts!.map((d) => d.finding)).toEqual(["b", "a"]);
    }
  });
});

describe("CaseView visibility", () => {
  it("awaiting: the owner sees side A and the link; the respondent sees nothing", () => {
    const b = bundle();
    const owner = buildCaseView(b, ctx("owner"));
    expect(owner.sides.map((s) => s.party)).toEqual(["a"]);
    expect(owner.inviteUrl).toBe("http://x/r/tok");
    expect(owner.canJudgeNow).toBe(true);
    expect(owner.pollAfterMs).toBeNull();
    const resp = buildCaseView(b, ctx("respondent", { ownInvite: true }));
    expect(resp.sides).toEqual([]);
    expect(resp.inviteUrl).toBeNull();
    expect(resp.ownInvite).toBe(true);
    expect(resp.canJudgeNow).toBe(false);
  });

  it("judging after the answer: still no other side for anyone", () => {
    const b = bundle({ row: row({ status: "judging", mode: "two_sided" }), sides: SIDES });
    expect(buildCaseView(b, ctx("owner")).sides.map((s) => s.party)).toEqual(["a"]);
    expect(buildCaseView(b, ctx("respondent")).sides).toEqual([]);
    expect(buildCaseView(b, ctx("owner")).pollAfterMs).toBe(3000);
    expect(buildCaseView(b, ctx("owner")).inviteUrl).toBeNull();
  });

  it("two-sided verdict: both see both accounts with their evidence, and the verdicts", () => {
    const b = judged("two_sided");
    for (const role of ["owner", "respondent"] as const) {
      const view = buildCaseView(b, ctx(role));
      expect(view.sides.map((s) => [s.party, s.evidence.map((e) => e.id)])).toEqual([
        ["a", ["e1", "e2"]],
        ["b", ["e3"]],
      ]);
      expect(view.verdicts.map((v) => v.id)).toEqual(["v1"]);
    }
  });

  it("one-sided verdict: the respondent sees no verdict, text or appeals", () => {
    const b = judged("one_sided", { appeals: [appeal()] });
    const resp = buildCaseView(b, ctx("respondent"));
    expect(resp.verdicts).toEqual([]);
    expect(resp.sides).toEqual([]);
    expect(resp.appeals).toEqual([]);
    expect(buildCaseView(b, ctx("owner")).appeals).toHaveLength(1);
  });

  it("an unanswered case past expiry reads as expired", () => {
    const b = bundle({ row: row({ expiresAt: "2026-10-20T11:59:59.000Z" }) });
    expect(effectiveStatus(b.row, NOW)).toBe("expired");
    const view = buildCaseView(b, ctx("owner"));
    expect(view.status).toBe("expired");
    expect(view.inviteUrl).toBeNull();
    expect(view.canJudgeNow).toBe(true);
  });
});

describe("structuralAppealBlock", () => {
  it("covers each reason", () => {
    expect(structuralAppealBlock(bundle(), "a", "owner", NOW)).toBe("not_judged");
    const two = judged("two_sided");
    expect(structuralAppealBlock(two, "a", "owner", NOW)).toBeNull();
    expect(structuralAppealBlock(two, "a", null, NOW)).toBe("signin_required");
    expect(structuralAppealBlock(two, "a", "someone", NOW)).toBe("not_party");
    // Unbound side B: only whoever holds the claim secret is Party B.
    expect(structuralAppealBlock(two, "b", null, NOW)).toBe("not_party");
    expect(structuralAppealBlock(two, "b", "resp", NOW)).toBe("not_party");
    expect(structuralAppealBlock(two, "b", null, NOW, true)).toBe("signin_required");
    expect(structuralAppealBlock(two, "b", "owner", NOW, true)).toBe("not_party");
    expect(structuralAppealBlock(two, "b", "resp", NOW, true)).toBeNull();
    // Bound side B: that account only, claim or not.
    const bound = judged("two_sided", { row: row({ status: "judged", mode: "two_sided", respondentUserId: "resp" }) });
    expect(structuralAppealBlock(bound, "b", "resp", NOW)).toBeNull();
    expect(structuralAppealBlock(bound, "b", null, NOW)).toBe("signin_required");
    expect(structuralAppealBlock(bound, "b", "other", NOW)).toBe("not_party");
    expect(structuralAppealBlock(bound, "b", "other", NOW, true)).toBe("not_party");
    expect(structuralAppealBlock(judged("one_sided"), "b", "resp", NOW)).toBe("not_party");
    expect(structuralAppealBlock(judged("two_sided", { appeals: [appeal({ status: "judging", party: "b" })] }), "a", "owner", NOW)).toBe("busy");
    expect(structuralAppealBlock(judged("two_sided", { appeals: [appeal()] }), "a", "owner", NOW)).toBe("appeal_used");
    expect(structuralAppealBlock(judged("two_sided", { appeals: [appeal({ status: "failed" })] }), "a", "owner", NOW)).toBeNull();
  });
});

describe("respondent claim secrets", () => {
  it("are derived per case and nonce, checked in constant time, and need the stored nonce", () => {
    const claim = respondentClaim("case00000001", "nonce-1")!;
    expect(isInviteToken(claim)).toBe(true);
    expect(claim).not.toBe(inviteToken("case00000001", "nonce-1"));
    expect(claimMatches({ id: "case00000001", respondentClaimNonce: "nonce-1" }, claim)).toBe(true);
    expect(claimMatches({ id: "case00000001", respondentClaimNonce: "nonce-2" }, claim)).toBe(false);
    expect(claimMatches({ id: "case00000002", respondentClaimNonce: "nonce-1" }, claim)).toBe(false);
    expect(claimMatches({ id: "case00000001", respondentClaimNonce: null }, claim)).toBe(false);
    expect(claimMatches({ id: "case00000001", respondentClaimNonce: "nonce-1" }, null)).toBe(false);
    expect(claimMatches({ id: "case00000001", respondentClaimNonce: "nonce-1" }, "x".repeat(22))).toBe(false);
  });
});

describe("list excerpts", () => {
  it("cut the owner's anonymized side at a word boundary", () => {
    expect(excerptOf(null)).toBeNull();
    expect(excerptOf("   ")).toBeNull();
    expect(excerptOf("Party A  paid\nthe bill.")).toBe("Party A paid the bill.");
    const long = "Party A says the bike was theirs for March and April because of the swap they agreed in February";
    const cut = excerptOf(long)!;
    expect(cut.endsWith("…")).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(81);
    expect(long.startsWith(cut.slice(0, -1))).toBe(true);
    expect(cut.slice(0, -1).endsWith(" ")).toBe(false);
  });
});

describe("invite tokens", () => {
  it("are 22 url-safe characters, deterministic per nonce, and stored only as a hash", () => {
    const t = inviteToken("case00000001", "nonce-1")!;
    expect(isInviteToken(t)).toBe(true);
    expect(inviteToken("case00000001", "nonce-1")).toBe(t);
    expect(inviteToken("case00000001", "nonce-2")).not.toBe(t);
    expect(inviteToken("case00000002", "nonce-1")).not.toBe(t);
    expect(inviteHash(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(isInviteToken("bad/token")).toBe(false);
    expect(inviteUrl("https://settle.example", t)).toBe(`https://settle.example/r/${t}`);
  });

  it("links use the configured public origin, else the request's", () => {
    const req = new Request("http://127.0.0.1:3901/api/v1/cases");
    expect(publicOrigin(req, { BETTER_AUTH_URL: "https://settle.example/x" })).toBe("https://settle.example");
    expect(publicOrigin(req, { NEXT_PUBLIC_SITE_URL: "https://site.example" })).toBe("https://site.example");
    expect(publicOrigin(req, {})).toBe("http://127.0.0.1:3901");
  });

  it("prefers the configured site URL over the auth URL", () => {
    const req = new Request("http://127.0.0.1:3901/api/v1/cases");
    expect(
      publicOrigin(req, { NEXT_PUBLIC_SITE_URL: "https://okjudge.com/", BETTER_AUTH_URL: "http://localhost:3951" }),
    ).toBe("https://okjudge.com");
  });

  it("without configuration, follows a loopback Host header, never another host", () => {
    // next dev -H 127.0.0.1 reports localhost in the URL; the browser is on 127.0.0.1.
    const dev = new Request("http://localhost:3951/api/v1/cases", { headers: { host: "127.0.0.1:3951" } });
    expect(publicOrigin(dev, {})).toBe("http://127.0.0.1:3951");
    const spoofed = new Request("https://okjudge.com/api/v1/cases", { headers: { host: "evil.example" } });
    expect(publicOrigin(spoofed, {})).toBe("https://okjudge.com");
  });
});
