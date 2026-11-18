import { beforeEach, describe, expect, it, vi } from "vitest";
import { removeItem, removeItems } from "../components/shell/history-remove";
import { fromRow, visibleItems } from "../components/shell/useHistory";
import type { HistoryRow } from "../lib/history-types";
import { t } from "../lib/i18n";

const mocked = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("../lib/api-fetch", () => ({ apiFetch: mocked.fetch }));

const row = (over: Partial<HistoryRow> & { id: string }): HistoryRow => ({
  kind: "verdict",
  role: "owner",
  party: "a",
  at: "2026-10-23T09:00:00.000Z",
  createdAt: "2026-10-23T09:00:00.000Z",
  state: "ready",
  yourMove: false,
  verdict: "side_a",
  contextAdded: false,
  contextBy: null,
  headline: "Title",
  excerpt: null,
  nameMap: [],
  expiresAt: null,
  removed: false,
  removable: true,
  inviteToken: null,
  ...over,
});

beforeEach(() => {
  mocked.fetch.mockReset();
  mocked.fetch.mockResolvedValue({ ok: true, status: 200 });
});

describe("hidden rows", () => {
  it("leaves out what the viewer removed and keeps what the other side removed", () => {
    const items = [
      row({ id: "own", kind: "case", state: "removed", removed: true, removable: false }),
      row({ id: "theirs", kind: "case", state: "removed_by_other", removed: true, removable: false }),
      row({ id: "kept" }),
    ].map(fromRow);
    expect(visibleItems(items).map((i) => i.id)).toEqual(["theirs", "kept"]);
  });
});

describe("removing rows", () => {
  it("posts a verdict to its removal route", async () => {
    expect(await removeItem(fromRow(row({ id: "v1" })))).toBe(true);
    const [path, init] = mocked.fetch.mock.calls[0];
    expect(path).toBe("/api/v1/verdicts/v1/removal");
    expect(JSON.parse(init.body)).toEqual({ confirm: "remove" });
  });

  it("posts an own case to the case route and an answered case to the invite route", async () => {
    await removeItem(fromRow(row({ id: "c1", kind: "case" })));
    expect(mocked.fetch.mock.calls[0][0]).toBe("/api/v1/cases/c1/removal");
    const token = "T".repeat(22);
    await removeItem(fromRow(row({ id: "c2", kind: "case", role: "respondent", party: "b", inviteToken: token })));
    expect(mocked.fetch.mock.calls[1][0]).toBe(`/api/v1/respond/${token}/removal`);
  });

  it("counts the failures when removing several, and carries on past them", async () => {
    mocked.fetch.mockResolvedValueOnce({ ok: false, status: 500 }).mockRejectedValueOnce(new Error("offline"));
    const items = ["a", "b", "c"].map((id) => fromRow(row({ id })));
    expect(await removeItems(items)).toBe(2);
    expect(mocked.fetch).toHaveBeenCalledTimes(3);
  });

  it("counts a row that is already gone as removed", async () => {
    mocked.fetch.mockResolvedValue({ ok: false, status: 404 });
    expect(await removeItem(fromRow(row({ id: "gone" })))).toBe(true);
  });
});

describe("remove all strings", () => {
  it("names the links, and says one for a single item", () => {
    expect(t("en", "shell.removeLinksConfirm", { n: 3 })).toBe("Remove 3 links? They stop working everywhere. This can't be undone.");
    expect(t("en", "shell.removeLinksConfirm", { n: 1 })).toMatch(/^Remove this link\?/);
    expect(t("en", "shell.removeConfirm", { n: 2 })).toMatch(/^Remove 2 verdicts/);
  });
});
