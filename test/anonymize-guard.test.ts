import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const claudeJson = vi.hoisted(() => vi.fn());

vi.mock("../lib/claude", () => ({
  claudeJson,
  hasApiKey: () => Boolean(process.env.ANTHROPIC_API_KEY),
  LITE_MODEL: "test-model",
}));

import {
  anonymize,
  AnonymizeError,
  findNameLeak,
  heldCandidates,
  nameRules,
  substituteNames,
  unlistedCandidates,
  type AnonymizeTrace,
} from "../lib/anonymize";

type Rep = { original: string; replacement: string };
const reply = (text: string, replacements: Rep[]) => ({ ok: true, data: { text, replacements } });
const newTrace = (): AnonymizeTrace => ({ attempts: 0, repaired: 0, reasons: [] });

const LOAN =
  "In March I lent my friend Burak 500 euros to cover his car repair. He said he'd pay me back by the end of June. When I reminded him, Burak said I should be patient.";
const LOAN_REPS: Rep[] = [
  { original: "I", replacement: "Party A" },
  { original: "Burak", replacement: "Party B" },
];
const CREDIT =
  "My coworker Daniel and I built a client presentation together. On the day of the meeting he presented it all by himself.";
const CREDIT_CLEAN =
  "Party A's coworker Party B and Party A built a client presentation together. On the day of the meeting Party B presented it all by himself.";

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  claudeJson.mockReset();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** Substitution on its own, with the rules the model's list yields. */
const sub = (text: string, reps: Rep[], turkish = false) => substituteNames(text, nameRules(reps, turkish), turkish);
const leaks = (text: string, reps: Rep[], turkish = false) => findNameLeak(text, nameRules(reps, turkish), turkish);

describe("anonymize: code-side repair", () => {
  it("repairs an un-rewritten echo by substituting the listed names, in one call", async () => {
    claudeJson.mockResolvedValueOnce(reply(LOAN, LOAN_REPS));
    const trace = newTrace();
    const res = await anonymize(LOAN, trace);
    expect(res.text).not.toMatch(/Burak/);
    expect(res.text).toBe(LOAN.replaceAll("Burak", "Party B"));
    expect(res.nameMap).toEqual([
      { original: "I", replacement: "Party A" },
      { original: "Burak", replacement: "Party B" },
    ]);
    expect(claudeJson).toHaveBeenCalledTimes(1);
    expect(trace).toEqual({ attempts: 1, repaired: 1, reasons: [] });
  });

  it("repairs a listed name the model left in place, keeping the possessive", async () => {
    claudeJson.mockResolvedValueOnce(
      reply("In March Party A lent Party A's friend Burak 500 euros. Burak's car needed a repair.", LOAN_REPS),
    );
    const res = await anonymize(LOAN);
    expect(res.text).toBe("In March Party A lent Party A's friend Party B 500 euros. Party B's car needed a repair.");
    expect(claudeJson).toHaveBeenCalledTimes(1);
  });

  it("leaves a clean rewrite untouched", async () => {
    const clean = "In March Party A lent Party A's friend Party B 500 euros.";
    claudeJson.mockResolvedValueOnce(reply(clean, LOAN_REPS));
    const trace = newTrace();
    expect((await anonymize(LOAN, trace)).text).toBe(clean);
    expect(trace).toEqual({ attempts: 1, repaired: 0, reasons: [] });
  });
});

describe("anonymize: retry and fail closed", () => {
  const TR = "Burak'a 500 lira borç verdim. Buraklar hâlâ ödemedi, ben de bekliyorum.";
  const TR_REPS: Rep[] = [
    { original: "Ben", replacement: "Party A" },
    { original: "Burak", replacement: "Party B" },
  ];

  it("retries at medium effort with a firmer instruction when a repair is impossible, then succeeds", async () => {
    // "Buraklar" (plural) is not a case suffix code can rewrite safely.
    claudeJson
      .mockResolvedValueOnce(reply("Party B'ye 500 lira borç verdim. Buraklar hâlâ ödemedi.", TR_REPS))
      .mockResolvedValueOnce(reply("Party A, Party B'ye 500 lira borç verdi. Party B hâlâ ödemedi.", TR_REPS));
    const trace = newTrace();
    const res = await anonymize(TR, trace);
    expect(res.text).toBe("Party A, Party B'ye 500 lira borç verdi. Party B hâlâ ödemedi.");
    expect(res.nameMap[0]).toEqual({ original: "I", replacement: "Party A" });
    expect(claudeJson).toHaveBeenCalledTimes(2);
    expect(claudeJson.mock.calls[0][0].effort).toBe("low");
    const second = claudeJson.mock.calls[1][0];
    expect(second.effort).toBe("medium");
    expect(second.system).toContain("IMPORTANT: a previous attempt");
    expect(second.system).toContain("Names already found in this text: Burak.");
    expect(trace.reasons).toEqual(["a listed name survived anonymization"]);
  });

  it("throws AnonymizeError when the retry still leaks (fail closed)", async () => {
    claudeJson.mockResolvedValue(reply("Party B'ye borç verdim. Buraklar hâlâ ödemedi.", TR_REPS));
    const trace = newTrace();
    await expect(anonymize(TR, trace)).rejects.toBeInstanceOf(AnonymizeError);
    expect(claudeJson).toHaveBeenCalledTimes(2);
    expect(trace.reasons).toEqual(["a listed name survived anonymization", "a listed name survived anonymization"]);
  });

  it("rejects an output identical to the input while names were listed", async () => {
    // The listed name is not in the text at all, so nothing was substituted.
    const arg = "My friend borrowed 500 euros and won't pay it back. I think he should.";
    claudeJson.mockResolvedValue(reply(arg, [{ original: "Burak", replacement: "Party B" }]));
    await expect(anonymize(arg)).rejects.toThrow("output identical to the input");
    expect(claudeJson).toHaveBeenCalledTimes(2);
  });

  it("checks the retry against the names the first attempt listed", async () => {
    claudeJson
      .mockResolvedValueOnce(reply("Party B'ye borç verdim. Buraklar ödemedi.", TR_REPS))
      // The retry forgets Burak in its list and leaves him in place.
      .mockResolvedValueOnce(reply("Party A borç verdi. Buraklar ödemedi.", [{ original: "Ben", replacement: "Party A" }]));
    await expect(anonymize(TR)).rejects.toBeInstanceOf(AnonymizeError);
  });

  it("retries an echo with an empty list, pointing at the capitalized words", async () => {
    claudeJson
      .mockResolvedValueOnce(reply(CREDIT, []))
      .mockResolvedValueOnce(reply(CREDIT_CLEAN, [{ original: "Daniel", replacement: "Party B" }]));
    const trace = newTrace();
    const res = await anonymize(CREDIT, trace);
    expect(res.text).toBe(CREDIT_CLEAN);
    expect(res.nameMap).toEqual([
      { original: "I", replacement: "Party A" },
      { original: "Daniel", replacement: "Party B" },
    ]);
    expect(claudeJson.mock.calls[1][0].system).toContain("Check these capitalized words from the text: Daniel.");
    expect(trace.reasons).toEqual(["unlisted capitalized words survived"]);
  });

  it("fails closed when the retry echoes again with possible names in it", async () => {
    claudeJson.mockResolvedValue(reply(CREDIT, []));
    await expect(anonymize(CREDIT)).rejects.toThrow("output identical to the input with possible names");
    expect(claudeJson).toHaveBeenCalledTimes(2);
  });

  it("accepts the retry when unlisted words are only a place the model kept", async () => {
    const arg = "My friend says Paris is overrated and I disagree.";
    const out = "Party B says Paris is overrated and Party A disagrees.";
    claudeJson.mockResolvedValue(reply(out, [{ original: "I", replacement: "Party A" }]));
    expect((await anonymize(arg)).text).toBe(out);
    expect(claudeJson).toHaveBeenCalledTimes(2);
  });

  it("keeps a merely suspicious first attempt when the retry leaks a name the first text does not hold", async () => {
    const arg = "My friend says Paris is overrated and I disagree.";
    const first = "Party B says Paris is overrated and Party A disagrees.";
    claudeJson
      .mockResolvedValueOnce(reply(first, [{ original: "I", replacement: "Party A" }]))
      // Two Smiths: the shared surname cannot be substituted, only checked.
      .mockResolvedValueOnce(
        reply("Smith says Paris is overrated and I disagree.", [
          { original: "Anna Smith", replacement: "Party B" },
          { original: "John Smith", replacement: "Person C" },
        ]),
      );
    expect((await anonymize(arg)).text).toBe(first);
  });

  it("does not retry an untouched text without a narrator or capitalized words", async () => {
    const arg = "is a hot dog a sandwich? one side says yes, the other says no.";
    claudeJson.mockResolvedValueOnce(reply(arg, []));
    expect((await anonymize(arg)).text).toBe(arg);
    expect(claudeJson).toHaveBeenCalledTimes(1);
  });

  it("retries malformed output, and never retries an API error", async () => {
    claudeJson
      .mockResolvedValueOnce({ ok: true, data: { text: "", replacements: [] } })
      .mockResolvedValueOnce(reply(LOAN.replaceAll("Burak", "Party B"), LOAN_REPS));
    expect((await anonymize(LOAN)).text).not.toContain("Burak");
    expect(claudeJson).toHaveBeenCalledTimes(2);

    claudeJson.mockReset();
    claudeJson.mockResolvedValue({ ok: false, blocked: false, error: "Claude HTTP 529" });
    await expect(anonymize(LOAN)).rejects.toThrow("Claude HTTP 529");
    expect(claudeJson).toHaveBeenCalledTimes(1);
  });

  it("an API error on the retry fails closed even after a suspicious first attempt", async () => {
    claudeJson
      .mockResolvedValueOnce(reply(CREDIT, []))
      .mockResolvedValueOnce({ ok: false, blocked: false, error: "Claude request timed out after 50s" });
    await expect(anonymize(CREDIT)).rejects.toBeInstanceOf(AnonymizeError);
  });
});

describe("substituteNames: suffixes", () => {
  it("keeps English possessives and contractions", () => {
    const reps = [{ original: "Ryan", replacement: "Party B" }];
    expect(sub("Ryan's car and Ryan’s keys. RYAN said so; Ryan'll see.", reps)).toBe(
      "Party B's car and Party B’s keys. Party B said so; Party B'll see.",
    );
  });

  it("re-harmonizes Turkish case suffixes after an apostrophe for the label", () => {
    const reps = [
      { original: "Burak", replacement: "Party B" },
      { original: "Mehmet", replacement: "Party A" },
      { original: "Selin", replacement: "Person C" },
    ];
    expect(sub("Burak'ın arabası, Burak’a söyledim, Mehmet'le konuştum, Selin'den duydum.", reps, true)).toBe(
      "Party B'nin arabası, Party B’ye söyledim, Party A'yla konuştum, Person C'den duydum.",
    );
  });

  it("keeps a suffix it cannot classify", () => {
    expect(sub("Burak'lar geldi.", [{ original: "Burak", replacement: "Party B" }], true)).toBe("Party B'lar geldi.");
  });

  it("rewrites a glued case suffix only in Turkish text and only when it agrees by vowel harmony", () => {
    const reps = [{ original: "Burak", replacement: "Party B" }];
    expect(sub("Dün Burakla konuştum, Buraka para verdim, Burakın arabası bozuldu.", reps, true)).toBe(
      "Dün Party B'yle konuştum, Party B'ye para verdim, Party B'nin arabası bozuldu.",
    );
    // "Burakin" breaks vowel harmony: left for the leak check (and a retry).
    expect(sub("Burakin arabası", reps, true)).toBe("Burakin arabası");
    expect(leaks("Burakin arabası", reps, true)).toBe(true);
    // English text: no Turkish suffix handling.
    expect(sub("Buraka", reps, false)).toBe("Buraka");
  });

  it("never cuts a different listed name or a name proven by its own suffix", () => {
    const reps = [
      { original: "Dan", replacement: "Party B" },
      { original: "Dana", replacement: "Person C" },
    ];
    expect(sub("Dana ile Dan geldi, Dana'ya sordum.", reps, true)).toBe("Person C ile Party B geldi, Person C'ye sordum.");
    // Dana unlisted, but "Dana'ya" shows she is a person in her own right.
    expect(sub("Dana geldi, Dana'ya sordum, Dan da geldi.", [reps[0]], true)).toBe(
      "Dana geldi, Dana'ya sordum, Party B da geldi.",
    );
  });

  it("substitutes every word of a full name, and generalized places without checking them", () => {
    const reps = [
      { original: "Burak Yılmaz", replacement: "Party B" },
      { original: "Ali Bey", replacement: "Person C" },
      { original: "Acme Ltd", replacement: "the company" },
    ];
    expect(sub("Burak Yılmaz works at Acme Ltd. Yılmaz says Burak is right; Ali Bey agrees with Ali.", reps)).toBe(
      "Party B works at the company. Party B says Party B is right; Person C agrees with Person C.",
    );
  });

  it("never treats a description as a name", () => {
    const reps = [
      { original: "my sister", replacement: "Party B" },
      { original: "My boss", replacement: "Person C" },
      { original: "roommate", replacement: "Party B" },
    ];
    const text = "Party A's sister is my sister. My boss and the roommate agree.";
    expect(sub(text, reps)).toBe(text);
    expect(leaks(text, reps)).toBe(false);
  });

  it("matches all-caps spellings of a name that is not an everyday word, lowercase only as typed", () => {
    const reps = [{ original: "İrem", replacement: "Party B" }];
    // The argument capitalizes İrem, so a lowercase "irem" is not her.
    const arg = "İREM geldi, irem de haklı, Irem'e söyle.";
    expect(substituteNames(arg, nameRules(reps, true, arg), true)).toBe("Party B geldi, irem de haklı, Party B'ye söyle.");
    // A user who types names in lowercase: listed capitalized or lowercase.
    const low = "burak bana borç verdi, burak'a kızdım. BURAK da biliyor.";
    const out = "Party B bana borç verdi, Party B'ye kızdım. Party B da biliyor.";
    const burak = [{ original: "Burak", replacement: "Party B" }];
    expect(substituteNames(low, nameRules(burak, true, low), true)).toBe(out);
    expect(sub(low, [{ original: "burak", replacement: "Party B" }], true)).toBe(out);
    expect(findNameLeak(low, nameRules(burak, true, low), true)).toBe(true);
  });
});

describe("substitution leaves ordinary words alone", () => {
  it("never rewrites a lowercase word that shares a capitalized name", () => {
    expect(sub("Sarah Brown and I share a brown couch.", [{ original: "Sarah Brown", replacement: "Party B" }])).toBe(
      "Party B and I share a brown couch.",
    );
    expect(sub("Grant refused to grant me access.", [{ original: "Grant", replacement: "Party B" }])).toBe(
      "Party B refused to grant me access.",
    );
    expect(sub("GRANT and Grant's wife.", [{ original: "Grant", replacement: "Party B" }])).toBe("Party B and Party B's wife.");
  });

  it("treats each word of a full name like an everyday-word name", () => {
    const jake = [{ original: "Jake Long", replacement: "Party B" }];
    const text = "Jake Long owes me money. Long story short, it took a long time. Then Long paid. LONG wait.";
    expect(sub(text, jake)).toBe(
      "Party B owes me money. Long story short, it took a long time. Then Party B paid. LONG wait.",
    );
    // A surname opening a sentence is still the person when the text never uses the word otherwise.
    expect(sub("Burak Yılmaz borrowed money. Yılmaz says he paid.", [{ original: "Burak Yılmaz", replacement: "Party B" }])).toBe(
      "Party B borrowed money. Party B says he paid.",
    );
  });

  it("matches a generalized place or company only as spelled", () => {
    const reps = [
      { original: "Apple", replacement: "the company" },
      { original: "Tom", replacement: "Party B" },
    ];
    expect(sub("Tom ate my apple at Apple. APPLE pays well.", reps)).toBe(
      "Party B ate my apple at the company. APPLE pays well.",
    );
  });

  it("keeps Turkish words that are also names", () => {
    const reps = [
      { original: "Ayşe Kara", replacement: "Party B" },
      { original: "Dilek", replacement: "Person C" },
      { original: "Yeter", replacement: "Person D" },
    ];
    const text =
      "Ayşe Kara kara listeye alındı, bir dilek tuttum, yeter artık. Yeter artık! Dilek bana kızdı, Yeter'e söyledim.";
    const fixed = sub(text, reps, true);
    expect(fixed).toBe(
      "Party B kara listeye alındı, bir dilek tuttum, yeter artık. Yeter artık! Person C bana kızdı, Person D'ye söyledim.",
    );
    expect(leaks(fixed, reps, true)).toBe(false);
  });

  it("a shared surname is check-only and its lowercase word is not a leak", () => {
    const reps = [
      { original: "Ayşe Yılmaz", replacement: "Party B" },
      { original: "Burak Yılmaz", replacement: "Person C" },
    ];
    expect(leaks("Party B bana yılmaz bir azimle yardım etti, Person C de.", reps, true)).toBe(false);
    expect(leaks("Party B ile Yılmaz geldi.", reps, true)).toBe(true);
  });

  it("a lowercase everyday-word name with a Turkish case suffix is the name", () => {
    const deniz = [{ original: "Deniz", replacement: "Party B" }];
    expect(sub("deniz bana bağırdı, deniz'e kızdım, deniz kenarı güzel.", deniz, true)).toBe(
      "deniz bana bağırdı, Party B'ye kızdım, deniz kenarı güzel.",
    );
    expect(leaks("Party A, deniz'e kızdı.", deniz, true)).toBe(true);
    const can = [{ original: "Can", replacement: "Party B" }];
    expect(sub("can sıkıcı bir gündü, can'a söyledim. I can't.", can, true)).toBe(
      "can sıkıcı bir gündü, Party B'ye söyledim. I can't.",
    );
  });
});

describe("names at the start of sentences", () => {
  const THIRD = "Daniel thinks the rent should be split evenly. Ryan says his room is smaller. Ryan wants to pay less.";

  it("counts sentence-initial names in an echo, not ordinary openers", () => {
    expect(unlistedCandidates(THIRD, THIRD, [])).toEqual(["Daniel", "Ryan"]);
    const arg =
      "Yesterday my roommate Ryan ate my food. Honestly it was rude. Rent is due Friday. Long story short, a long week.";
    const clean =
      "Yesterday Party B ate Party A's food. Honestly it was rude. Rent is due Friday. Long story short, a long week.";
    const rules = nameRules([{ original: "Ryan", replacement: "Party B" }], false);
    expect(unlistedCandidates(arg, clean, rules)).toEqual([]);
    // Without both labels, a once-used opener that is not a common word counts.
    expect(unlistedCandidates("Ryan borrowed my car.", "Ryan borrowed my car.", [])).toEqual(["Ryan"]);
    // A name used twice counts even in a text with both labels.
    expect(unlistedCandidates(THIRD, "Party A thinks so. Ryan says Party B is wrong. Ryan wants less.", [])).toEqual([
      "Ryan",
    ]);
  });

  it("retries a third-person echo and fails closed when it echoes again", async () => {
    claudeJson.mockResolvedValue(reply(THIRD, []));
    const trace = newTrace();
    await expect(anonymize(THIRD, trace)).rejects.toBeInstanceOf(AnonymizeError);
    expect(claudeJson).toHaveBeenCalledTimes(2);
    expect(claudeJson.mock.calls[1][0].system).toContain("Check these capitalized words from the text: Daniel, Ryan.");
    expect(trace.reasons[0]).toBe("unlisted capitalized words survived");
  });

  it("fails closed on a first-person echo with sentence-initial names", async () => {
    const arg = "Ryan borrowed my car. Ryan crashed it.";
    claudeJson.mockResolvedValue(reply(arg, []));
    await expect(anonymize(arg)).rejects.toBeInstanceOf(AnonymizeError);
    expect(claudeJson).toHaveBeenCalledTimes(2);
  });

  it("fails closed when the retry returns a first-person text untouched", async () => {
    const arg = "ryan borrowed my car and crashed it. i think he should pay.";
    claudeJson.mockResolvedValue(reply(arg, []));
    const trace = newTrace();
    await expect(anonymize(arg, trace)).rejects.toThrow("output identical to the input in the first person");
    expect(trace.reasons).toEqual([
      "output identical to the input",
      "output identical to the input in the first person",
    ]);
  });
});

describe("the retry and flagged words", () => {
  it("rejects a retry that leaves a flagged name used as a person and misses a side", async () => {
    const arg = "Ryan borrowed my car and Ryan's brother crashed it.";
    claudeJson
      .mockResolvedValueOnce(reply(arg, []))
      .mockResolvedValueOnce(
        reply("Ryan borrowed Party A's car and Ryan's brother crashed it.", [{ original: "I", replacement: "Party A" }]),
      );
    await expect(anonymize(arg)).rejects.toThrow("a flagged name survived unlisted");
    expect(claudeJson).toHaveBeenCalledTimes(2);
  });

  it("accepts a retry that keeps a Turkish place with a suffix once both sides are labelled", async () => {
    const arg = "Burak'la İstanbul'da tartıştık. Bence haklıyım.";
    const out = "Party A ve Party B İstanbul'da tartıştı. Party A haklı olduğunu düşünüyor.";
    const reps = [
      { original: "Ben", replacement: "Party A" },
      { original: "Burak", replacement: "Party B" },
    ];
    claudeJson.mockResolvedValue(reply(out, reps));
    expect((await anonymize(arg)).text).toBe(out);
    expect(claudeJson).toHaveBeenCalledTimes(2);
    expect(heldCandidates(arg, "Party A İstanbul'da tartıştı.", ["İstanbul"])).toEqual(["İstanbul"]);
    expect(heldCandidates(arg, out, ["İstanbul"])).toEqual([]);
  });

  it("never falls back to a first attempt that still holds a flagged name", async () => {
    const arg = "I told Ryan that Ryan's dog bit me.";
    claudeJson
      .mockResolvedValueOnce(
        reply("Party A told Ryan that Ryan's dog bit Party A.", [{ original: "I", replacement: "Party A" }]),
      )
      .mockResolvedValueOnce(
        reply("Smith told Party A that the dog bit Party A.", [
          { original: "Anna Smith", replacement: "Party B" },
          { original: "John Smith", replacement: "Person C" },
        ]),
      );
    await expect(anonymize(arg)).rejects.toThrow("a listed name survived anonymization");
  });
});

describe("everyday-word names", () => {
  it("are not flagged when not listed", () => {
    const text = "Umut ediyorum ki deniz kenarında buluşuruz, ama can sıkıcı. I can't, will you? May I?";
    const reps = [{ original: "Burak", replacement: "Party B" }];
    expect(leaks(text, reps, true)).toBe(false);
    expect(sub(text, reps, true)).toBe(text);
    expect(unlistedCandidates(text, text, nameRules(reps, true))).toEqual([]);
  });

  it("sentence-initial contractions and calendar words are not candidate names", () => {
    const arg = "It's mid-August. He's late again, Shouldn't he pay? On Monday Daniel'in borcu vardı. Daniel'in payı.";
    expect(unlistedCandidates(arg, arg, [])).toEqual(["Daniel"]);
  });

  it("English 'Can' and 'Will' keep their ordinary uses", () => {
    const can = [{ original: "Can", replacement: "Party B" }];
    const text = "Can you believe Can still hasn't paid? I can't wait. Can't he see it? CAN YOU?";
    const fixed = sub(text, can);
    expect(fixed).toBe("Can you believe Party B still hasn't paid? I can't wait. Can't he see it? CAN YOU?");
    expect(leaks(fixed, can)).toBe(false);

    const will = [{ original: "Will", replacement: "Party B" }];
    const w = sub("Will said he will pay. Will it happen? I asked Will's sister.", will);
    expect(w).toBe("Party B said he will pay. Will it happen? I asked Party B's sister.");
    expect(leaks(w, will)).toBe(false);
  });

  it("Turkish 'Deniz' and 'Umut' keep the sea and hope", () => {
    const deniz = [{ original: "Deniz", replacement: "Party B" }];
    const d = sub("Deniz'le deniz kenarına gittik. Denize girmedi Deniz. Sonra Denize de sordum.", deniz, true);
    expect(d).toBe("Party B'yle deniz kenarına gittik. Denize girmedi Party B. Sonra Party B'ye de sordum.");
    expect(leaks(d, deniz, true)).toBe(false);

    const umut = [{ original: "Umut", replacement: "Party B" }];
    const u = sub("Umut bana borcunu ödemedi. Umut ediyorum öder.", umut, true);
    expect(u).toBe("Party B bana borcunu ödemedi. Umut ediyorum öder.");
    expect(leaks(u, umut, true)).toBe(false);
  });

  it("a listed everyday-word name left mid-sentence is still a leak", () => {
    const can = [{ original: "Can", replacement: "Party B" }];
    expect(leaks("Party A says Can still owes money.", can)).toBe(true);
    expect(leaks("Party A, Can'ın borcunu soruyor.", can, true)).toBe(true);
  });
});

describe("narrator mapping is unchanged", () => {
  it("never substitutes the narrator's pronouns", () => {
    const tr = "Ben haklıyım, Deniz değil. Bence Deniz bana borçlu.";
    const reps = [
      { original: "Ben", replacement: "Party A" },
      { original: "Deniz", replacement: "Party B" },
    ];
    expect(sub(tr, reps, true)).toBe("Ben haklıyım, Party B değil. Bence Party B bana borçlu.");
    expect(sub("I told Mark I was right.", [{ original: "I", replacement: "Party A" }, { original: "Mark", replacement: "Party B" }])).toBe(
      "I told Party B I was right.",
    );
  });

  it("an English friend named Ben is still substituted", () => {
    const reps = [
      { original: "Ben", replacement: "Party B" },
      { original: "I", replacement: "Party A" },
    ];
    expect(sub("I lent Ben my car and Ben's brother crashed it.", reps)).toBe(
      "I lent Party B my car and Party B's brother crashed it.",
    );
  });

  it("the name map after a Turkish repair still maps Ben to the narrator I", async () => {
    const arg = "Ben Burak'a 500 lira verdim, Burak ödemedi.";
    claudeJson.mockResolvedValueOnce(
      reply(arg, [
        { original: "Ben", replacement: "Party A" },
        { original: "Burak'a", replacement: "Party B'ye" },
      ]),
    );
    const res = await anonymize(arg);
    expect(res.text).toBe("Ben Party B'ye 500 lira verdim, Party B ödemedi.");
    expect(res.nameMap).toEqual([
      { original: "I", replacement: "Party A" },
      { original: "Burak", replacement: "Party B" },
    ]);
  });

  it("an English story with a manager named Ben keeps Ben as a name", async () => {
    const arg = "My manager Ben told Jürgen the deadline moved, and Jürgen says Ben is wrong.";
    claudeJson.mockResolvedValueOnce(
      reply(arg, [
        { original: "Ben", replacement: "Party A" },
        { original: "Jürgen", replacement: "Party B" },
      ]),
    );
    const res = await anonymize(arg);
    expect(res.text).toBe("My manager Party A told Party B the deadline moved, and Party B says Party A is wrong.");
    expect(res.nameMap).toEqual([
      { original: "Ben", replacement: "Party A" },
      { original: "Jürgen", replacement: "Party B" },
    ]);
  });
});
