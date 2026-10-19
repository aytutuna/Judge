import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const claudeJson = vi.hoisted(() => vi.fn());

vi.mock("../lib/claude", () => ({
  claudeJson,
  hasApiKey: () => Boolean(process.env.ANTHROPIC_API_KEY),
  LITE_MODEL: "test-model",
}));

import { anonymize, AnonymizeError, normalizeNameMap } from "../lib/anonymize";
import { partyNames, resolveParties, restoreNames } from "../lib/names";

const RAW = "Mark thinks pineapple belongs on pizza and Ana disagrees.";

beforeEach(() => vi.stubEnv("ANTHROPIC_API_KEY", "test-key"));
afterEach(() => {
  claudeJson.mockReset();
  vi.unstubAllEnvs();
});

describe("anonymize", () => {
  it("returns the rewritten text and the real replacements", async () => {
    claudeJson.mockResolvedValue({
      ok: true,
      data: {
        text: "Party A thinks pineapple belongs on pizza and Party B disagrees.",
        replacements: [
          { original: "Mark", replacement: "Party A" },
          { original: "Ana", replacement: "Party B" },
          { original: "Party A", replacement: "Party A" },
        ],
      },
    });
    const res = await anonymize(RAW);
    expect(res.text).not.toContain("Mark");
    expect(res.nameMap).toEqual([
      { original: "Mark", replacement: "Party A" },
      { original: "Ana", replacement: "Party B" },
    ]);
  });

  // Never hand back the raw text: it would be judged and stored with the
  // real names in it.
  it.each([
    ["a refusal", { ok: false, blocked: true, reason: "refusal" }],
    ["a quota error", { ok: false, blocked: false, error: "Claude HTTP 429: rate limited" }],
    ["a timeout", { ok: false, blocked: false, error: "Claude request timed out after 60s" }],
    ["empty text", { ok: true, data: { text: "  ", replacements: [] } }],
    ["missing replacements", { ok: true, data: { text: "Party A thinks..." } }],
  ])("throws on %s instead of returning the raw text", async (_label, result) => {
    claudeJson.mockResolvedValue(result);
    await expect(anonymize(RAW)).rejects.toBeInstanceOf(AnonymizeError);
  });

  it("throws without an API key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    await expect(anonymize(RAW)).rejects.toBeInstanceOf(AnonymizeError);
    expect(claudeJson).not.toHaveBeenCalled();
  });
});

describe("normalizeNameMap", () => {
  const TR_ARG =
    "Arkadaşım Deniz çayın su kaynayınca hazır olduğunu söylüyor. Ben ise demlenmeden çay olmaz diyorum.";

  it("adds the Turkish narrator when the model rewrote 'Ben' without listing it", () => {
    const text = "Party A'nın arkadaşı Party B çayın su kaynayınca hazır olduğunu söylüyor. Party A ise demlenmeden çay olmaz diyor.";
    expect(normalizeNameMap([{ original: "Deniz", replacement: "Party B" }], TR_ARG, text)).toEqual([
      { original: "I", replacement: "Party A" },
      { original: "Deniz", replacement: "Party B" },
    ]);
  });

  it("adds the Turkish narrator when the model left the first person for the judges", () => {
    const text = "Arkadaşım Party B çayın su kaynayınca hazır olduğunu söylüyor. Ben ise demlenmeden çay olmaz diyorum.";
    expect(normalizeNameMap([{ original: "Deniz", replacement: "Party B" }], TR_ARG, text)[0]).toEqual({
      original: "I",
      replacement: "Party A",
    });
  });

  it("adds a pro-drop Turkish narrator from verb endings alone", () => {
    const arg = "Deniz'e dün akşam söz verdim, ama işten geç çıktım ve yetişemedim.";
    const text = "Party B'ye dün akşam Party A söz verdi, ama işten geç çıktı ve yetişemedi.";
    expect(normalizeNameMap([{ original: "Deniz", replacement: "Party B" }], arg, text)[0]).toEqual({
      original: "I",
      replacement: "Party A",
    });
  });

  it("adds the English narrator when 'I' was rewritten without being listed", () => {
    const arg = "I told Mark the tea wasn't ready. He says boiling water is enough.";
    const text = "Party A told Party B the tea wasn't ready. Party B says boiling water is enough.";
    expect(normalizeNameMap([{ original: "Mark", replacement: "Party B" }], arg, text)).toEqual([
      { original: "I", replacement: "Party A" },
      { original: "Mark", replacement: "Party B" },
    ]);
  });

  it("never makes a reporting narrator a side", () => {
    const arg = "My wife and her sister argue about tea. I think both have a point.";
    const text = "Party A and Party B argue about tea. I think both have a point.";
    expect(normalizeNameMap([], arg, text)).toEqual([]);
    const trArg = "Annemle babam çay yüzünden tartışıyor. Bence ikisi de haklı.";
    const trText = "Party A ile Party B çay yüzünden tartışıyor. Bence ikisi de haklı.";
    expect(normalizeNameMap([], trArg, trText)).toEqual([]);
  });

  it("does not add a narrator to a third-person story", () => {
    const arg = "Mark thinks pineapple belongs on pizza and Ana disagrees.";
    const text = "Party A thinks pineapple belongs on pizza and Party B disagrees.";
    expect(
      normalizeNameMap(
        [
          { original: "Mark", replacement: "Party A" },
          { original: "Ana", replacement: "Party B" },
        ],
        arg,
        text,
      ),
    ).toEqual([
      { original: "Mark", replacement: "Party A" },
      { original: "Ana", replacement: "Party B" },
    ]);
  });

  it("an English friend named Ben is not read as a Turkish narrator", () => {
    const arg = "Ben says the tea is ready, Sam says it is not.";
    const text = "Party A says the tea is ready, Party B says it is not.";
    expect(
      normalizeNameMap(
        [
          { original: "Ben", replacement: "Party A" },
          { original: "Sam", replacement: "Party B" },
        ],
        arg,
        text,
      ),
    ).toEqual([
      { original: "Ben", replacement: "Party A" },
      { original: "Sam", replacement: "Party B" },
    ]);
  });

  it("strips Turkish suffixes and canonicalises labels, then dedupes", () => {
    expect(
      normalizeNameMap(
        [
          { original: "Deniz'in", replacement: "Party B" },
          { original: "Deniz’e", replacement: "Party B'ye" },
          { original: "Deniz", replacement: "Taraf B" },
          { original: "Ben", replacement: "Party A" },
          { original: "Selin'den", replacement: "Kişi C" },
        ],
        TR_ARG,
        "Party A ...",
      ),
    ).toEqual([
      { original: "Deniz", replacement: "Party B" },
      { original: "I", replacement: "Party A" },
      { original: "Selin", replacement: "Person C" },
    ]);
  });

  it("strips a suffix glued on without an apostrophe only when the bare name is in the text", () => {
    const arg = "Dün Deniz geldi. Denizin dediği doğru değil, Selin de öyle diyor.";
    expect(
      normalizeNameMap(
        [
          { original: "Denizin", replacement: "Party B" },
          { original: "Selin", replacement: "Person C" },
        ],
        arg,
        "Party B geldi.",
      ),
    ).toEqual([
      { original: "Deniz", replacement: "Party B" },
      { original: "Selin", replacement: "Person C" },
    ]);
  });

  it("normalises inflected narrator forms", () => {
    const text = "Party A haklı.";
    expect(normalizeNameMap([{ original: "benim", replacement: "Party A" }], "x", text)).toEqual([
      { original: "I", replacement: "Party A" },
    ]);
    expect(normalizeNameMap([{ original: "Bana", replacement: "Party A" }], "x", text)).toEqual([
      { original: "I", replacement: "Party A" },
    ]);
    expect(normalizeNameMap([{ original: "me", replacement: "Party A" }], "x", text)).toEqual([
      { original: "I", replacement: "Party A" },
    ]);
  });

  it("keeps non-person replacements as they are", () => {
    expect(normalizeNameMap([{ original: "Acme Ltd", replacement: "the company" }], "x", "y")).toEqual([
      { original: "Acme Ltd", replacement: "the company" },
    ]);
  });
});

describe("normalizeNameMap: narrator as I", () => {
  const TR = "Deniz çayın hazır olduğunu söylüyor. Ben ise demlenmeden çay olmaz diyorum.";
  const TR_TEXT = "Party B çayın hazır olduğunu söylüyor. Party A ise demlenmeden çay olmaz diyor.";

  it("rewrites a listed Turkish 'Ben' to 'I', so the narrator is You/Sen under either UI language", () => {
    const map = normalizeNameMap(
      [
        { original: "Ben", replacement: "Party A" },
        { original: "Deniz", replacement: "Party B" },
      ],
      TR,
      TR_TEXT,
    );
    expect(map).toEqual([
      { original: "I", replacement: "Party A" },
      { original: "Deniz", replacement: "Party B" },
    ]);
    // Judged with the English interface (verdict lang "en"): never "Ben".
    expect(partyNames(map, "en", "en")).toEqual({ nameA: "You", nameB: "Deniz", aIsSelf: true, bIsSelf: false });
    expect(partyNames(map, "tr", "en")).toEqual({ nameA: "Sen", nameB: "Deniz", aIsSelf: true, bIsSelf: false });
    expect(partyNames(map, "tr", "tr").nameA).toBe("Sen");
    const parties = resolveParties(map, "en");
    expect(restoreNames("Party A is right and Party A's plan works.", parties, "en")).toBe(
      "You are right and your plan works.",
    );
    expect(restoreNames("Taraf A haklı.", parties, "tr")).toBe("Sen haklısın.");
  });

  it("rewrites a Turkish narrator typed without Turkish letters", () => {
    const arg = "Ben haksiz degilim, Deniz de biliyor bunu ama kabul etmiyor.";
    expect(
      normalizeNameMap(
        [
          { original: "Ben", replacement: "Party A" },
          { original: "Deniz", replacement: "Party B" },
        ],
        arg,
        "Party A haksiz degil, Party B de biliyor bunu ama kabul etmiyor.",
      )[0],
    ).toEqual({ original: "I", replacement: "Party A" });
  });
});

describe("normalizeNameMap: Turkish detection", () => {
  it("an English story with one Turkish letter and a manager named Ben is not Turkish", () => {
    const arg = "My manager Ben told Jürgen the deadline moved, and Jürgen says Ben is wrong.";
    const text = "My manager Party A told Party B the deadline moved, and Party B says Party A is wrong.";
    expect(
      normalizeNameMap(
        [
          { original: "Ben", replacement: "Party A" },
          { original: "Jürgen", replacement: "Party B" },
        ],
        arg,
        text,
      ),
    ).toEqual([
      { original: "Ben", replacement: "Party A" },
      { original: "Jürgen", replacement: "Party B" },
    ]);
  });

  it("never adds a narrator for an unlisted English 'Ben' next to a Turkish letter", () => {
    const arg = "Ben told Jürgen the deadline moved.";
    const text = "Party A told Party B the deadline moved.";
    expect(normalizeNameMap([{ original: "Jürgen", replacement: "Party B" }], arg, text)).toEqual([
      { original: "Jürgen", replacement: "Party B" },
    ]);
  });

  it("still reads ordinary Turkish arguments as Turkish", () => {
    const arg = "Ben haklıyım, Deniz değil.";
    expect(
      normalizeNameMap(
        [
          { original: "Ben", replacement: "Party A" },
          { original: "Deniz", replacement: "Party B" },
        ],
        arg,
        "Party A haklı, Party B değil.",
      )[0],
    ).toEqual({ original: "I", replacement: "Party A" });
    const arg2 = "Deniz'e dün söz verdim ama geç kaldım. Bence bu kadar büyütülecek bir şey değil.";
    expect(
      normalizeNameMap(
        [{ original: "Deniz", replacement: "Party B" }],
        arg2,
        "Party B'ye dün Party A söz verdi ama geç kaldı. Party A'ya göre bu kadar büyütülecek bir şey değil.",
      )[0],
    ).toEqual({ original: "I", replacement: "Party A" });
  });
});

describe("normalizeNameMap: glued suffixes", () => {
  const strip = (original: string, argument: string, others: { original: string; replacement: string }[] = []) =>
    normalizeNameMap([{ original, replacement: "Party B" }, ...others], argument, "Party B").find(
      (m) => m.replacement === "Party B",
    )?.original;

  it.each([
    ["Denizin", "Dün Deniz geldi. Denizin dediği doğru değil.", "Deniz"],
    ["Denizin", "Denizin dediği doğru değil, Deniz'e de söyledim.", "Deniz"],
    ["Ayşenin", "Dün Ayşe ile konuştum. Ayşenin dediği doğru değil.", "Ayşe"],
  ])("strips %s in a Turkish argument where the bare name is used as a name", (original, argument, expected) => {
    expect(strip(original, argument)).toBe(expected);
  });

  it("keeps the name when the bare form only starts a sentence", () => {
    expect(strip("Denizin", "Deniz geldi. Denizin dediği doğru değil.")).toBe("Denizin");
  });

  it('"Sena" never becomes "Sen" (pronoun, and "-a" breaks vowel harmony)', () => {
    expect(strip("Sena", "Sena bana kızdı. Bana dedi ki Sen hep geç kalıyorsun, ama ben haklıyım.")).toBe("Sena");
  });

  it('"Senin" never becomes "Sen" even mid-sentence', () => {
    expect(strip("Senin", "Dün akşam Senin yüzünden dedi, ama bence Sen haklısın.")).toBe("Senin");
  });

  it('"Duru" never becomes the imperative "Dur"', () => {
    expect(strip("Duru", "Duru ile tartıştık. Dur dedim ama dinlemedi, ben haklıydım.")).toBe("Duru");
    expect(strip("Duru", 'Duru ile tartıştık, bana "Dur" dedi ve gitti.')).toBe("Duru");
  });

  it('"Dana" never becomes "Dan" when Dan is another person, in either language', () => {
    const others = [{ original: "Dan", replacement: "Person C" }];
    expect(strip("Dana", "Dün Dana ve Dan geldi, ben de oradaydım ama Dana haksızdı.", others)).toBe("Dana");
    expect(strip("Dana", "Dana told Dan the plan, and Dan agreed.", others)).toBe("Dana");
  });

  it('"Kayla" stays whole', () => {
    expect(strip("Kayla", "Kayla and Kay argued about the rent.")).toBe("Kayla");
    const others = [{ original: "Kay", replacement: "Person C" }];
    expect(strip("Kayla", "Kayla bana kızdı, çünkü dün Kay ile çıktım.", others)).toBe("Kayla");
  });

  it('"Jayden" stays whole ("Jay" + "-den" breaks vowel harmony)', () => {
    expect(strip("Jayden", "Jayden ile konuştum, dün Jay de geldi ve ben haklıydım.")).toBe("Jayden");
    expect(strip("Jayden", "Jayden says Jay is wrong.")).toBe("Jayden");
  });

  it('"Martin" stays whole (not the month "Mart")', () => {
    expect(strip("Martin", "Martin geçen Mart'ta taşındı ve bana borcunu ödemedi.")).toBe("Martin");
    expect(strip("Martin", "Martin moved out in March and still owes me rent.")).toBe("Martin");
  });

  it("keeps a full name that itself takes an apostrophe suffix", () => {
    expect(strip("Selin", "Dün Sel geldi. Selin'e sordum, o da haklı olduğumu söyledi.")).toBe("Selin");
  });

  it("only strips in a Turkish argument", () => {
    expect(strip("Denizin", "Yesterday Deniz came. Denizin said it was fine.")).toBe("Denizin");
  });
});
