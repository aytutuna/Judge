import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../lib/i18n";

vi.mock("@/lib/analytics/client", () => ({ track: vi.fn() }));

const { shareLink } = await import("../lib/share-link");

const URL_ = "https://okjudge.com/r/AAAAAAAAAAAAAAAAAAAAAA";

function stub(nav: Record<string, unknown>) {
  vi.stubGlobal("navigator", nav);
  vi.stubGlobal("window", { prompt: vi.fn() });
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe("shareLink", () => {
  it("opens the share sheet with one line of text and the link", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn();
    stub({ share, clipboard: { writeText } });
    expect(await shareLink("en", URL_)).toBe("shared");
    expect(share).toHaveBeenCalledWith({ text: t("en", "case.invite.shareText"), url: URL_ });
    expect(writeText).not.toHaveBeenCalled();
  });

  it("does nothing more when the sheet is dismissed", async () => {
    const writeText = vi.fn();
    stub({ share: vi.fn().mockRejectedValue(new DOMException("closed", "AbortError")), clipboard: { writeText } });
    expect(await shareLink("en", URL_)).toBe("cancelled");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("copies the link where there is no share sheet", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stub({ clipboard: { writeText } });
    expect(await shareLink("en", URL_)).toBe("copied");
    expect(writeText).toHaveBeenCalledWith(URL_);
  });

  it("copies when the browser refuses the sheet, as it does after a slow request", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stub({ share: vi.fn().mockRejectedValue(new DOMException("no gesture", "NotAllowedError")), clipboard: { writeText } });
    expect(await shareLink("en", URL_)).toBe("copied");
    expect(writeText).toHaveBeenCalledWith(URL_);
  });

  it("asks to copy by hand when the clipboard is closed too", async () => {
    stub({ clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    expect(await shareLink("en", URL_)).toBe("cancelled");
    expect((window as unknown as { prompt: ReturnType<typeof vi.fn> }).prompt).toHaveBeenCalledWith(t("en", "copyPrompt"), URL_);
  });
});
