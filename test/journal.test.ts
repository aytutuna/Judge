import { describe, expect, it, vi } from "vitest";
import { tagJournalLevels } from "../lib/journal";

describe("tagJournalLevels", () => {
  it("prefixes errors and warnings with their syslog level", () => {
    const c = { error: vi.fn(), warn: vi.fn() };
    const { error, warn } = c;
    tagJournalLevels(c);
    c.error("[cases] load failed:", "timeout");
    c.warn("[anonymize] retry: %s", 2);
    expect(error).toHaveBeenCalledWith("<3>[cases] load failed: timeout");
    expect(warn).toHaveBeenCalledWith("<4>[anonymize] retry: 2");
  });
});
