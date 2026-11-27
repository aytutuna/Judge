import { describe, expect, it } from "vitest";
import { parseOriginalsArgs, USAGE } from "../scripts/originals";

describe("export-account", () => {
  it("takes one user id", () => {
    expect(parseOriginalsArgs(["export-account", "u-123"])).toEqual({ kind: "export-account", id: "u-123" });
    expect(parseOriginalsArgs(["export-account"])).toEqual({ error: USAGE });
    expect(parseOriginalsArgs(["export-account", "u-123", "a"])).toEqual({ error: USAGE });
    expect(parseOriginalsArgs(["export-account", "../etc"])).toEqual({ error: USAGE });
  });
});
