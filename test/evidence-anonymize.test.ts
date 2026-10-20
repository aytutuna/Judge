import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const claudeJson = vi.hoisted(() => vi.fn());

vi.mock("@/lib/claude", () => ({
  claudeJson,
  hasApiKey: () => Boolean(process.env.ANTHROPIC_API_KEY),
  LITE_MODEL: "test-model",
}));

import { AnonymizeError, normalizeNameMap } from "../lib/anonymize";
import {
  anonymizeSubmission,
  findLeak,
  rawOriginals,
  reconcileLabels,
  relabelText,
  replaceSelfSpeaker,
  submissionSystem,
  unexplainedLabels,
} from "../lib/evidence/anonymize";
import { caseNameKeys } from "../lib/evidence/names";
import type { KnownPerson, SubmissionInput } from "../lib/evidence/types";

const keysFor = caseNameKeys("case-1");
const known = (label: string, name: string): KnownPerson => ({ label, key: keysFor(name)[0] });

const CHAT = '[Chat screenshot · "Aylin"]\n21:02 ME: Did you pay?\n21:05 Aylin: No, Sarah did';

function reply(data: unknown) {
  return { ok: true, data };
}

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  claudeJson.mockReset();
  vi.unstubAllEnvs();
});

describe("normalizeNameMap narrator option", () => {
  it("keeps the default (Party A) behavior", () => {
    expect(normalizeNameMap([{ original: "me", replacement: "Party A" }], "I think so", "Party A thinks so")).toEqual([
      { original: "I", replacement: "Party A" },
    ]);
  });

  it("maps the narrator's pronouns to Party B for a respondent", () => {
    expect(
      normalizeNameMap([{ original: "me", replacement: "Party B" }], "Ask me", "Ask Party B", { narrator: "Party B" }),
    ).toEqual([{ original: "I", replacement: "Party B" }]);
  });

  it("adds an unlisted narrator as Party B", () => {
    expect(
      normalizeNameMap(
        [{ original: "Deniz", replacement: "Party A" }],
        "I think Deniz is wrong about the bill.",
        "Party B thinks Party A is wrong about the bill.",
        { narrator: "Party B" },
      ),
    ).toEqual([
      { original: "I", replacement: "Party B" },
      { original: "Deniz", replacement: "Party A" },
    ]);
  });
});

describe("pure helpers", () => {
  it("replaces a leftover ME speaker, never inside a message", () => {
    expect(replaceSelfSpeaker("21:02 ME: hi\nME: yo\n21:05 Party A: ME: no", "Party B")).toBe(
      "21:02 Party B: hi\nParty B: yo\n21:05 Party A: ME: no",
    );
  });

  it("relabels in one pass so swaps work", () => {
    const map = new Map([
      ["Person C", "Person D"],
      ["Person D", "Person C"],
    ]);
    expect(relabelText("Person C met Person D; Person Ca stays", map)).toBe("Person D met Person C; Person Ca stays");
  });

  it("reconciles: Person label from a known key, swap when taken, party never demoted, merge into party", () => {
    const map = reconcileLabels(
      [
        { original: "Sarah", replacement: "Person D" },
        { original: "Mehmet", replacement: "Person C" },
        { original: "Deniz", replacement: "Party B" },
        { original: "Aylin Kaya", replacement: "Person E" },
      ],
      [known("Person C", "Sarah"), known("Person F", "Deniz"), known("Party A", "Aylin")],
      keysFor,
    );
    expect(Object.fromEntries(map)).toEqual({ "Person D": "Person C", "Person C": "Person D", "Person E": "Party A" });
  });

  it("finds listed and known names without naming them", () => {
    const map = [
      { original: "I", replacement: "Party A" },
      { original: "Aylin", replacement: "Party B" },
    ];
    expect(findLeak(map, ["Party A asked Party B."])).toBeNull();
    expect(findLeak(map, ["Party A asked Aylin'e."])).toBe("listed");
    const names = { keysFor, known: [known("Person C", "Sarah")] };
    expect(findLeak(map, ["Party A asked Sarah yesterday."], names)).toBe("known");
    expect(findLeak(map, ["Sarah'nın parası."], names)).toBe("known");
    // A capitalized word opening a sentence is not taken for a name.
    expect(findLeak(map, ["Fine. Sarah called."], { keysFor, known: [known("Person C", "Fine")] })).toBeNull();
  });

  it("keeps names the model mapped to themselves, minus narrator words and labels", () => {
    expect(
      rawOriginals([
        { original: "Elif", replacement: "Elif" },
        { original: "Deniz'in", replacement: "Party B" },
        { original: "I", replacement: "Party A" },
        { original: "benim", replacement: "Party A" },
        { original: "Person C", replacement: "Person C" },
      ]),
    ).toEqual(["Elif", "Deniz"]);
  });

  it("finds labels nothing explains", () => {
    const map = [{ original: "Mehmet", replacement: "Party B" }];
    expect(unexplainedLabels(["Party A and Person C met Party B"], map)).toEqual(["Person C"]);
    expect(unexplainedLabels(["Party A and Person C met Party B"], map, ["Person C"])).toEqual([]);
  });

  it("builds the prompt around the narrator, the other party and the roster", () => {
    const sys = submissionSystem({
      narrator: "Party B",
      twoSided: true,
      roster: { context: "x", labelsInUse: ["Party A", "Party B", "Person C"] },
    });
    expect(sys).toContain('The narrator is ALWAYS "Party B"');
    expect(sys).toContain('The person the narrator argues with is ALWAYS "Party A"');
    expect(sys).toContain('The speaker "ME" is the narrator: write "Party B" instead.');
    expect(sys).toContain("labels already in use: Party A, Party B, Person C");
    expect(sys).toContain('{"original": "I", "replacement": "Party B"}');
  });
});

describe("anonymizeSubmission", () => {
  const respondent: SubmissionInput = {
    narrator: "Party B",
    twoSided: true,
    text: "I told Aylin that I paid in April.",
    evidence: [{ kind: "chat", transcript: CHAT }],
    lang: "en",
  };

  it("anonymizes text and transcripts with one map, the respondent as Party B", async () => {
    claudeJson.mockResolvedValueOnce(
      reply({
        text: "Party B told Party A that Party B paid in April.",
        evidence: [{ index: 0, transcript: '[Chat screenshot · "Party A"]\n21:02 ME: Did you pay?\n21:05 Party A: No, Person C did' }],
        replacements: [
          { original: "Aylin", replacement: "Party A" },
          { original: "Sarah", replacement: "Person C" },
          { original: "I", replacement: "Party A" },
        ],
      }),
    );
    const out = await anonymizeSubmission(respondent);
    expect(out.text).toBe("Party B told Party A that Party B paid in April.");
    expect(out.evidence).toEqual([
      { kind: "chat", transcript: '[Chat screenshot · "Party A"]\n21:02 Party B: Did you pay?\n21:05 Party A: No, Person C did' },
    ]);
    expect(out.nameMap).toEqual([
      { original: "I", replacement: "Party B" },
      { original: "Aylin", replacement: "Party A" },
      { original: "Sarah", replacement: "Person C" },
    ]);
    expect(out.people).toEqual([]);
    const call = claudeJson.mock.calls[0][0];
    expect(call.user).toContain("<account>\nI told Aylin that I paid in April.\n</account>");
    expect(call.user).toContain(`<evidence index="0">\n${CHAT}\n</evidence>`);
    expect(call.effort).toBe("medium");
  });

  it("relabels from the case fingerprints and returns new fingerprints only", async () => {
    claudeJson.mockResolvedValueOnce(
      reply({
        text: "Party B says Person D and Person C lied.",
        evidence: [{ index: 0, transcript: "[Chat screenshot]\nPerson D: hi\nPerson C: yo" }],
        replacements: [
          { original: "Sarah", replacement: "Person D" },
          { original: "Mehmet", replacement: "Person C" },
          { original: "Aylin", replacement: "Party A" },
        ],
      }),
    );
    const out = await anonymizeSubmission({
      ...respondent,
      text: "I say Sarah and Mehmet lied.",
      roster: { context: "PARTY A'S ACCOUNT: ... Person C ...", labelsInUse: ["Party A", "Party B", "Person C"] },
      names: { keysFor, known: [known("Person C", "Sarah"), known("Party A", "Aylin")] },
    });
    expect(out.text).toBe("Party B says Person C and Person D lied.");
    expect(out.evidence[0].transcript).toBe("[Chat screenshot]\nPerson C: hi\nPerson D: yo");
    expect(out.nameMap).toEqual([
      { original: "I", replacement: "Party B" },
      { original: "Sarah", replacement: "Person C" },
      { original: "Mehmet", replacement: "Person D" },
      { original: "Aylin", replacement: "Party A" },
    ]);
    expect(out.people).toEqual([{ label: "Person D", key: keysFor("Mehmet")[0] }]);
    expect(claudeJson.mock.calls[0][0].user).toMatch(/^<earlier_case_material>/);
  });

  it("aligns transcripts by index and retries when one is missing", async () => {
    claudeJson.mockResolvedValueOnce(
      reply({ text: "Party A paid.", evidence: [{ index: 1, transcript: "[Photo]" }], replacements: [] }),
    );
    claudeJson.mockResolvedValueOnce(
      reply({
        text: "Party A paid.",
        evidence: [
          { index: 1, transcript: "[Photo]\nDescription: a kitchen" },
          { index: 0, transcript: "[Document]\nOther text: 40" },
        ],
        replacements: [],
      }),
    );
    const out = await anonymizeSubmission({
      narrator: "Party A",
      text: "I paid.",
      lang: "en",
      evidence: [
        { kind: "document", transcript: "[Document]\nOther text: 40" },
        { kind: "photo", transcript: "[Photo]\nDescription: a kitchen" },
      ],
    });
    expect(claudeJson).toHaveBeenCalledTimes(2);
    expect(out.evidence.map((e) => e.kind)).toEqual(["document", "photo"]);
    expect(out.evidence[0].transcript).toBe("[Document]\nOther text: 40");
    expect(out.nameMap).toEqual([{ original: "I", replacement: "Party A" }]);
  });

  it("retries once when a name survives, then fails closed", async () => {
    const leaky = reply({
      text: "Party B told Aylin.",
      evidence: [{ index: 0, transcript: "[Chat screenshot]\nParty A: no" }],
      replacements: [{ original: "Aylin", replacement: "Party A" }],
    });
    claudeJson.mockResolvedValueOnce(leaky).mockResolvedValueOnce(leaky);
    await expect(anonymizeSubmission(respondent)).rejects.toBeInstanceOf(AnonymizeError);
    expect(claudeJson).toHaveBeenCalledTimes(2);
  });

  it("fails closed when a known name from the other account survives", async () => {
    const leaky = reply({
      text: "Party B paid, as Aylin knows.",
      evidence: [{ index: 0, transcript: "[Chat screenshot]\nParty A: no" }],
      replacements: [],
    });
    claudeJson.mockResolvedValue(leaky);
    await expect(
      anonymizeSubmission({ ...respondent, names: { keysFor, known: [known("Party A", "Aylin")] } }),
    ).rejects.toThrow(/known name/);
  });

  it("retries when the model mapped a name to itself (Elif -> Elif)", async () => {
    claudeJson.mockResolvedValueOnce(
      reply({
        text: "Party B and Elif paid.",
        evidence: [{ index: 0, transcript: "[Chat screenshot]\nParty A: no" }],
        replacements: [{ original: "Elif", replacement: "Elif" }],
      }),
    );
    claudeJson.mockResolvedValueOnce(
      reply({
        text: "Party B and Person C paid.",
        evidence: [{ index: 0, transcript: "[Chat screenshot]\nParty A: no" }],
        replacements: [{ original: "Elif", replacement: "Person C" }],
      }),
    );
    const out = await anonymizeSubmission(respondent);
    expect(claudeJson).toHaveBeenCalledTimes(2);
    expect(out.text).toBe("Party B and Person C paid.");
  });

  it("retries inconsistent labels once and keeps the safe first result if the retry leaks", async () => {
    const odd = reply({
      text: "Party B and Person D paid; Person C agreed.",
      evidence: [{ index: 0, transcript: "[Chat screenshot]\nParty A: no" }],
      replacements: [{ original: "Sarah", replacement: "Person C" }],
    });
    claudeJson.mockResolvedValueOnce(odd).mockResolvedValueOnce(
      reply({
        text: "Party B and Sarah paid.",
        evidence: [{ index: 0, transcript: "[Chat screenshot]\nParty A: no" }],
        replacements: [{ original: "Sarah", replacement: "Person C" }],
      }),
    );
    const out = await anonymizeSubmission(respondent);
    expect(claudeJson).toHaveBeenCalledTimes(2);
    expect(out.text).toBe("Party B and Person D paid; Person C agreed.");

    claudeJson.mockReset();
    claudeJson.mockResolvedValue(odd);
    expect((await anonymizeSubmission(respondent)).text).toBe("Party B and Person D paid; Person C agreed.");
    expect(claudeJson).toHaveBeenCalledTimes(2);
  });

  it("does not retry a refusal or an API error, and needs a key", async () => {
    claudeJson.mockResolvedValueOnce({ ok: false, blocked: true, reason: "cyber" });
    await expect(anonymizeSubmission(respondent)).rejects.toThrow(/blocked/);
    expect(claudeJson).toHaveBeenCalledTimes(1);
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    await expect(anonymizeSubmission(respondent)).rejects.toBeInstanceOf(AnonymizeError);
  });

  it("rejects malformed output", async () => {
    claudeJson.mockResolvedValue(reply({ text: " ", evidence: [], replacements: [] }));
    await expect(anonymizeSubmission({ ...respondent, evidence: [] })).rejects.toThrow(/malformed/);
  });
});
