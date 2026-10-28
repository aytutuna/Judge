import { afterEach, describe, expect, it, vi } from "vitest";

/** When the removal state cannot be read, the public reads answer 503
 * (no-store) instead of serving a verdict that may have been removed. */

const m = vi.hoisted(() => ({ getVerdictMeta: vi.fn() }));

vi.mock("@/lib/originals/db", () => ({ getVerdictMeta: m.getVerdictMeta }));
vi.mock("@/lib/originals/removed", () => ({ roundRoot: async () => null }));
vi.mock("@/lib/db", () => ({
  getVerdict: async (id: string) => ({
    id,
    input: "x",
    createdAt: "2026-10-20T00:00:00.000Z",
    result: {
      verdict: "side_b",
      dispute_type: "values",
      headline: "Party B is right",
      crux: "c",
      split_points: null,
      conditional: null,
      argument_map: { side_a: [], side_b: [], bedrock_a: "a", bedrock_b: "b" },
      facts_relied_on: [],
      losing_side_best_point: "p",
      confidence: 3,
      runs: ["side_b"],
      demo: false,
    },
  }),
}));

const route = await import("../app/api/v1/verdicts/[id]/route");
const og = await import("../app/v/[id]/opengraph-image");
const { getPublicVerdict } = await import("../lib/originals/display");

afterEach(() => {
  m.getVerdictMeta.mockReset();
  vi.restoreAllMocks();
});

describe("public verdict reads fail closed", () => {
  it("a failed ownership read throws, and the JSON and the preview image answer 503 no-store", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    m.getVerdictMeta.mockRejectedValue(new Error("SQLITE_BUSY: database is locked"));
    await expect(getPublicVerdict("abc123")).rejects.toThrow(/SQLITE_BUSY/);
    const res = await route.GET(new Request("http://localhost/api/v1/verdicts/abc123"), {
      params: Promise.resolve({ id: "abc123" }),
    } as never);
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const img = await og.default({ params: Promise.resolve({ id: "abc123" }) });
    expect(img.status).toBe(503);
    expect(img.headers.get("cache-control")).toBe("no-store");
  });

  it("a database without the originals tables yet still reads as an old verdict (labels, not removed)", async () => {
    m.getVerdictMeta.mockRejectedValue(new Error("SQLITE_ERROR: no such table: verdict_meta"));
    const found = await getPublicVerdict("abc124");
    expect(found).toMatchObject({ meta: null, display: null, removed: false });
  });
});
