import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PENDING_INVITE_MS,
  claimKey,
  loadClaim,
  parseClaim,
  parsePendingInvite,
  rememberPendingInvite,
  saveClaim,
  takePendingInvite,
} from "../lib/respondent-store";

const TOKEN = "AbCdEfGhIjKlMnOpQrStUv";

function fakeStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k: string) => data.get(k) ?? null,
    key: (i: number) => [...data.keys()][i] ?? null,
    removeItem: (k: string) => void data.delete(k),
    setItem: (k: string, v: string) => void data.set(k, String(v)),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("respondent claim storage", () => {
  it("keeps only well-formed claims, per case", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    expect(parseClaim(null)).toBeNull();
    expect(parseClaim("short")).toBeNull();
    expect(parseClaim(TOKEN)).toBe(TOKEN);
    saveClaim("case00000001", "not a claim");
    expect(loadClaim("case00000001")).toBeNull();
    saveClaim("case00000001", TOKEN);
    expect(localStorage.getItem(claimKey("case00000001"))).toBe(TOKEN);
    expect(loadClaim("case00000001")).toBe(TOKEN);
    expect(loadClaim("case00000002")).toBeNull();
  });
});

describe("pending invite across sign-in", () => {
  it("is taken once, and ignored when stale or malformed", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    const now = 1_800_000_000_000;
    rememberPendingInvite(TOKEN, now);
    expect(takePendingInvite(now + 1000)).toBe(TOKEN);
    expect(takePendingInvite(now + 2000)).toBeNull();
    rememberPendingInvite("bad/token", now);
    expect(takePendingInvite(now)).toBeNull();
    expect(parsePendingInvite(JSON.stringify({ token: TOKEN, at: now }), now + PENDING_INVITE_MS + 1)).toBeNull();
    expect(parsePendingInvite("{", now)).toBeNull();
    expect(parsePendingInvite(JSON.stringify({ token: 5, at: now }), now)).toBeNull();
  });

  it("survives a browser without storage", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    });
    rememberPendingInvite(TOKEN);
    expect(takePendingInvite()).toBeNull();
  });
});
