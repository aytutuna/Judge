import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/** The one-time private-details agreement: its endpoint, ledger row and gate. */

const m = vi.hoisted(() => ({ getViewer: vi.fn(), isSameOrigin: vi.fn(), checkUserLimits: vi.fn() }));

vi.mock("@/lib/auth", () => ({
  getViewer: m.getViewer,
  isSameOrigin: m.isSameOrigin,
  resolveViewer: async (req: Request) => ({ viewer: (await m.getViewer(req)) ?? null, deadBearer: false }),
  hasDeadBearer: async () => false,
}));
vi.mock("@/lib/ratelimit", () => ({ checkUserLimits: m.checkUserLimits }));

const dir = mkdtempSync(path.join(tmpdir(), "verdict-agreement-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;

const agreementRoute = await import("../app/api/v1/me/agreement/route");
const consentRoute = await import("../app/api/v1/me/consent/route");
const actual = await vi.importActual<typeof import("../lib/feedback/agreement")>("../lib/feedback/agreement");
const { getDb } = await import("../lib/db");
const { ensureFeedbackTables } = await import("../lib/feedback/db");
const { POLICY_VERSION, SENSITIVE_AGREEMENT_EN } = await import("../lib/policy");

afterAll(() => {
  const g = globalThis as unknown as { __verdictLibsql?: { close(): void } };
  g.__verdictLibsql?.close();
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Left for the OS temp cleaner.
  }
});

type Opts = { user?: string; via?: "cookie" | "bearer"; cross?: boolean; raw?: string };

function post(body: unknown, o: Opts = {}): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (o.user) headers["x-test-user"] = o.user;
  if (o.via) headers["x-test-via"] = o.via;
  if (o.cross) headers["x-test-cross"] = "1";
  return agreementRoute.POST(
    new Request("http://localhost:4010/api/v1/me/agreement", { method: "POST", headers, body: o.raw ?? JSON.stringify(body) }),
  );
}

const status = async (user: string) =>
  (await consentRoute.GET(new Request("http://localhost:4010/api/v1/me/consent", { headers: { "x-test-user": user } }))).json();

async function ledger(user: string) {
  await ensureFeedbackTables();
  const db = await getDb();
  return (await db.execute({ sql: "SELECT * FROM consent_ledger WHERE user_id = ? AND kind = 'sensitive'", args: [user] })).rows.map((r) => ({ ...r }));
}

beforeEach(() => {
  m.getViewer.mockImplementation(async (r: Request) => {
    const id = r.headers.get("x-test-user");
    if (!id) return null;
    return {
      user: { id, email: `${id}@verdict.local`, name: "N", image: null },
      sessionId: `s-${id}`,
      via: r.headers.get("x-test-via") ?? "bearer",
      age: { confirmed: true, blocked: false },
    };
  });
  m.isSameOrigin.mockImplementation((r: Request) => !r.headers.get("x-test-cross"));
  m.checkUserLimits.mockResolvedValue({ ok: true });
});

describe("POST /api/v1/me/agreement", () => {
  it("needs a sign-in, a good body and a same-origin cookie", async () => {
    const body = { lang: "en", platform: "web" };
    expect((await post(body)).status).toBe(401);
    for (const bad of [{}, { lang: "xx", platform: "web" }, { lang: "en", platform: "pc" }, { ...body, extra: 1 }]) {
      const res = await post(bad, { user: "u-ag-bad" });
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect((await res.json()).code).toBe("invalid");
    }
    expect((await post(null, { user: "u-ag-bad", raw: "{" })).status).toBe(400);
    const cross = await post(body, { user: "u-ag-bad", via: "cookie", cross: true });
    expect(cross.status).toBe(403);
    expect((await cross.json()).code).toBe("bad_origin");
    expect(await ledger("u-ag-bad")).toHaveLength(0);
  });

  it("records one ledger row with the wording, language, platform and policy version", async () => {
    expect(await status("u-ag1")).toMatchObject({ sensitiveAgreed: false });
    const res = await post({ lang: "de", platform: "ios" }, { user: "u-ag1" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ agreed: true });
    const [row] = await ledger("u-ag1");
    expect(row).toMatchObject({
      kind: "sensitive",
      choice: "on",
      source: "card",
      policy_version: POLICY_VERSION,
      wording_key: "consent.sensitiveBody",
      lang: "de",
      platform: "ios",
      at: body.at,
    });
    expect(String(row.wording_text).length).toBeGreaterThan(20);
    expect(await status("u-ag1")).toMatchObject({ sensitiveAgreed: true });
  });

  it("falls back to the English wording and asks nothing a second time", async () => {
    const first = await (await post({ lang: "en", platform: "android" }, { user: "u-ag2" })).json();
    expect((await ledger("u-ag2"))[0].wording_text).toBe(SENSITIVE_AGREEMENT_EN);
    const again = await (await post({ lang: "tr", platform: "web" }, { user: "u-ag2" })).json();
    expect(again.at).toBe(first.at);
    expect(await ledger("u-ag2")).toHaveLength(1);
  });

  it("is separate from the training choice", async () => {
    await post({ lang: "en", platform: "web" }, { user: "u-ag3" });
    expect(await status("u-ag3")).toMatchObject({ state: "not_asked", sensitiveAgreed: true });
  });
});

describe("agreementRefusal", () => {
  it("refuses an account that has not agreed with 403 agreement_required, then lets it through", async () => {
    const refused = await actual.agreementRefusal("u-gate");
    expect(refused?.status).toBe(403);
    expect(await refused?.json()).toMatchObject({ code: "agreement_required" });
    await actual.recordSensitiveAgreement("u-gate", "en", "web");
    expect(await actual.agreementRefusal("u-gate")).toBeNull();
    expect(await actual.agreementRefusal("u-gate-other")).not.toBeNull();
  });

  it("answers 503, not a pass, when the lookup fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const db = await getDb();
    const spy = vi.spyOn(db, "execute").mockRejectedValueOnce(new Error("db down"));
    const res = await actual.agreementRefusal("u-gate-down");
    spy.mockRestore();
    expect(res?.status).toBe(503);
  });
});
