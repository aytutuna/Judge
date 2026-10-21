import { describe, expect, it } from "vitest";
import { mergeNameMaps, namesKey, parseStoredNames } from "../lib/case-names-store";
import { fitWithin, isAcceptedType, keepOriginal } from "../lib/image-downscale";
import { MAX_POLL_BACKOFF_MS, failedLoad, keyHolder, nextPollDelay, type CaseLoad } from "../lib/use-case";
import { OWNER } from "./ui-case-fixtures";

describe("case names store", () => {
  it("keys per case and party", () => {
    expect(namesKey("abc", "a")).toBe("settle.names.abc.a");
    expect(namesKey("abc", "b")).toBe("settle.names.abc.b");
  });

  it("merges a party's submissions in order, without duplicates", () => {
    const side = [
      { original: "I", replacement: "Party A" },
      { original: "Deniz", replacement: "Party B" },
    ];
    const appeal = [
      { original: "I", replacement: "Party A" },
      { original: "Sarah", replacement: "Person C" },
    ];
    expect(mergeNameMaps(side, appeal)).toEqual([...side, appeal[1]]);
  });

  it("reads broken or hostile storage as empty", () => {
    expect(parseStoredNames(null)).toEqual([]);
    expect(parseStoredNames("not json")).toEqual([]);
    expect(parseStoredNames('{"original":"x"}')).toEqual([]);
    expect(parseStoredNames('[{"original":"","replacement":"Party B"},{"original":1},null]')).toEqual([]);
    expect(parseStoredNames('[{"original":"Deniz","replacement":"Party B","extra":true}]')).toEqual([
      { original: "Deniz", replacement: "Party B" },
    ]);
    const many = JSON.stringify(Array.from({ length: 500 }, (_, i) => ({ original: `N${i}`, replacement: "Person C" })));
    expect(parseStoredNames(many).length).toBeLessThanOrEqual(60);
  });
});

describe("image downscale sizing", () => {
  it("fits the longest edge into 1600px, keeping the ratio", () => {
    expect(fitWithin(3200, 1600)).toEqual({ width: 1600, height: 800, scaled: true });
    expect(fitWithin(1179, 2556)).toEqual({ width: 738, height: 1600, scaled: true });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600, scaled: false });
    expect(fitWithin(1600, 1600).scaled).toBe(false);
  });

  it("keeps small PNG and GIF files as they are, re-encodes everything else", () => {
    expect(keepOriginal("image/png", 1000, 2000, 500_000)).toBe(false);
    expect(keepOriginal("image/png", 900, 1500, 500_000)).toBe(true);
    expect(keepOriginal("image/gif", 400, 400, 100_000)).toBe(true);
    expect(keepOriginal("image/png", 900, 1500, 6 * 1024 * 1024)).toBe(false);
    // JPEG and WebP are always re-encoded, which drops EXIF/GPS.
    expect(keepOriginal("image/jpeg", 400, 400, 10_000)).toBe(false);
    expect(keepOriginal("image/webp", 400, 400, 10_000)).toBe(false);
  });

  it("knows the accepted types", () => {
    expect(isAcceptedType("image/webp")).toBe(true);
    expect(isAcceptedType("image/heic")).toBe(false);
  });
});

describe("case polling", () => {
  it("polls only while the server asks for it, backing off on failures", () => {
    expect(nextPollDelay(null, 0)).toBeNull();
    expect(nextPollDelay(OWNER.awaiting, 0)).toBeNull();
    expect(nextPollDelay(OWNER.judging, 0)).toBe(3000);
    expect(nextPollDelay(OWNER.judging, 1)).toBe(6000);
    expect(nextPollDelay(OWNER.judging, 2)).toBe(12000);
    expect(nextPollDelay(OWNER.judging, 9)).toBe(MAX_POLL_BACKOFF_MS);
    expect(nextPollDelay({ ...OWNER.judging, pollAfterMs: 10 }, 0)).toBe(1000);
  });

  it("keeps the last view through a failed refresh, but not through a 404 or 401", () => {
    const ready: CaseLoad = { status: "ready", view: OWNER.judging, code: null };
    expect(failedLoad(ready, 503, "unavailable")).toEqual({ ...ready, code: "unavailable" });
    expect(failedLoad(ready, null, null).view).toBe(OWNER.judging);
    expect(failedLoad(ready, 404, "not_found")).toEqual({ status: "missing", view: null, code: "not_found" });
    expect(failedLoad(ready, 401, "signin_required").status).toBe("signin");
    expect(failedLoad({ status: "loading", view: null, code: null }, 500, null).status).toBe("error");
  });
});

describe("keyHolder", () => {
  it("reuses a key for the same body and makes a new one for another", () => {
    const keyFor = keyHolder();
    const a = keyFor('{"text":"a"}');
    expect(keyFor('{"text":"a"}')).toBe(a);
    const b = keyFor('{"text":"b"}');
    expect(b).not.toBe(a);
    expect(b).toMatch(/^[0-9a-f-]{32,36}$/);
  });
});
