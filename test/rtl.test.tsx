import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PageShell } from "../components/account/PageShell";
import { ogCanDraw } from "../components/OgCard";
import { caseReadyEmailContent, signInEmailContent } from "../lib/email";

describe("right-to-left languages", () => {
  it("set dir on the page wrapper", () => {
    const html = (lang: "ar" | "en") =>
      renderToStaticMarkup(
        <PageShell lang={lang} kicker="k" title="t" bare>
          <p>x</p>
        </PageShell>,
      );
    expect(html("ar")).toContain('lang="ar" dir="rtl"');
    expect(html("en")).toContain('lang="en" dir="ltr"');
  });

  it("mark their emails right to left and leave the others as they were", () => {
    expect(signInEmailContent("https://x.test/l", "he").html).toContain('<html lang="he" dir="rtl">');
    expect(caseReadyEmailContent("https://x.test/c", "ur").html).toContain('<html lang="ur" dir="rtl">');
    expect(signInEmailContent("https://x.test/l", "tr").html).toContain('<html lang="tr"><body');
  });
});

describe("link preview fonts", () => {
  it("draw Latin, Greek and Cyrillic text", () => {
    expect(ogCanDraw("Taraf A haklı · Güven 4/5", "Сторона А права", "Το Μέρος Β έχει δίκιο", undefined)).toBe(true);
    expect(ogCanDraw("Bên A đúng")).toBe(true);
  });

  it("refuse scripts they would draw as boxes", () => {
    expect(ogCanDraw("Party A", "الطرف أ على حق")).toBe(false);
    expect(ogCanDraw("甲方是对的")).toBe(false);
    expect(ogCanDraw("पक्ष A सही है")).toBe(false);
  });
});
