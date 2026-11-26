// @vitest-environment happy-dom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHistory } from "../components/shell/useHistory";
import { ANSWERED_KEY } from "../lib/history-store";
import type { ViewerState } from "../lib/use-viewer";

const mocked = vi.hoisted(() => ({ link: vi.fn(), linkAll: vi.fn() }));
vi.mock("../lib/respondent-store", () => ({ linkStoredClaim: mocked.link, linkAllStoredClaims: mocked.linkAll }));

const row = {
  kind: "case",
  id: "case123",
  role: "respondent",
  party: "b",
  at: "2026-10-20T09:00:00.000Z",
  createdAt: "2026-10-20T09:00:00.000Z",
  state: "waiting",
  yourMove: false,
  verdict: null,
  contextAdded: false,
  contextBy: null,
  headline: "Rent",
  excerpt: null,
  nameMap: [],
  expiresAt: null,
  removed: false,
  removable: true,
  inviteToken: "T".repeat(22),
};

const signedOut = { status: "ready", me: null, config: null } as unknown as ViewerState;
const signedInAs = (id: string) => ({ status: "ready", me: { user: { id } }, config: null }) as unknown as ViewerState;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(ANSWERED_KEY, JSON.stringify([row]));
  mocked.link.mockReset();
  mocked.linkAll.mockReset().mockResolvedValue(false);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ rows: [], next: null }), { status: 200, headers: { "Content-Type": "application/json" } })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("answers given signed out in the Verdicts list", () => {
  it("are not removable while nobody is signed in", async () => {
    const { result } = renderHook(() => useHistory(signedOut));
    await waitFor(() => expect(result.current.items.some((i) => i.id === "case123")).toBe(true));
    expect(result.current.items.find((i) => i.id === "case123")?.removable).toBe(false);
  });

  it("claims whose row is gone are tried once after sign-in", async () => {
    localStorage.removeItem(ANSWERED_KEY);
    for (let mount = 0; mount < 2; mount++) {
      const { unmount } = renderHook(() => useHistory(signedInAs("u2")));
      await waitFor(() => expect(mocked.linkAll).toHaveBeenCalled());
      unmount();
    }
    expect(mocked.linkAll).toHaveBeenCalledTimes(1);
  });

  it("an unsettled claim is posted once per page load, however often the list mounts", async () => {
    mocked.link.mockResolvedValue("conflict");
    for (let mount = 0; mount < 3; mount++) {
      const { unmount } = renderHook(() => useHistory(signedInAs("u1")));
      await waitFor(() => expect(mocked.link).toHaveBeenCalled());
      await new Promise((r) => setTimeout(r, 10));
      unmount();
      expect(mocked.link.mock.calls.filter(([id]) => id === "case123").length).toBe(1);
    }
  });
});
