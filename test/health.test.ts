import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ execute: vi.fn(), ensure: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: async () => ({ execute: m.execute }) }));

vi.mock("@/lib/entitlements", () => ({ ensureEntitlementTables: m.ensure }));

import { GET } from "../app/api/health/route";

const get = (query = "") => GET(new Request(`http://localhost/api/health${query}`));

beforeEach(() => {
  m.execute.mockReset();
  m.ensure.mockReset();
});

describe("GET /api/health", () => {
  it("answers ok without caching or touching the database", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true });
    expect(m.execute).not.toHaveBeenCalled();
    expect(m.ensure).not.toHaveBeenCalled();
  });

  it("?ready=1 runs SELECT 1 and answers ok", async () => {
    m.execute.mockResolvedValue({ rows: [] });
    const res = await get("?ready=1");
    expect(res.status).toBe(200);
    expect(m.execute).toHaveBeenCalledWith("SELECT 1");
    expect(m.ensure).toHaveBeenCalledTimes(1);
  });

  it("?ready=1 answers 503 when the entitlement migration fails", async () => {
    m.execute.mockResolvedValue({ rows: [] });
    m.ensure.mockRejectedValue(new Error("duplicate column"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await get("?ready=1");
    expect(res.status).toBe(503);
    err.mockRestore();
  });

  it("?ready=1 answers 503 when the database fails", async () => {
    m.execute.mockImplementation(async () => {
      throw new Error("no such table");
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await get("?ready=1");
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: false });
    err.mockRestore();
  });
});
