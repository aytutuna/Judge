import { afterEach, describe, expect, it, vi } from "vitest";
import { caseNameKeys, normalizeName } from "../lib/evidence/names";
import {
  EVIDENCE_TOKEN_TTL_MS,
  MAX_TOKEN_LENGTH,
  signEvidenceToken,
  verifyEvidenceToken,
  verifyEvidenceTokens,
} from "../lib/evidence/token";

const USER = { type: "user", userId: "u1" } as const;
const NOW = new Date("2026-10-20T12:00:00.000Z");
const TRANSCRIPT = '[Chat screenshot · "Deniz"]\n21:02 ME: Did you pay?';

function sign(over: Partial<Parameters<typeof signEvidenceToken>[0]> = {}, now = NOW) {
  const signed = signEvidenceToken({ audience: USER, kind: "chat", transcript: TRANSCRIPT, sha: "abc123", ...over }, now);
  if (!signed) throw new Error("no key");
  return signed;
}

afterEach(() => vi.unstubAllEnvs());

describe("evidence tokens", () => {
  it("round-trips a transcript for its audience, with a 6 hour expiry", () => {
    const { token, expiresAt } = sign();
    expect(token.startsWith("v1.")).toBe(true);
    expect(expiresAt).toBe(new Date(NOW.getTime() + EVIDENCE_TOKEN_TTL_MS).toISOString());
    expect(verifyEvidenceToken(token, USER, NOW)).toEqual({ kind: "chat", transcript: TRANSCRIPT, sha: "abc123" });
  });

  it("rejects a tampered payload or signature", () => {
    const { token } = sign();
    const [v, body, sig] = token.split(".");
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    payload.transcript = "21:02 ME: I never said that";
    const forged = `${v}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${sig}`;
    expect(verifyEvidenceToken(forged, USER, NOW)).toBeNull();
    const flipped = `${v}.${body}.${sig.slice(0, -2)}${sig.endsWith("AA") ? "BB" : "AA"}`;
    expect(verifyEvidenceToken(flipped, USER, NOW)).toBeNull();
    expect(verifyEvidenceToken(`${token}.x`, USER, NOW)).toBeNull();
    expect(verifyEvidenceToken("v2." + token.slice(3), USER, NOW)).toBeNull();
  });

  it("rejects an expired token and one issued in the future", () => {
    const { token } = sign();
    expect(verifyEvidenceToken(token, USER, new Date(NOW.getTime() + EVIDENCE_TOKEN_TTL_MS))).toBeNull();
    expect(verifyEvidenceToken(token, USER, new Date(NOW.getTime() - 60 * 60 * 1000))).toBeNull();
  });

  it("rejects a token for another audience", () => {
    const { token } = sign();
    expect(verifyEvidenceToken(token, { type: "user", userId: "u2" }, NOW)).toBeNull();
    expect(verifyEvidenceToken(token, { type: "respondent", caseId: "u1" }, NOW)).toBeNull();
    const resp = sign({ audience: { type: "respondent", caseId: "c1" } }).token;
    expect(verifyEvidenceToken(resp, { type: "respondent", caseId: "c1" }, NOW)).not.toBeNull();
    expect(verifyEvidenceToken(resp, { type: "respondent", caseId: "c2" }, NOW)).toBeNull();
  });

  it("rejects an over-long token without verifying it", () => {
    expect(verifyEvidenceToken("v1." + "a".repeat(MAX_TOKEN_LENGTH), USER, NOW)).toBeNull();
  });

  it("is dead once the auth secret changes", () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "a".repeat(40));
    const { token } = sign();
    vi.stubEnv("BETTER_AUTH_SECRET", "b".repeat(40));
    expect(verifyEvidenceToken(token, USER, NOW)).toBeNull();
  });

  it("shortens a transcript that would not fit the token cap", () => {
    const huge = "界".repeat(4000);
    const { token } = sign({ transcript: huge });
    expect(token.length).toBeLessThanOrEqual(MAX_TOKEN_LENGTH);
    const back = verifyEvidenceToken(token, USER, NOW);
    expect(back?.transcript.endsWith("[... more not shown]")).toBe(true);
  });

  it("verifies a submission's tokens: count cap, any bad one fails, duplicates count once", () => {
    const one = sign().token;
    const two = sign({ sha: "def456", kind: "document", transcript: "[Document]\nOther text: 40" }).token;
    expect(verifyEvidenceTokens(undefined, USER, 3, NOW)).toEqual({ ok: true, items: [] });
    expect(verifyEvidenceTokens([one, two], USER, 3, NOW)).toEqual({
      ok: true,
      items: [
        { kind: "chat", transcript: TRANSCRIPT },
        { kind: "document", transcript: "[Document]\nOther text: 40" },
      ],
    });
    expect(verifyEvidenceTokens([one, one], USER, 3, NOW)).toMatchObject({ ok: true, items: [{ kind: "chat" }] });
    expect(verifyEvidenceTokens([one, two], USER, 1, NOW)).toEqual({ ok: false, code: "too_many_files" });
    expect(verifyEvidenceTokens([one, "v1.nope.nope"], USER, 3, NOW)).toEqual({ ok: false, code: "evidence_invalid" });
  });
});

describe("caseNameKeys", () => {
  it("keys the whole name and the first word, per case", () => {
    const keys = caseNameKeys("case1");
    const full = keys("Deniz Yılmaz");
    expect(full).toHaveLength(2);
    expect(full[1]).toBe(keys("Deniz")[0]);
    expect(full.every((k) => /^[0-9a-f]{32}$/.test(k))).toBe(true);
    expect(caseNameKeys("case2")("Deniz")[0]).not.toBe(keys("Deniz")[0]);
  });

  it("matches spelling variants: suffix, case, spaces, Unicode form", () => {
    const keys = caseNameKeys("case1");
    const base = keys("Deniz")[0];
    expect(keys("Deniz'in")[0]).toBe(base);
    expect(keys("  DENİZ ")[0]).toBe(base);
    expect(keys("Deniz  Yılmaz")).toEqual(keys("deniz yılmaz"));
    expect(keys("Zoé")).toEqual(keys("Zoé"));
    expect(normalizeName("Ayşe’nin")).toBe("ayse");
    expect(keys("Işık")).toEqual(keys("isik"));
    expect(keys("Ian")).toEqual(keys("ian"));
  });

  it("never keys the narrator, labels or one-letter names", () => {
    const keys = caseNameKeys("case1");
    for (const n of ["I", "me", "ME", "Party A", "Person C", "J", ""]) expect(keys(n)).toEqual([]);
    // "Ben" is a name in English; a Turkish narrator reaches here as "I".
    expect(keys("Ben")).toHaveLength(1);
  });
});
