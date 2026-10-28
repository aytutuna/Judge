import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  claudeJson: vi.fn(),
  getViewer: vi.fn(),
  isSameOrigin: vi.fn(),
  getEntitlement: vi.fn(),
  hasWelcomeCreditOnly: vi.fn(),
  checkUserLimits: vi.fn(),
  dbCalls: [] as string[],
  fsWrites: [] as string[],
}));

vi.mock("@/lib/claude", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/claude")>()),
  claudeJson: m.claudeJson,
}));
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  getViewer: m.getViewer,
  isSameOrigin: m.isSameOrigin,
  resolveViewer: async (req: Request) => ({ viewer: (await m.getViewer(req)) ?? null, deadBearer: false }),
  hasDeadBearer: async () => false,
}));
vi.mock("@/lib/entitlements", () => ({
  getEntitlement: m.getEntitlement,
  hasWelcomeCreditOnly: m.hasWelcomeCreditOnly,
}));
vi.mock("@/lib/ratelimit", () => ({ checkUserLimits: m.checkUserLimits }));
// Any database use from the upload path is recorded (and must never happen).
vi.mock("@/lib/db", () => ({
  getDb: () => {
    m.dbCalls.push("getDb");
    throw new Error("no database in the upload path");
  },
  saveVerdict: () => {
    m.dbCalls.push("saveVerdict");
    throw new Error("no database in the upload path");
  },
}));
// Every file-system write is recorded (and must never happen).
function spyWrites<T extends Record<string, unknown>>(actual: T, prefix: string): T {
  const out: Record<string, unknown> = { ...actual };
  for (const name of [
    "writeFile",
    "writeFileSync",
    "appendFile",
    "appendFileSync",
    "createWriteStream",
    "open",
    "openSync",
    "copyFile",
    "copyFileSync",
  ]) {
    const fn = actual[name];
    if (typeof fn === "function") {
      out[name] = (...args: unknown[]) => {
        m.fsWrites.push(`${prefix}${name}`);
        return (fn as (...a: unknown[]) => unknown)(...args);
      };
    }
  }
  return { ...out, default: out } as unknown as T;
}
vi.mock("node:fs", async (importOriginal) => spyWrites(await importOriginal<Record<string, unknown>>(), "fs."));
vi.mock("node:fs/promises", async (importOriginal) =>
  spyWrites(await importOriginal<Record<string, unknown>>(), "fs/promises."),
);

import { POST } from "../app/api/v1/evidence/route";
import { handleEvidenceUpload } from "../lib/evidence/upload";
import { verifyEvidenceTokens } from "../lib/evidence/token";
import type { EvidenceUploadResponse } from "../lib/case-types";
import { CHAT_TRANSCRIPT, gif, jpeg, png, textFile } from "./evidence-fixtures";

const USER = { type: "user", userId: "u1" } as const;
const ENTITLED = { canUsePremium: true, blockedReason: null, credits: 3, subscription: null, resetsAt: null };

function multipart(files: { bytes: Uint8Array; name?: string; type?: string }[], field = "image"): Request {
  const form = new FormData();
  for (const f of files) {
    form.append(field, new Blob([new Uint8Array(f.bytes)], { type: f.type ?? "image/png" }), f.name ?? "shot.png");
  }
  return new Request("http://localhost/api/v1/evidence", { method: "POST", body: form });
}

function jsonUpload(images: { data: string; mediaType?: string }[]): Request {
  return new Request("http://localhost/api/v1/evidence", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ images }),
  });
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("PREMIUM_ENABLED", "");
  vi.stubEnv("EVIDENCE_ENABLED", "");
  m.claudeJson.mockResolvedValue({ ok: true, data: structuredClone(CHAT_TRANSCRIPT) });
  m.getViewer.mockResolvedValue({ user: { id: "u1" }, via: "bearer", sessionId: "s" });
  m.isSameOrigin.mockReturnValue(true);
  m.getEntitlement.mockResolvedValue(ENTITLED);
  m.hasWelcomeCreditOnly.mockResolvedValue(false);
  m.checkUserLimits.mockResolvedValue({ ok: true });
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  m.dbCalls.length = 0;
  m.fsWrites.length = 0;
});

describe("handleEvidenceUpload", () => {
  it("transcribes a multipart image and returns a token the submission can verify", async () => {
    const res = await handleEvidenceUpload(multipart([{ bytes: png() }]), USER);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as EvidenceUploadResponse;
    expect(body.items).toHaveLength(1);
    const [item] = body.items;
    expect(item).toMatchObject({ index: 0, status: "ok", kind: "chat" });
    expect(item.preview).toBe(
      '[Chat screenshot · "Deniz"]\n21:02 ME: Did you pay the electricity bill?\n21:05 Deniz: No, it was your turn this month\nDescription: A messaging app chat screen.',
    );
    expect(verifyEvidenceTokens([item.token!], USER, 3)).toEqual({
      ok: true,
      items: [{ kind: "chat", transcript: item.preview }],
    });

    // The model got the image (media type from the bytes) before the text.
    const call = m.claudeJson.mock.calls[0][0];
    expect(call.images).toEqual([{ mediaType: "image/png", data: b64(png()) }]);
    expect(call.user).toBe("Transcribe this evidence image.");
    expect(call.model).toBe("claude-haiku-5-5");
    expect(call.effort).toBe("low");
  });

  it("never writes image bytes to disk or the database", async () => {
    await handleEvidenceUpload(multipart([{ bytes: png() }, { bytes: jpeg() }]), USER);
    await handleEvidenceUpload(jsonUpload([{ data: b64(gif()) }]), USER);
    expect(m.dbCalls).toEqual([]);
    expect(m.fsWrites).toEqual([]);
  });

  it("trusts the bytes, not the declared type", async () => {
    const res = await handleEvidenceUpload(multipart([{ bytes: jpeg(), type: "image/gif", name: "x.gif" }]), USER);
    expect((await res.json()).items[0].status).toBe("ok");
    expect(m.claudeJson.mock.calls[0][0].images[0].mediaType).toBe("image/jpeg");
  });

  it("reports each image on its own: unsupported, too large, refused, failed, unreadable", async () => {
    m.claudeJson
      .mockResolvedValueOnce({ ok: false, blocked: true, reason: "cyber" })
      .mockResolvedValueOnce({ ok: false, blocked: false, error: "Claude HTTP 500: x" });
    const first = await handleEvidenceUpload(
      multipart([{ bytes: textFile(), name: "fake.png" }, { bytes: png() }, { bytes: gif() }]),
      USER,
    );
    expect(((await first.json()) as EvidenceUploadResponse).items.map((i) => i.status)).toEqual([
      "unsupported",
      "refused",
      "failed",
    ]);

    m.claudeJson.mockResolvedValueOnce({ ok: true, data: { ...CHAT_TRANSCRIPT, kind: "unreadable", messages: [] } });
    m.claudeJson.mockResolvedValueOnce({ ok: true, data: { nonsense: true } });
    const big = new Uint8Array(6 * 1024 * 1024);
    big.set(png());
    const second = await handleEvidenceUpload(multipart([{ bytes: png() }, { bytes: png() }, { bytes: big }]), USER);
    const items = ((await second.json()) as EvidenceUploadResponse).items;
    expect(items.map((i) => i.status)).toEqual(["unreadable", "failed", "too_large"]);
    expect(items.every((i) => i.token === null && i.preview === null && i.kind === null)).toBe(true);
  });

  it("accepts JSON base64 (a data: prefix is tolerated)", async () => {
    const res = await handleEvidenceUpload(
      jsonUpload([{ data: b64(png()), mediaType: "image/png" }, { data: `data:image/gif;base64,${b64(gif())}` }]),
      USER,
    );
    const items = ((await res.json()) as EvidenceUploadResponse).items;
    expect(items.map((i) => i.status)).toEqual(["ok", "ok"]);
    expect(m.claudeJson.mock.calls[1][0].images[0].mediaType).toBe("image/gif");
  });

  it("says too_large for an oversized JSON image before decoding it", async () => {
    const res = await handleEvidenceUpload(jsonUpload([{ data: "A".repeat(7_500_000) }]), USER);
    expect(((await res.json()) as EvidenceUploadResponse).items[0].status).toBe("too_large");
    expect(m.claudeJson).not.toHaveBeenCalled();
  });

  it("refuses four images with too_many_files", async () => {
    const four = [png(), png(), png(), png()].map((bytes) => ({ bytes }));
    const res = await handleEvidenceUpload(multipart(four), USER);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("too_many_files");
    const json = await handleEvidenceUpload(jsonUpload(four.map((f) => ({ data: b64(f.bytes) }))), USER);
    expect(json.status).toBe(400);
    expect((await json.json()).code).toBe("too_many_files");
    expect(m.claudeJson).not.toHaveBeenCalled();
  });

  it("refuses a declared body over 16 MiB with 413 before reading it", async () => {
    const req = new Request("http://localhost/api/v1/evidence", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(17 * 1024 * 1024) },
      body: "{}",
    });
    const res = await handleEvidenceUpload(req, USER);
    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe("too_large");
  });

  it("stops reading a streamed body past 16 MiB", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1;
        if (sent > 20) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const req = new Request("http://localhost/api/v1/evidence", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit);
    const res = await handleEvidenceUpload(req, USER);
    expect(res.status).toBe(413);
    expect(sent).toBeLessThanOrEqual(18);
  });

  it("answers 415 for other content types and 400 for an empty or broken upload", async () => {
    const text = new Request("http://localhost/x", { method: "POST", headers: { "content-type": "text/plain" }, body: "hi" });
    expect((await handleEvidenceUpload(text, USER)).status).toBe(415);
    expect((await (await handleEvidenceUpload(multipart([{ bytes: png() }], "file"), USER)).json()).code).toBe("invalid");
    const broken = new Request("http://localhost/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{nope",
    });
    expect((await (await handleEvidenceUpload(broken, USER)).json()).code).toBe("invalid");
    expect((await (await handleEvidenceUpload(jsonUpload([]), USER)).json()).code).toBe("invalid");
  });
});

describe("POST /api/v1/evidence gates", () => {
  const upload = () => multipart([{ bytes: png() }]);

  it("is off with the kill switch or without Premium", async () => {
    vi.stubEnv("EVIDENCE_ENABLED", "0");
    expect((await (await POST(upload())).json()).code).toBe("not_configured");
    vi.stubEnv("EVIDENCE_ENABLED", "");
    vi.stubEnv("PREMIUM_ENABLED", "0");
    const res = await POST(upload());
    expect(res.status).toBe(503);
    expect(m.getViewer).not.toHaveBeenCalled();
  });

  it("needs a session, and same origin for cookie sessions", async () => {
    m.getViewer.mockResolvedValueOnce(null);
    expect((await POST(upload())).status).toBe(401);
    m.getViewer.mockResolvedValueOnce({ user: { id: "u1" }, via: "cookie", sessionId: "s" });
    m.isSameOrigin.mockReturnValueOnce(false);
    const res = await POST(upload());
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("bad_origin");
  });

  it("needs usable Premium, without spending anything", async () => {
    m.getEntitlement.mockResolvedValueOnce({ ...ENTITLED, canUsePremium: false, blockedReason: "no_credits" });
    const res = await POST(upload());
    expect(res.status).toBe(402);
    expect((await res.json()).code).toBe("no_credits");
    expect(m.checkUserLimits).not.toHaveBeenCalled();
    expect(m.claudeJson).not.toHaveBeenCalled();
  });

  it("applies the per-user evidence limit", async () => {
    m.checkUserLimits.mockResolvedValueOnce({ ok: false, code: "rate_limited", retryAfterSec: 30 });
    const res = await POST(upload());
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
    expect(m.checkUserLimits).toHaveBeenCalledWith("u1", "evidence");
    m.checkUserLimits.mockResolvedValueOnce({ ok: false, code: "unavailable", error: "x" });
    expect((await POST(upload())).status).toBe(503);
  });

  it("holds an account on its welcome credit alone to the welcome bucket", async () => {
    m.hasWelcomeCreditOnly.mockResolvedValueOnce(true);
    expect((await POST(upload())).status).toBe(200);
    expect(m.checkUserLimits).toHaveBeenCalledWith("u1", "welcome_evidence");
  });

  it("uploads for the signed-in user", async () => {
    const res = await POST(upload());
    expect(res.status).toBe(200);
    const token = ((await res.json()) as EvidenceUploadResponse).items[0].token!;
    expect(verifyEvidenceTokens([token], USER, 3).ok).toBe(true);
    expect(verifyEvidenceTokens([token], { type: "user", userId: "u2" }, 3).ok).toBe(false);
  });
});
