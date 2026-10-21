import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  aad,
  generateOriginalsKey,
  newOwnerToken,
  openJson,
  openOrNull,
  OriginalsCryptoError,
  originalsKeyState,
  ownerTokenHash,
  ownerTokenMatches,
  sealJson,
} from "../lib/originals/crypto";

const KEY = randomBytes(32).toString("base64");
const OTHER = randomBytes(32).toString("base64");
const env = (over: Record<string, string | undefined> = {}) => ({ NODE_ENV: "test", ORIGINALS_KEY: KEY, ...over });

function code(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof OriginalsCryptoError ? e.code : "other";
  }
}

beforeEach(() => {
  const g = globalThis as unknown as { __judgeOriginalsKeyError?: boolean; __judgeOriginalsDevWarn?: boolean };
  g.__judgeOriginalsKeyError = false;
  g.__judgeOriginalsDevWarn = false;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sealJson / openJson", () => {
  it("round-trips JSON with names, in a v1 envelope that carries no plaintext", () => {
    const value = { v: 1, text: "Harry said I owe him £20 — Ayşe agrees", nameMap: [{ original: "Harry", replacement: "Party B" }] };
    const sealed = sealJson(value, aad.original("verdict:abc"), env());
    expect(sealed).not.toBeNull();
    expect(sealed!.sealed).toMatch(/^v1\.[0-9a-f]{8}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(sealed!.sealed).not.toContain("Harry");
    expect(openJson(sealed!.sealed, aad.original("verdict:abc"), env())).toEqual(value);
    // A fresh IV every time.
    expect(sealJson(value, aad.original("verdict:abc"), env())!.sealed).not.toBe(sealed!.sealed);
  });

  it("refuses a blob opened for another row or purpose (AAD), or tampered with", () => {
    const sealed = sealJson({ a: "Aytu" }, aad.verdictDisplay("v1"), env())!.sealed;
    expect(code(() => openJson(sealed, aad.verdictDisplay("v2"), env()))).toBe("corrupt");
    expect(code(() => openJson(sealed, aad.original("verdict:v1"), env()))).toBe("corrupt");
    const parts = sealed.split(".");
    const tag = Buffer.from(parts[4], "base64url");
    tag[0] ^= 1;
    const tampered = [...parts.slice(0, 4), tag.toString("base64url")].join(".");
    expect(code(() => openJson(tampered, aad.verdictDisplay("v1"), env()))).toBe("corrupt");
    const ct = Buffer.from(parts[3], "base64url");
    ct[0] ^= 1;
    const flipped = [parts[0], parts[1], parts[2], ct.toString("base64url"), parts[4]].join(".");
    expect(code(() => openJson(flipped, aad.verdictDisplay("v1"), env()))).toBe("corrupt");
    expect(code(() => openJson("not-a-blob", aad.verdictDisplay("v1"), env()))).toBe("corrupt");
  });

  it("decrypts with ORIGINALS_KEY_PREVIOUS after a rotation; an unknown key id is unknown_key", () => {
    const sealed = sealJson({ x: 1 }, "aad", env())!.sealed;
    const rotated = env({ ORIGINALS_KEY: OTHER, ORIGINALS_KEY_PREVIOUS: `garbage,${KEY}` });
    expect(openJson(sealed, "aad", rotated)).toEqual({ x: 1 });
    expect(code(() => openJson(sealed, "aad", env({ ORIGINALS_KEY: OTHER })))).toBe("unknown_key");
  });

  it("accepts base64url keys; rejects keys that are not 32 bytes", () => {
    const url = randomBytes(32).toString("base64url");
    expect(originalsKeyState(env({ ORIGINALS_KEY: url })).ok).toBe(true);
    expect(originalsKeyState(env({ ORIGINALS_KEY: randomBytes(16).toString("base64") }))).toEqual({ ok: false, reason: "invalid" });
    expect(originalsKeyState(env({ ORIGINALS_KEY: "not base64!" }))).toEqual({ ok: false, reason: "invalid" });
    expect(sealJson({}, "aad", env({ ORIGINALS_KEY: "short" }))).toBeNull();
    expect(Buffer.from(generateOriginalsKey(), "base64")).toHaveLength(32);
  });

  it("uses a development key outside production only, and never opens it with a real key", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const dev = { NODE_ENV: "development" };
    const state = originalsKeyState(dev);
    expect(state).toMatchObject({ ok: true, dev: true });
    const sealed = sealJson({ y: 2 }, "aad", dev)!.sealed;
    sealJson({ y: 3 }, "aad", dev);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/development key/);
    expect(openJson(sealed, "aad", dev)).toEqual({ y: 2 });
    expect(code(() => openJson(sealed, "aad", env()))).toBe("unknown_key");
  });

  it("production without a key stores nothing, logs one clear error per process, and never throws", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const prod = { NODE_ENV: "production" };
    expect(originalsKeyState(prod)).toEqual({ ok: false, reason: "missing" });
    expect(sealJson({ z: 1 }, "aad", prod)).toBeNull();
    expect(sealJson({ z: 2 }, "aad", prod)).toBeNull();
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toMatch(/ORIGINALS_KEY is missing or invalid/);
    // The log line carries no content.
    expect(String(error.mock.calls[0][0])).not.toContain('"z"');
    expect(code(() => openJson("v1.00000000.a.b.c", "aad", prod))).toBe("no_key");
    expect(originalsKeyState({ NODE_ENV: "production", ORIGINALS_KEY: KEY })).toMatchObject({ ok: true, dev: false });
  });

  it("openOrNull logs the subject and code only", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(openOrNull("v1.zz.a.b.c", "aad", "verdict:abc", env())).toBeNull();
    expect(error.mock.calls[0][0]).toBe("[originals] open failed subject=verdict:abc code=unknown_key");
    expect(openOrNull(null, "aad", "x", env())).toBeNull();
  });
});

describe("owner tokens", () => {
  it("are 43 base64url characters, stored as sha256 hex, compared in constant time", () => {
    const token = newOwnerToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const hash = ownerTokenHash(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(ownerTokenMatches(token, hash)).toBe(true);
    expect(ownerTokenMatches(newOwnerToken(), hash)).toBe(false);
    expect(ownerTokenMatches(`${token}x`, hash)).toBe(false);
    expect(ownerTokenMatches(null, hash)).toBe(false);
    expect(ownerTokenMatches(token, null)).toBe(false);
    expect(ownerTokenMatches(token, "nothex")).toBe(false);
  });
});
