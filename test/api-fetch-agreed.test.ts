import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetchAgreed, setAgreementAsker } from "../lib/api-fetch";

const refused = () =>
  new Response(JSON.stringify({ error: "x", code: "agreement_required" }), { status: 403 });

describe("apiFetchAgreed", () => {
  afterEach(() => {
    setAgreementAsker(null);
    vi.unstubAllGlobals();
  });

  it("asks, then sends the request again once agreed", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(refused()).mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    setAgreementAsker(async () => true);
    const res = await apiFetchAgreed("/api/v1/verdict", { method: "POST", body: "{}" });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the refusal when the dialog is dismissed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(refused());
    vi.stubGlobal("fetch", fetchMock);
    setAgreementAsker(async () => false);
    const res = await apiFetchAgreed("/api/v1/verdict", { method: "POST" });
    expect(res.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("passes other 403s through without asking", async () => {
    const ask = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: "age_blocked" }), { status: 403 })));
    setAgreementAsker(ask);
    expect((await apiFetchAgreed("/api/v1/verdict")).status).toBe(403);
    expect(ask).not.toHaveBeenCalled();
  });
});
