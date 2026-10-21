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
  labelSelfReplaced,
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
    expect(sys).toContain('That person is ALWAYS "Party A", whether the narrator names them, calls them a friend');
    expect(sys).toContain('Use "Person C" and up only for people other than the two parties.');
    expect(sys).not.toContain("Turkish drops subjects");
    const tr = submissionSystem({ narrator: "Party B", twoSided: true, text: "Bence cimrilik ediyor, ödemedi.", lang: "tr" });
    expect(tr).toContain(`"bence X" -> "Party B'ye göre X"`);
    expect(tr).toContain(`"annemizin" -> "Party B ile Party A'nın annesinin"`);
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

  it("repairs a listed name the model left in place, with suffixes, in one call", async () => {
    claudeJson.mockResolvedValueOnce(
      reply({
        text: "Party B told Aylin that Party B paid, and Aylin's sister agreed.",
        evidence: [{ index: 0, transcript: '[Chat screenshot · "Aylin"]\n21:02 ME: Did you pay?\n21:05 Aylin: No, Sarah did' }],
        replacements: [
          { original: "Aylin", replacement: "Party A" },
          { original: "Sarah", replacement: "Person C" },
        ],
      }),
    );
    const out = await anonymizeSubmission(respondent);
    expect(claudeJson).toHaveBeenCalledTimes(1);
    expect(out.text).toBe("Party B told Party A that Party B paid, and Party A's sister agreed.");
    expect(out.evidence[0].transcript).toBe(
      '[Chat screenshot · "Party A"]\n21:02 Party B: Did you pay?\n21:05 Party A: No, Person C did',
    );
  });

  it("repairs the c02 failure: a possessive name the model listed but kept", async () => {
    const c02 = "Okay, I ate Leo's soup. It had his name on it, I saw that.";
    claudeJson.mockResolvedValueOnce(
      reply({
        text: "Okay, Party B ate Leo's soup. It had his name on it, Party B saw that.",
        evidence: [],
        replacements: [
          { original: "Leo", replacement: "Party A" },
          { original: "I", replacement: "Party B" },
        ],
      }),
    );
    const out = await anonymizeSubmission({ ...respondent, text: c02, evidence: [], opponentRequired: true });
    expect(claudeJson).toHaveBeenCalledTimes(1);
    expect(out.text).toBe("Okay, Party B ate Party A's soup. It had his name on it, Party B saw that.");
  });

  it("repairs Turkish suffixes, apostrophe and glued", async () => {
    const tr = "Burak'ın parasını geri verdim. Burakla konuştum, Burak'a söyledim.";
    claudeJson.mockResolvedValueOnce(
      reply({
        text: "Party A, Burak'ın parasını geri verdi. Burakla konuştu, Burak'a söyledi.",
        evidence: [],
        replacements: [
          { original: "Ben", replacement: "Party A" },
          { original: "Burak", replacement: "Party B" },
        ],
      }),
    );
    const out = await anonymizeSubmission({ narrator: "Party A", text: tr, evidence: [], lang: "tr" });
    expect(out.text).toBe("Party A, Party B'nin parasını geri verdi. Party B'yle konuştu, Party B'ye söyledi.");
    expect(claudeJson).toHaveBeenCalledTimes(1);
  });

  it("retries once when a name survives the repair, then fails closed", async () => {
    // A surname shared by two people cannot be substituted: check-only.
    const leaky = reply({
      text: "Party B told Demir.",
      evidence: [{ index: 0, transcript: "[Chat screenshot]\nParty A: no" }],
      replacements: [
        { original: "Aylin Demir", replacement: "Party A" },
        { original: "Sarah Demir", replacement: "Person C" },
      ],
    });
    claudeJson.mockResolvedValueOnce(leaky).mockResolvedValueOnce(leaky);
    await expect(anonymizeSubmission(respondent)).rejects.toBeInstanceOf(AnonymizeError);
    expect(claudeJson).toHaveBeenCalledTimes(2);
    // The retry is told which names were found (in the prompt, never in logs).
    const second = claudeJson.mock.calls[1][0].system as string;
    expect(second).toContain("IMPORTANT: a previous attempt on this text left real names");
    expect(second).toContain("Names already found in this text: Aylin Demir");
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("Demir");
  });

  it("replaces a known name from the other account that the model left in place", async () => {
    claudeJson.mockResolvedValueOnce(
      reply({
        text: "Party B paid, as Aylin knows. Aylin'in kardeşi de biliyor.",
        evidence: [{ index: 0, transcript: "[Chat screenshot]\nParty A: no" }],
        replacements: [],
      }),
    );
    const out = await anonymizeSubmission({ ...respondent, names: { keysFor, known: [known("Party A", "Aylin")] } });
    expect(out.text).toBe("Party B paid, as Party A knows. Party A'nın kardeşi de biliyor.");
    expect(out.nameMap).toContainEqual({ original: "Aylin", replacement: "Party A" });
    expect(claudeJson).toHaveBeenCalledTimes(1);
  });

  it("gives a self-replaced name (Elif -> Elif) the next free Person label", async () => {
    claudeJson.mockResolvedValueOnce(
      reply({
        text: "Party B and Elif paid; Person C agreed.",
        evidence: [{ index: 0, transcript: "[Chat screenshot]\nElif: no" }],
        replacements: [
          { original: "Elif", replacement: "Elif" },
          { original: "Sarah", replacement: "Person C" },
        ],
      }),
    );
    const out = await anonymizeSubmission({
      ...respondent,
      roster: { context: "", labelsInUse: ["Party A", "Party B", "Person D"] },
    });
    expect(claudeJson).toHaveBeenCalledTimes(1);
    expect(out.text).toBe("Party B and Person E paid; Person C agreed.");
    expect(out.evidence[0].transcript).toBe("[Chat screenshot]\nPerson E: no");
    expect(out.nameMap).toContainEqual({ original: "Elif", replacement: "Person E" });
  });

  it("retries inconsistent labels once and keeps the safe first result if the retry leaks", async () => {
    const odd = reply({
      text: "Party B and Person D paid; Person C agreed.",
      evidence: [{ index: 0, transcript: "[Chat screenshot]\nParty A: no" }],
      replacements: [{ original: "Sarah", replacement: "Person C" }],
    });
    claudeJson.mockResolvedValueOnce(odd).mockResolvedValueOnce(
      reply({
        text: "Party B and Demir paid.",
        evidence: [{ index: 0, transcript: "[Chat screenshot]\nParty A: no" }],
        replacements: [
          { original: "Sarah Demir", replacement: "Person C" },
          { original: "Ali Demir", replacement: "Person D" },
        ],
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

describe("anonymizeSubmission: quality and flagged words", () => {
  const side: SubmissionInput = {
    narrator: "Party A",
    twoSided: true,
    opponentRequired: true,
    text: "Bence Can cimrilik ediyor, annemizin hediyesini ödemedi.",
    evidence: [],
    lang: "tr",
  };
  const reps = [
    { original: "Ben", replacement: "Party A" },
    { original: "Can", replacement: "Party B" },
  ];

  it("retries a Turkish rewrite that glued an opinion word to a label, naming the issue, and takes the cleaner retry", async () => {
    claudeJson
      .mockResolvedValueOnce(reply({ text: "Party A bence Party B cimrilik ediyor, annemizin hediyesini ödemedi.", evidence: [], replacements: reps }))
      .mockResolvedValueOnce(
        reply({
          text: "Party A'ya göre Party B cimrilik ediyor, Party A ile Party B'nin annesinin hediyesini ödemedi.",
          evidence: [],
          replacements: reps,
        }),
      );
    const out = await anonymizeSubmission(side);
    expect(claudeJson).toHaveBeenCalledTimes(2);
    expect(out.text).toBe("Party A'ya göre Party B cimrilik ediyor, Party A ile Party B'nin annesinin hediyesini ödemedi.");
    const second = claudeJson.mock.calls[1][0].system as string;
    expect(second).toContain("left first-person words outside quotation marks");
    expect(second).toContain("put an opinion word right after a label");
    expect(second).not.toContain("left real names");
    expect(vi.mocked(console.warn).mock.calls.flat().join(" ")).toContain("quality: first_person_left,self_label_misuse");
  });

  it("accepts a rewrite with quality issues when the retry is no better (never fails on quality alone)", async () => {
    const meh = reply({ text: "Party A bence Party B cimrilik ediyor.", evidence: [], replacements: reps });
    claudeJson.mockResolvedValue(meh);
    const out = await anonymizeSubmission(side);
    expect(out.text).toBe("Party A bence Party B cimrilik ediyor.");
    expect(claudeJson).toHaveBeenCalledTimes(2);
  });

  it("retries when side B never names Party A (the 'their friend Person C' failure)", async () => {
    claudeJson
      .mockResolvedValueOnce(
        reply({
          text: "Party B ate Person C's soup.",
          evidence: [],
          replacements: [
            { original: "I", replacement: "Party B" },
            { original: "Leo", replacement: "Person C" },
          ],
        }),
      )
      .mockResolvedValueOnce(
        reply({
          text: "Party B ate Party A's soup.",
          evidence: [],
          replacements: [
            { original: "I", replacement: "Party B" },
            { original: "Leo", replacement: "Party A" },
          ],
        }),
      );
    const out = await anonymizeSubmission({
      narrator: "Party B",
      twoSided: true,
      opponentRequired: true,
      text: "I ate Leo's soup.",
      evidence: [],
      lang: "en",
    });
    expect(out.text).toBe("Party B ate Party A's soup.");
    expect(out.nameMap).toContainEqual({ original: "Leo", replacement: "Party A" });
    expect(claudeJson.mock.calls[1][0].system).toContain('That person is ALWAYS "Party A"');
  });

  it("does not require the opponent in an appeal", async () => {
    claudeJson.mockResolvedValueOnce(reply({ text: "Party B paid the receipt.", evidence: [], replacements: [] }));
    await anonymizeSubmission({ narrator: "Party B", twoSided: true, text: "I paid the receipt.", evidence: [], lang: "en" });
    expect(claudeJson).toHaveBeenCalledTimes(1);
  });

  it("retries an unlisted capitalized name with the word named, and fails closed on a first-person echo", async () => {
    const text = "I lent Marta 50 euros and Marta never paid.";
    claudeJson
      .mockResolvedValueOnce(reply({ text: "Party A lent Marta 50 euros and Marta never paid.", evidence: [], replacements: [] }))
      .mockResolvedValueOnce(
        reply({
          text: "Party A lent Party B 50 euros and Party B never paid.",
          evidence: [],
          replacements: [{ original: "Marta", replacement: "Party B" }],
        }),
      );
    const out = await anonymizeSubmission({ narrator: "Party A", text, evidence: [], lang: "en" });
    expect(out.text).toBe("Party A lent Party B 50 euros and Party B never paid.");
    expect(claudeJson.mock.calls[1][0].system).toContain("Check these capitalized words from the text: Marta.");

    claudeJson.mockReset();
    claudeJson.mockResolvedValue(reply({ text, evidence: [], replacements: [] }));
    await expect(anonymizeSubmission({ narrator: "Party A", text, evidence: [], lang: "en" })).rejects.toThrow(
      /identical to the input/,
    );
    expect(claudeJson).toHaveBeenCalledTimes(2);
  });

  it("labelSelfReplaced leaves descriptions, labels and narrator words alone", () => {
    expect(
      labelSelfReplaced(
        [
          { original: "Elif", replacement: "Elif" },
          { original: "Elif'in", replacement: "" },
          { original: "my sister", replacement: "my sister" },
          { original: "I", replacement: "I" },
          { original: "Paris", replacement: "the city" },
          { original: "Mert", replacement: "Party B" },
        ],
        new Set(["Party A", "Party B", "Person C"]),
        false,
      ),
    ).toEqual([
      { original: "Elif", replacement: "Person D" },
      { original: "Elif'in", replacement: "Person D" },
      { original: "my sister", replacement: "my sister" },
      { original: "I", replacement: "I" },
      { original: "Paris", replacement: "the city" },
      { original: "Mert", replacement: "Party B" },
    ]);
  });
});

describe("anonymizeSubmission: names and words the model kept", () => {
  it("an echoed Turkish account that opens a sentence with 'Deniz artık' never passes the name on", async () => {
    const text = "Deniz ile üç yıldır birlikteyiz. Deniz'e göre ben çok kıskancım. Deniz artık eve geç geliyor.";
    claudeJson.mockResolvedValue(reply({ text, evidence: [], replacements: [{ original: "Deniz", replacement: "Party B" }] }));
    // Repaired in code: every "Deniz" becomes the label, the sentence start too.
    const out = await anonymizeSubmission({ narrator: "Party A", text, evidence: [], lang: "tr" });
    expect(out.text).not.toMatch(/Deniz/);
    expect(out.text).toContain("Party B artık eve geç geliyor.");
  });

  it("labelSelfReplaced keeps places, calendar words, brands and family words; people still get a label", () => {
    const input = "Party B and I moved to Berlin last year. On Monday Mom watched Netflix in İstanbul. Elif'in payı yok.";
    expect(
      labelSelfReplaced(
        [
          { original: "Berlin", replacement: "Berlin" },
          { original: "Monday", replacement: "Monday" },
          { original: "Mom", replacement: "Mom" },
          { original: "Netflix", replacement: "Netflix" },
          { original: "İstanbul", replacement: "İstanbul" },
          { original: "Elif", replacement: "Elif" },
        ],
        new Set(["Party A", "Party B"]),
        false,
        input,
      ),
    ).toEqual([
      { original: "Berlin", replacement: "Berlin" },
      { original: "Monday", replacement: "Monday" },
      { original: "Mom", replacement: "Mom" },
      { original: "Netflix", replacement: "Netflix" },
      { original: "İstanbul", replacement: "İstanbul" },
      { original: "Elif", replacement: "Person C" },
    ]);
    // A Turkish locative is a place too; a possessive may be a person.
    expect(labelSelfReplaced([{ original: "Ankara", replacement: "Ankara" }], new Set(), true, "Ankara'da oturuyoruz.")).toEqual([
      { original: "Ankara", replacement: "Ankara" },
    ]);
    expect(labelSelfReplaced([{ original: "Berlin", replacement: "Berlin" }], new Set(), false, "Berlin's idea was bad.")).toEqual([
      { original: "Berlin", replacement: "Person C" },
    ]);
  });

  it("a self-listed place is kept as written, not turned into a person and not a leak", async () => {
    const text = "My partner Sam and I moved to Berlin last year and now Sam wants to move back.";
    claudeJson.mockResolvedValue(
      reply({
        text: "Party B and Party A moved to Berlin last year and now Party B wants to move back.",
        evidence: [],
        replacements: [
          { original: "I", replacement: "Party A" },
          { original: "Sam", replacement: "Party B" },
          { original: "Berlin", replacement: "Berlin" },
        ],
      }),
    );
    const out = await anonymizeSubmission({ narrator: "Party A", text, evidence: [], lang: "en" });
    expect(out.text).toBe("Party B and Party A moved to Berlin last year and now Party B wants to move back.");
    expect(out.nameMap.some((m) => m.replacement === "Person C")).toBe(false);
  });
});
