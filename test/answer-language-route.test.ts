import { beforeEach, describe, expect, it, vi } from "vitest";

const premiumVerdict = vi.hoisted(() => vi.fn());
vi.mock("@/lib/premium/handler", () => ({ clarifyHandler: vi.fn(), premiumVerdict }));

import { POST } from "../app/api/verdict/route";

const TURKISH =
  "Ev arkadaşım internet faturasının yarısını bana ödetmek istiyor ama ben evde olmadığım zamanlar için ödemeyeceğimizi konuşmuştuk.";
const ENGLISH =
  "My roommate says I owe him half of the internet bill, but we never agreed that I would pay for it when I was away.";

const SPANISH = "Mi compañero dice que le debo la mitad de la factura, pero nunca acordamos eso cuando yo estaba fuera.";

function post(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/verdict", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

function langSent(): string {
  return premiumVerdict.mock.calls.at(-1)![1].lang;
}

describe("POST /api/verdict language", () => {
  beforeEach(() => {
    premiumVerdict.mockReset().mockResolvedValue(new Response("{}"));
  });

  it("judges in the language of the argument, not the one the app sent", async () => {
    await post({ argument: TURKISH, lang: "en" });
    expect(langSent()).toBe("tr");
    await post({ argument: ENGLISH, lang: "tr" });
    expect(langSent()).toBe("en");
    await post({ argument: TURKISH });
    expect(langSent()).toBe("tr");
  });

  it("keeps the app language when the text is too short, mixed or in another language", async () => {
    await post({ argument: "Bill dispute over the rent again", lang: "de" });
    expect(langSent()).toBe("de");
    await post({ argument: `${ENGLISH} ${SPANISH}`, lang: "fr" });
    expect(langSent()).toBe("fr");
    await post({ argument: "Съквартирантът ми твърди, че му дължа половината от сметката за интернет.", lang: "es" });
    expect(langSent()).toBe("es");
  });

  it("passes the rest of the request through untouched", async () => {
    await post({ argument: TURKISH, lang: "en", clarifications: [{ question: "q", answer: "a" }] });
    expect(premiumVerdict.mock.calls[0][1]).toMatchObject({ argument: TURKISH, clarifications: [{ question: "q", answer: "a" }] });
  });
});
