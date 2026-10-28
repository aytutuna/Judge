import { afterEach, describe, expect, it, vi } from "vitest";

// Every verdict goes to the premium handler; its own gates and pipeline are
// covered in premium-route.test.ts.
const premiumVerdict = vi.hoisted(() => vi.fn());
vi.mock("@/lib/premium/handler", () => ({ premiumVerdict }));
vi.mock("@/lib/bearer-guard", () => ({ rejectDeadBearer: async () => null }));

import { maxDuration, POST } from "../app/api/verdict/route";

const ARGUMENT = "Mark says the Great Wall is visible from space with the naked eye; I say it is not.";

function request(body: unknown): Request {
  return new Request("http://localhost/api/verdict", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/verdict", () => {
  it("allows a long-running function on Vercel", () => {
    expect(maxDuration).toBe(300);
  });

  it("validates the body before the handler sees it", async () => {
    const cases: [unknown, string][] = [
      ["{not json", "invalid"],
      [{ argument: "too short" }, "too_short"],
      [{ argument: "x".repeat(6001) }, "too_long"],
      [{ argument: ARGUMENT, tier: "gold" }, "invalid"],
    ];
    for (const [body, code] of cases) {
      const res = await POST(request(body));
      expect(res.status).toBe(400);
      expect(((await res.json()) as { code: string }).code).toBe(code);
    }
    expect(premiumVerdict).not.toHaveBeenCalled();
  });

  it("hands every request to the premium handler, whatever tier it names", async () => {
    premiumVerdict.mockImplementation(async () => Response.json({ ok: true }));
    for (const tier of [undefined, "free", "premium"]) {
      const req = request({ argument: ARGUMENT, lang: "tr", ...(tier ? { tier } : {}) });
      const res = await POST(req);
      expect(await res.json()).toEqual({ ok: true });
      const [passedReq, data] = premiumVerdict.mock.calls.at(-1)!;
      expect(passedReq).toBe(req);
      expect(data).toMatchObject({ argument: ARGUMENT, framework: { preset: "balanced" }, lang: "tr" });
    }
    expect(premiumVerdict).toHaveBeenCalledTimes(3);
  });
});
