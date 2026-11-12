import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: async () => ({ execute: m.execute }) }));

import { GET } from "../app/api/health/route";

const get = (query = "") => GET(new Request(`http://localhost/api/health${query}`));

beforeEach(() => {
  m.execute.mockReset();
});

describe("GET /api/health", () => {
  it("answers ok without caching or touching the database", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true });
    expect(m.execute).not.toHaveBeenCalled();
  });

  it("?ready=1 runs SELECT 1 and answers ok", async () => {
    m.execute.mockResolvedValue({ rows: [] });
    const res = await get("?ready=1");
    expect(res.status).toBe(200);
    expect(m.execute).toHaveBeenCalledWith("SELECT 1");
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
