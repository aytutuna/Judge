import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ fetchMe: vi.fn(), fetchConfig: vi.fn() }));
vi.mock("../lib/auth-client", () => ({ fetchMe: m.fetchMe, fetchConfig: m.fetchConfig }));

import { markSignedOut, refreshViewer, viewerSignedIn } from "../lib/use-viewer";

const ME = { user: { id: "u1", email: "a@b.c", name: "A", image: null }, entitlement: null };
const CONFIG = { signIn: { apple: true } };
const failure = (status?: number) => Object.assign(new Error("failed"), status ? { status } : {});

beforeEach(() => {
  markSignedOut();
  m.fetchMe.mockReset();
  m.fetchConfig.mockReset();
});

describe("refreshViewer", () => {
  it("keeps the signed-in state when a later refresh fails", async () => {
    m.fetchMe.mockResolvedValueOnce(ME);
    m.fetchConfig.mockResolvedValueOnce(CONFIG);
    await refreshViewer();
    expect(viewerSignedIn()).toBe(true);

    m.fetchMe.mockImplementationOnce(async () => {
      throw failure(503);
    });
    m.fetchConfig.mockImplementationOnce(async () => {
      throw failure();
    });
    await refreshViewer();
    expect(viewerSignedIn()).toBe(true);
  });

  it("signs out on a 401 from /me", async () => {
    m.fetchMe.mockResolvedValueOnce(ME);
    m.fetchConfig.mockResolvedValueOnce(CONFIG);
    await refreshViewer();

    m.fetchMe.mockImplementationOnce(async () => {
      throw failure(401);
    });
    m.fetchConfig.mockResolvedValueOnce(CONFIG);
    await refreshViewer();
    expect(viewerSignedIn()).toBe(false);
  });
});
