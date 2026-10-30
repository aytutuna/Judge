import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "verdict-devices-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;
process.env.BETTER_AUTH_SECRET = "test-secret-".padEnd(48, "x");
process.env.BETTER_AUTH_URL = "http://localhost:3600";

const { createDevSession } = await import("../lib/auth");
const { analyticsDb } = await import("../lib/analytics/db");
const { devicesSharingUser, noteSignIn } = await import("../lib/analytics/devices");

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
  vi.restoreAllMocks();
});

async function query(sql: string, args: (string | number)[] = []) {
  return (await (await analyticsDb()).execute({ sql, args })).rows;
}

const signalLines = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls.map((c: unknown[]) => String(c[0])).filter((l: string) => l.startsWith("[signal:many_accounts_per_device]"));

describe("account devices", () => {
  const headers = (deviceId: string, platform = "ios", extra: Record<string, string> = {}) =>
    new Headers({ "device-id": deviceId, "device-platform": platform, ...extra });

  it("signals once a device signs in to its third account, and never refuses", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const device = "shared-device-0001";
    await noteSignIn("user-a", headers(device));
    await noteSignIn("user-b", headers(device));
    expect(signalLines(warn)).toEqual([]);
    await noteSignIn("user-c", headers(device));
    expect(signalLines(warn)).toEqual(["[signal:many_accounts_per_device] accounts=3 platform=ios"]);
    expect(await devicesSharingUser(device)).toBe(3);

    // A returning account on that device is not a new link: no new signal.
    await noteSignIn("user-a", headers(device));
    expect(signalLines(warn)).toHaveLength(1);
    await noteSignIn("user-d", headers(device));
    expect(signalLines(warn)).toHaveLength(2);
    expect(await devicesSharingUser(device)).toBe(4);
    expect(await devicesSharingUser("another-device-01")).toBe(0);
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
});
