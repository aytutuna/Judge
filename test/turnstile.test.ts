import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { turnstileEnabled, verifyTurnstile } from "../lib/turnstile";

const fetchMock = vi.fn();

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("verifyTurnstile", () => {
  it("is skipped when no secret is configured", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    expect(turnstileEnabled()).toBe(false);
    expect(await verifyTurnstile(undefined, "203.0.113.5")).toBe("ok");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe("with a secret", () => {
    beforeEach(() => vi.stubEnv("TURNSTILE_SECRET_KEY", "test-secret"));

    it("rejects a missing token without calling Cloudflare", async () => {
      expect(turnstileEnabled()).toBe(true);
      expect(await verifyTurnstile(undefined, "203.0.113.5")).toBe("invalid");
      expect(await verifyTurnstile("", "203.0.113.5")).toBe("invalid");
      expect(await verifyTurnstile("x".repeat(2049), "203.0.113.5")).toBe("invalid");
      expect(fetchMock).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledTimes(3);
      expect(console.warn).toHaveBeenCalledWith("[signal:turnstile_fail]");
    });

    it("posts secret, token, and IP to siteverify and accepts success", async () => {
      fetchMock.mockResolvedValue(reply({ success: true }));
      expect(await verifyTurnstile("tok", "203.0.113.5")).toBe("ok");
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
      expect(init.method).toBe("POST");
      const form = init.body as URLSearchParams;
      expect(form.get("secret")).toBe("test-secret");
      expect(form.get("response")).toBe("tok");
      expect(form.get("remoteip")).toBe("203.0.113.5");
    });

    it("omits remoteip when the IP is unknown", async () => {
      fetchMock.mockResolvedValue(reply({ success: true }));
      await verifyTurnstile("tok", "unknown");
      expect((fetchMock.mock.calls[0][1].body as URLSearchParams).has("remoteip")).toBe(false);
    });

    it("rejects an invalid or reused token", async () => {
      fetchMock.mockResolvedValue(
        reply({ success: false, "error-codes": ["timeout-or-duplicate"] }),
      );
      expect(await verifyTurnstile("tok", "203.0.113.5")).toBe("invalid");
      expect(console.warn).toHaveBeenCalledWith("[signal:turnstile_fail]");
    });

    it("reports a rejected secret, HTTP error, or network failure as an error", async () => {
      fetchMock.mockResolvedValueOnce(
        reply({ success: false, "error-codes": ["invalid-input-secret"] }),
      );
      expect(await verifyTurnstile("tok", "203.0.113.5")).toBe("error");
      fetchMock.mockResolvedValueOnce(reply({}, 500));
      expect(await verifyTurnstile("tok", "203.0.113.5")).toBe("error");
      fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
      expect(await verifyTurnstile("tok", "203.0.113.5")).toBe("error");
    });
  });
});
