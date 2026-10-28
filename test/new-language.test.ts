import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/claude", () => ({ claudeJson: vi.fn(), claudeSearchJson: vi.fn(), LITE_MODEL: "lite" }));

import { claudeJson, claudeSearchJson, type ClaudeJsonCall } from "../lib/claude";
import { EMAIL_EN, signInEmailContent } from "../lib/email";
import { EN, languageName, registerLocale, type Locale } from "../lib/i18n";
import { judgeOnce } from "../lib/judge";
import { clarifyQuestions } from "../lib/premium/clarify";
import { runFactCheck } from "../lib/premium/factcheck";
import { humanStyle } from "../lib/style";
import { inTargetLanguage, planSegments, translateSystemPrompt, translateUserMessage } from "../lib/translate";
import { EN_TEXT } from "./translate-fixtures";

// A language as a translator would add it, registered the way loadLocale does.
const de: Locale = {
  voice:
    'Address the reader with informal "du", never "Sie". Refer to the parties as "Partei A" and "Partei B" in prose. Write each conditional if_value as a clause that reads on from "Wenn", with no leading "Wenn".',
  strings: { ...EN, "party.a": "Partei A", "party.b": "Partei B", ifPrefix: "Wenn" },
  email: { ...EMAIL_EN, signIn: { ...EMAIL_EN.signIn, subject: "Dein Judge-Anmeldelink" } },
};
registerLocale("de", de);

const mockClaude = vi.mocked(claudeJson);
const mockSearch = vi.mocked(claudeSearchJson);

beforeEach(() => {
  mockClaude.mockReset();
  mockSearch.mockReset();
  mockClaude.mockResolvedValue({ ok: false, blocked: false, error: "x" });
  mockSearch.mockResolvedValue({ ok: false, blocked: false, error: "x" });
});

const systemOf = (mock: typeof mockClaude | typeof mockSearch) => (mock.mock.calls[0][0] as ClaudeJsonCall).system;

describe("judges writing a language added later", () => {
  it("builds the LANGUAGE block from the registry and the voice note", async () => {
    await judgeOnce("Party A says x; Party B says y.", { lang: "de" });
    const system = systemOf(mockClaude);
    expect(system).toContain(
      `in German, following the VOICE rules below. ${de.voice} Keep all JSON enum values exactly as specified in the schema (English identifiers). headline stays at most 10 words.`,
    );
    expect(system).toContain(humanStyle("de"));
    expect(humanStyle("de")).toContain("Apply them to German");
  });

  it("keeps the Turkish block word for word and gives English none", async () => {
    await judgeOnce("x", { lang: "tr" });
    expect(systemOf(mockClaude)).toContain(
      'in Turkish, following the VOICE rules below. Address the reader with informal "sen", never "siz". Refer to the parties as "Taraf A" and "Taraf B" in prose. Write each conditional if_value as a bare conditional clause ending in -sa/-se (e.g. "dürüstlüğe en çok değer veriyorsan"), with no leading "Eğer". Keep all JSON enum values',
    );
    mockClaude.mockClear();
    await judgeOnce("x", { lang: "en" });
    expect(systemOf(mockClaude)).not.toContain("LANGUAGE:");
  });

  it("asks clarifying questions and fact-checks in the language", async () => {
    await clarifyQuestions("We argued about the dishes for a week.", "de");
    expect(systemOf(mockClaude)).toContain(`LANGUAGE: write the questions in German, in everyday words. ${de.voice}`);
    await runFactCheck("Party A says x.", "de");
    expect(systemOf(mockSearch)).toContain(`LANGUAGE: Write each claim and summary in German, in everyday words. ${de.voice}`);
  });
});

describe("translating to and from a language added later", () => {
  it("maps the two languages' own party labels", () => {
    expect(translateSystemPrompt("en", "de")).toContain('Party labels map exactly: "Party A" -> "Partei A", "Party B" -> "Partei B".');
    expect(translateSystemPrompt("en", "de")).toContain(de.voice);
    expect(translateUserMessage("de", "tr", [{ i: 0, text: "x" }])).toContain('"Partei A" is "Taraf A"');
    // English <-> Turkish keeps its own rules.
    expect(translateSystemPrompt("tr", "en")).toContain('"Party A" <-> "Taraf A"');
  });

  it("notes the conditional clause around the language's own If", () => {
    const text = { ...EN_TEXT, conditional: [{ if_value: "you value honesty", then: "Party A" }] };
    const notes = planSegments(text, "de").segments.map((s) => s.note).filter(Boolean);
    expect(notes).toContain('condition clause printed after "Wenn": no leading "Wenn"');
  });

  it("checks the script of a non-Latin target", () => {
    const ru = "Сторона А права, потому что договорились заранее и об этом знали оба участника спора.";
    const en = "Party A is right because they agreed in advance and both of them knew about it.";
    expect(inTargetLanguage([ru], "ru")).toBe(true);
    expect(inTargetLanguage([en], "ru")).toBe(false);
    expect(inTargetLanguage(["甲方是对的，因为双方事先已经约定好了，而且两个人都清楚这一点，这没有什么好争的。"], "zh-Hans")).toBe(true);
    expect(inTargetLanguage(["Aさんが正しいです。前もって約束していて、二人ともそのことを知っていたからです。"], "ja")).toBe(true);
  });
});

describe("emails and language names", () => {
  it("uses a loaded language's email copy and English otherwise", () => {
    expect(signInEmailContent("https://x.test/l", "de").subject).toBe("Dein Judge-Anmeldelink");
    expect(signInEmailContent("https://x.test/l", "fr").subject).toBe(EMAIL_EN.signIn.subject);
  });

  it("names languages in the reader's language", () => {
    expect(languageName("en", "tr")).toBe("Turkish");
    expect(languageName("tr", "en")).toBe("İngilizce");
    expect(languageName("en", "de")).toBe("German");
    expect(languageName("en", "zh-Hant")).toBe("Traditional Chinese");
  });
});
