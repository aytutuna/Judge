import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "verdict-devices-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;
process.env.BETTER_AUTH_SECRET = "test-secret-".padEnd(48, "x");
process.env.BETTER_AUTH_URL = "http://localhost:3600";

const auth = await import("../lib/auth");
const { createDevSession } = auth;
const { DELETE: deleteMe } = await import("../app/api/v1/me/route");
const { analyticsDb } = await import("../lib/analytics/db");
const { accountsOnDevice, noteSignIn } = await import("../lib/analytics/devices");

afterAll(() => {
  const g = globalThis as unknown as { __verdictLibsql?: { close(): void } };
  g.__verdictLibsql?.close();
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Left for the OS temp cleaner.
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function query(sql: string, args: (string | number)[] = []) {
  return (await (await analyticsDb()).execute({ sql, args })).rows;
}

const signalLines = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls.map((c: unknown[]) => String(c[0])).filter((l: string) => l.startsWith("[signal:many_accounts_per_device]"));

const headers = (deviceId: string, platform = "ios", extra: Record<string, string> = {}) =>
  new Headers({ "device-id": deviceId, "device-platform": platform, ...extra });

describe("account devices", () => {
  it("signals once a device signs in to its third account, and never refuses", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const device = "shared-device-0001";
    await noteSignIn("user-a", headers(device));
    await noteSignIn("user-b", headers(device));
    expect(signalLines(warn)).toEqual([]);
    await noteSignIn("user-c", headers(device));
    expect(signalLines(warn)).toEqual(["[signal:many_accounts_per_device] accounts=3 platform=ios"]);
    expect(await accountsOnDevice(device)).toBe(3);

    // A returning account on that device is not a new link: no new signal.
    await noteSignIn("user-a", headers(device));
    expect(signalLines(warn)).toHaveLength(1);
    await noteSignIn("user-d", headers(device));
    expect(signalLines(warn)).toHaveLength(2);
    expect(await accountsOnDevice(device)).toBe(4);
    expect(await accountsOnDevice("another-device-01")).toBe(0);
  });

  it("keeps first and last seen, the platform and the country", async () => {
    vi.stubEnv("CLOUDFLARE_PROXY", "1");
    await noteSignIn("user-e", headers("device-e-0001", "android", { "cf-ipcountry": "NL" }));
    const [first] = await query("SELECT * FROM account_devices WHERE user_id = 'user-e'");
    expect(first).toMatchObject({ device_id: "device-e-0001", platform: "android", country: "NL" });
    await new Promise((r) => setTimeout(r, 5));
    await noteSignIn("user-e", headers("device-e-0001", "android"));
    const [again] = await query("SELECT * FROM account_devices WHERE user_id = 'user-e'");
    expect(again.country).toBe("NL");
    expect(Number(again.first_seen)).toBe(Number(first.first_seen));
    expect(Number(again.last_seen)).toBeGreaterThan(Number(first.last_seen));
  });

  it("ignores a missing or malformed device, but still records the sign-in", async () => {
    await noteSignIn("user-f", undefined);
    await noteSignIn("user-f", headers("bad id!", "ios"));
    await noteSignIn("user-f", headers("device-f-0001", "symbian"));
    expect(await query("SELECT * FROM account_devices WHERE user_id = 'user-f'")).toHaveLength(0);
    const events = await query("SELECT platform, device_id FROM events WHERE user_id = 'user-f' AND name = 'sign_in'");
    expect(events).toHaveLength(3);
    expect(events.every((e) => e.platform === "server" && e.device_id === null)).toBe(true);
  });

  it("the session hook records the sign-in", async () => {
    const { user } = await createDevSession("signin1@verdict.local");
    expect(await query("SELECT * FROM events WHERE user_id = ? AND name = 'sign_in'", [user.id])).toHaveLength(1);
  });

  it("a real sign-in request with the device headers links the device", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "Judge <signin@verdict.example.org>");
    const mails: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        mails.push(String(JSON.parse(String(init?.body)).text));
        return new Response(JSON.stringify({ id: "x" }), { status: 200 });
      }),
    );
    const instance = await auth.getAuth();
    const post = (route: string, body: unknown, headers: Record<string, string> = {}) =>
      instance.handler(
        new Request(`http://localhost:3600/api/auth${route}`, {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify(body),
        }),
      );
    const email = "device-hook@example.org";
    expect((await post("/email-otp/send-verification-otp", { email, type: "sign-in" })).status).toBe(200);
    const otp = /\b(\d{6})\b/.exec(mails[0])?.[1];
    const res = await post(
      "/sign-in/email-otp",
      { email, otp },
      { "device-id": "hook-device-0001", "device-platform": "android" },
    );
    expect(res.status).toBe(200);
    const { user } = (await res.json()) as { user: { id: string } };
    const rows = await query("SELECT user_id, platform FROM account_devices WHERE device_id = 'hook-device-0001'");
    expect(rows).toEqual([expect.objectContaining({ user_id: user.id, platform: "android" })]);
  });
});

describe("account deletion", () => {
  it("deletes the account's events and unlinks its devices, keeping the per-device count", async () => {
    const { token, user } = await createDevSession("deleted1@verdict.local");
    const other = await createDevSession("kept1@verdict.local");
    await noteSignIn(user.id, headers("deleting-device-01"));
    await noteSignIn(user.id, headers("deleting-device-02"));
    await noteSignIn(other.user.id, headers("deleting-device-01"));
    expect(await accountsOnDevice("deleting-device-01")).toBe(2);

    const res = await deleteMe(
      new Request("http://localhost:3600/api/v1/me", {
        method: "DELETE",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ confirm: "delete" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await query("SELECT * FROM events WHERE user_id = ?", [user.id])).toHaveLength(0);
    expect(await query("SELECT * FROM account_devices WHERE user_id = ?", [user.id])).toHaveLength(0);
    expect(await query("SELECT * FROM events WHERE user_id = ?", [other.user.id])).not.toHaveLength(0);
    expect(await accountsOnDevice("deleting-device-01")).toBe(2);
    expect(await accountsOnDevice("deleting-device-02")).toBe(1);
    const placeholders = await query("SELECT user_id FROM account_devices WHERE device_id LIKE 'deleting-device-%'");
    expect(placeholders.filter((r) => String(r.user_id).startsWith("deleted:"))).toHaveLength(2);
  });
});
