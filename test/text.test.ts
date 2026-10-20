import { describe, expect, it } from "vitest";
import { STRINGS } from "../lib/i18n";
import { hyphenRuns, noOrphan, separatorPhrases, stripLeadingEmoji } from "../lib/text";

const NBSP = " ";

describe("noOrphan", () => {
  it("binds the last two words of a short heading", () => {
    expect(noOrphan("What a verdict looks like")).toBe(`What a verdict looks${NBSP}like`);
    expect(noOrphan("Bir karar neye benzer")).toBe(`Bir karar neye${NBSP}benzer`);
  });

  it("replaces only the last space", () => {
    const out = noOrphan("Find the crux");
    expect(out).toBe(`Find the${NBSP}crux`);
    expect(out.split(NBSP)).toHaveLength(2);
    expect(out.indexOf(" ")).toBe(4);
  });

  it("collapses a run of whitespace before the last word into one NBSP", () => {
    expect(noOrphan("Settle it  now")).toBe(`Settle it${NBSP}now`);
    expect(noOrphan("Settle it\nnow")).toBe(`Settle it${NBSP}now`);
  });

  it("keeps trailing punctuation and trailing whitespace with the last word", () => {
    expect(noOrphan("So who's right?")).toBe(`So who's${NBSP}right?`);
    expect(noOrphan("Settle it now. ")).toBe(`Settle it${NBSP}now. `);
  });

  it("leaves two-word headings breakable (one NBSP would make them a single token)", () => {
    expect(noOrphan("Judge hakkında")).toBe("Judge hakkında");
    expect(noOrphan("Who's right?")).toBe("Who's right?");
    expect(noOrphan("Settle  it")).toBe("Settle  it");
  });

  it("leaves headings longer than the limit alone", () => {
    const seven = "one two three four five six seven";
    expect(noOrphan(seven)).toBe(seven);
    expect(noOrphan(seven, 7)).toBe(`one two three four five six${NBSP}seven`);
    expect(noOrphan("one two three four five six")).toBe(`one two three four five${NBSP}six`);
  });

  it("leaves single words and empty strings alone", () => {
    expect(noOrphan("Settle")).toBe("Settle");
    expect(noOrphan("  Settle  ")).toBe("  Settle  ");
    expect(noOrphan("")).toBe("");
  });

  it("is idempotent", () => {
    const once = noOrphan("Things people ask");
    expect(noOrphan(once)).toBe(once);
  });
});

describe("separatorPhrases", () => {
  it("binds each dot to the phrase before it", () => {
    expect(separatorPhrases("Three independent judges · Names stay anonymous")).toEqual([
      `Three independent judges${NBSP}·`,
      "Names stay anonymous",
    ]);
    expect(separatorPhrases("a · b · c")).toEqual([`a${NBSP}·`, `b${NBSP}·`, "c"]);
  });

  it("returns a line without the separator as one phrase", () => {
    expect(separatorPhrases("Just one")).toEqual(["Just one"]);
  });

  it("splits the hero eyebrow into two phrases in both languages", () => {
    for (const lang of ["en", "tr"] as const) {
      expect(separatorPhrases(STRINGS[lang]["hero.eyebrow"]), lang).toHaveLength(2);
    }
  });
});

describe("stripLeadingEmoji", () => {
  it("drops a leading emoji and the space after it", () => {
    expect(stripLeadingEmoji("⚡ The crux")).toBe("The crux");
    expect(stripLeadingEmoji("📤 Share")).toBe("Share");
    expect(stripLeadingEmoji("🔗 Bağlantıyı kopyala")).toBe("Bağlantıyı kopyala");
  });

  it("handles variation selectors, ZWJ sequences, skin tones and the check mark", () => {
    expect(stripLeadingEmoji("🛡️ The ruling held up")).toBe("The ruling held up");
    expect(stripLeadingEmoji("⚠️ Doubts")).toBe("Doubts");
    expect(stripLeadingEmoji("🤍 The other side's best point")).toBe("The other side's best point");
    expect(stripLeadingEmoji("👩‍⚖️ Judge")).toBe("Judge");
    expect(stripLeadingEmoji("👍🏽 Fine")).toBe("Fine");
    expect(stripLeadingEmoji("✓ Link copied")).toBe("Link copied");
  });

  it("only touches the start of the string", () => {
    expect(stripLeadingEmoji("The crux ⚡")).toBe("The crux ⚡");
    expect(stripLeadingEmoji("Fine-tune ▸")).toBe("Fine-tune ▸");
    expect(stripLeadingEmoji("Settle your own argument →")).toBe("Settle your own argument →");
  });

  it("never strips digits, letters or Turkish characters", () => {
    expect(stripLeadingEmoji("3 judges")).toBe("3 judges");
    expect(stripLeadingEmoji("#1 rule")).toBe("#1 rule");
    expect(stripLeadingEmoji("İsimler gizli")).toBe("İsimler gizli");
    expect(stripLeadingEmoji("Şimdi")).toBe("Şimdi");
  });

  it("returns strings without an emoji unchanged", () => {
    expect(stripLeadingEmoji("Settle another one")).toBe("Settle another one");
    expect(stripLeadingEmoji("")).toBe("");
  });

  it("cleans every emoji-led dictionary label the redesign draws its own icon for", () => {
    for (const lang of ["en", "tr"] as const) {
      for (const key of ["cruxShort", "bestPointTitle", "share", "copyLink", "copied", "bedrock"] as const) {
        const out = stripLeadingEmoji(STRINGS[lang][key]);
        expect(out, `${lang}.${key}`).toMatch(/^\p{L}/u);
      }
    }
  });
});

describe("hero title lines", () => {
  it("hero.title (used for metadata) equals the two display lines joined by a space", () => {
    for (const lang of ["en", "tr"] as const) {
      const s = STRINGS[lang];
      expect(s["hero.title"], lang).toBe(`${s["hero.titleLine1"]} ${s["hero.titleLine2"]}`);
    }
  });
});

describe("hyphenRuns", () => {
  it("holds short hyphenated words together and keeps the real hyphen", () => {
    const runs = hyphenRuns("Soggy-crust pizza is still pizza, and thin-crust wins.");
    expect(runs.filter((r) => r.keep).map((r) => r.text)).toEqual(["Soggy-crust", "thin-crust"]);
    expect(runs.map((r) => r.text).join("")).toBe("Soggy-crust pizza is still pizza, and thin-crust wins.");
  });

  it("keeps punctuation attached to the word it follows", () => {
    expect(hyphenRuns("It is well-made.").at(-1)).toEqual({ text: "well-made.", keep: true });
  });

  it("leaves text without hyphenated words as a single breakable run", () => {
    expect(hyphenRuns("A hot dog is its own thing")).toEqual([{ text: "A hot dog is its own thing", keep: false }]);
    expect(hyphenRuns("")).toEqual([{ text: "", keep: false }]);
  });

  it("ignores dashes between spaces and numbers, and words too long to hold", () => {
    expect(hyphenRuns("Yes - mostly").some((r) => r.keep)).toBe(false);
    expect(hyphenRuns("from 2020-2024").some((r) => r.keep)).toBe(false);
    expect(hyphenRuns("an extraordinarily-overcomplicated-compound").some((r) => r.keep)).toBe(false);
  });
});
