import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../lib/claude", () => ({ claudeJson: vi.fn(), claudeSearchJson: vi.fn(), LITE_MODEL: "lite" }));

// test/setup.ts loads every language up front, which would hide a server
// path that forgets to. These run on fresh modules with nothing loaded.
beforeAll(() => {
  vi.resetModules();
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("server code loads the language it writes", () => {
  it("starts with nothing but English", async () => {
    const { hasStrings } = await import("../lib/i18n");
    expect(hasStrings("tr")).toBe(false);
  });

  it("puts the Turkish voice note into the judges' prompt", async () => {
    const claude = await import("../lib/claude");
    const json = vi.mocked(claude.claudeJson);
    json.mockResolvedValue({ ok: false, blocked: false, error: "x" });
    const { judgeOnce } = await import("../lib/judge");
    await judgeOnce("Party A says x; Party B says y.", { lang: "tr" });
    expect(json.mock.calls[0][0].system).toContain('Refer to the parties as "Taraf A" and "Taraf B" in prose.');
  });

  it("sends the Turkish sign-in email", async () => {
    vi.stubEnv("RESEND_API_KEY", "k");
    vi.stubEnv("EMAIL_FROM", "Judge <a@b.test>");
    const fetch = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetch);
    const { sendSignInEmail } = await import("../lib/email");
    await sendSignInEmail({ to: "x@y.test", url: "https://x.test/l", lang: "tr" });
    const body = JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.subject).toBe("Judge giriş bağlantın");
  });
});
