import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  emailConfigured: vi.fn(),
  sendCaseReadyEmail: vi.fn(),
  findUserById: vi.fn(),
  entitlementWriteBatch: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getAuth: async () => ({ $context: Promise.resolve({ internalAdapter: { findUserById: m.findUserById } }) }),
}));
vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  emailConfigured: m.emailConfigured,
  sendCaseReadyEmail: m.sendCaseReadyEmail,
}));
vi.mock("@/lib/entitlements", () => ({ entitlementWriteBatch: m.entitlementWriteBatch }));

import { caseReadyEmailContent } from "../lib/email";
import { notifyOwnerCaseReady } from "../lib/cases/notify";
import type { CaseRow } from "../lib/cases/db";

const ROW = { id: "case00000001", ownerId: "owner-1", lang: "tr" } as CaseRow;

beforeEach(() => {
  vi.resetAllMocks();
  m.findUserById.mockResolvedValue({ id: "owner-1", email: "owner@example.org" });
  m.entitlementWriteBatch.mockResolvedValue([{ rowsAffected: 1 }]);
  m.sendCaseReadyEmail.mockResolvedValue(undefined);
});

describe("notifyOwnerCaseReady", () => {
  it("does nothing when email is not configured", async () => {
    m.emailConfigured.mockReturnValue(false);
    await notifyOwnerCaseReady(ROW, "https://settle.example");
    expect(m.findUserById).not.toHaveBeenCalled();
    expect(m.sendCaseReadyEmail).not.toHaveBeenCalled();
  });

  it("claims the notice, then emails the owner a link to the case page in the case language", async () => {
    m.emailConfigured.mockReturnValue(true);
    await notifyOwnerCaseReady(ROW, "https://settle.example");
    expect(m.entitlementWriteBatch.mock.calls[0][0][0].sql).toMatch(/owner_notified = 1 WHERE id = \? AND owner_notified = 0/);
    expect(m.sendCaseReadyEmail).toHaveBeenCalledWith({
      to: "owner@example.org",
      url: "https://settle.example/c/case00000001",
      lang: "tr",
    });
  });

  it("sends nothing when the notice was already claimed, and never throws or logs the address", async () => {
    m.emailConfigured.mockReturnValue(true);
    m.entitlementWriteBatch.mockResolvedValue([{ rowsAffected: 0 }]);
    await notifyOwnerCaseReady(ROW, "https://settle.example");
    expect(m.sendCaseReadyEmail).not.toHaveBeenCalled();
    m.entitlementWriteBatch.mockResolvedValue([{ rowsAffected: 1 }]);
    m.sendCaseReadyEmail.mockRejectedValue(new Error("case email rejected: HTTP 500"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(notifyOwnerCaseReady(ROW, "https://settle.example")).resolves.toBeUndefined();
    expect(JSON.stringify(err.mock.calls)).not.toContain("owner@example.org");
    err.mockRestore();
  });
});

describe("caseReadyEmailContent", () => {
  it("names nobody, links the case and speaks Turkish with sen", () => {
    const en = caseReadyEmailContent("https://settle.example/c/abc", "en");
    expect(en.subject).toContain("Settle");
    expect(en.text).toContain("https://settle.example/c/abc");
    expect(en.html).toContain('href="https://settle.example/c/abc"');
    const tr = caseReadyEmailContent("https://settle.example/c/abc", "tr");
    expect(tr.text).toContain("sen başlattığın");
    expect(tr.html).not.toMatch(/\bsiz\b|iniz\b/);
  });
});
