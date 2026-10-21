import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  EvidencePicker,
  applyUploadResult,
  evidenceStatusText,
  type EvidenceItem,
} from "../components/case/EvidencePicker";
import type { EvidenceUploadResponse } from "../lib/case-types";
import { t } from "../lib/i18n";

const noop = () => {};
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;");

const item = (over: Partial<EvidenceItem>): EvidenceItem => ({
  id: "ev1",
  n: 1,
  name: "chat.png",
  thumb: null,
  status: "reading",
  token: null,
  preview: null,
  ...over,
});

function picker(items: EvidenceItem[], over: Partial<Parameters<typeof EvidencePicker>[0]> = {}): string {
  return renderToStaticMarkup(
    <EvidencePicker
      lang="en"
      max={3}
      items={items}
      full={items.length >= 3}
      failure={null}
      overLimit={false}
      onAdd={noop}
      onRemove={noop}
      {...over}
    />,
  );
}

describe("EvidencePicker", () => {
  it("empty: the add button, the accepted types and the never-kept note", () => {
    const html = picker([]);
    expect(html).toContain(t("en", "evidence.label"));
    expect(html).toContain(t("en", "evidence.add"));
    expect(html).toContain('accept="image/png,image/jpeg,image/webp,image/gif"');
    expect(html).toContain("multiple");
    expect(html).toContain(esc(t("en", "evidence.hint", { n: 3 })));
    expect(html).toContain("0 / 3");
  });

  it("one image only for appeals", () => {
    const html = picker([], { max: 1 });
    expect(html).toContain(t("en", "evidence.addOne"));
    expect(html).toContain(esc(t("en", "evidence.hintOne")));
    expect(html).not.toContain("multiple");
  });

  it("per-image status, labelled remove buttons and the uploader-only preview", () => {
    const html = picker([
      item({ id: "a", n: 1, status: "ok", token: "v1.x.y", preview: "21:02 ME: Did you pay?", thumb: "blob:1" }),
      item({ id: "b", n: 2, status: "reading" }),
      item({ id: "c", n: 3, status: "refused" }),
    ]);
    expect(html).toContain('aria-label="Remove image 1"');
    expect(html).toContain('aria-label="Remove image 3"');
    expect(html).toContain('alt="Image 1"');
    expect(html).toContain(t("en", "evidence.ok"));
    expect(html).toContain(t("en", "evidence.reading"));
    expect(html).toContain(t("en", "evidence.status.refused"));
    expect(html).toContain(t("en", "evidence.preview"));
    expect(html).toContain("21:02 ME: Did you pay?");
    // Full: the add button is disabled.
    expect(html).toMatch(/<button type="button" class="[^"]*" disabled="">/);
    // A polite live region reads the statuses.
    expect(html).toContain('aria-live="polite"');
  });

  it("whole-request failures are alerts, localized from the code", () => {
    const html = picker([], { failure: { body: { code: "too_large", error: "x" }, status: 413 } });
    expect(html).toContain('role="alert"');
    expect(html).toContain(esc(t("en", "error.too_large")));
  });

  it("says when more images were picked than fit", () => {
    expect(picker([], { overLimit: true })).toContain(esc(t("en", "evidence.limit")));
  });

  it("has a Turkish status for every state", () => {
    for (const s of ["reading", "ok", "unreadable", "refused", "unsupported", "too_large", "failed"] as const) {
      expect(evidenceStatusText("tr", s)).not.toBe(evidenceStatusText("en", s));
    }
  });
});

describe("applyUploadResult", () => {
  const items = [item({ id: "a" }), item({ id: "b", n: 2 }), item({ id: "c", n: 3, status: "ok", token: "keep" })];

  it("maps results by index onto the items that were sent", () => {
    const response: EvidenceUploadResponse = {
      items: [
        { index: 0, status: "ok", kind: "chat", token: "tok-a", preview: "p", expiresAt: "2026-10-20T15:00:00.000Z" },
        { index: 1, status: "unsupported", kind: null, token: null, preview: null, expiresAt: null },
      ],
    };
    const out = applyUploadResult(items, ["a", "b"], response);
    expect(out[0]).toMatchObject({ status: "ok", token: "tok-a", preview: "p" });
    expect(out[1]).toMatchObject({ status: "unsupported", token: null });
    expect(out[2]).toBe(items[2]);
  });

  it("marks sent items failed when the request failed or a result is missing", () => {
    expect(applyUploadResult(items, ["a", "b"], null).slice(0, 2).map((i) => i.status)).toEqual(["failed", "failed"]);
    const partial: EvidenceUploadResponse = {
      items: [{ index: 0, status: "ok", kind: "chat", token: null, preview: null, expiresAt: null }],
    };
    expect(applyUploadResult(items, ["a", "b"], partial).slice(0, 2).map((i) => i.status)).toEqual(["failed", "failed"]);
  });

  it("ignores results for items removed meanwhile", () => {
    const out = applyUploadResult([items[1]], ["a", "b"], {
      items: [
        { index: 0, status: "ok", kind: "chat", token: "tok-a", preview: "p", expiresAt: null },
        { index: 1, status: "ok", kind: "photo", token: "tok-b", preview: "q", expiresAt: null },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "b", token: "tok-b" });
  });
});
