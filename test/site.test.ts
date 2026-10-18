import { describe, expect, it } from "vitest";
import { contactEmail, siteUrl } from "../app/site";

describe("siteUrl", () => {
  it("prefers NEXT_PUBLIC_SITE_URL and strips trailing slashes", () => {
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: "https://verdict.example/" })).toBe(
      "https://verdict.example",
    );
    expect(
      siteUrl({
        NEXT_PUBLIC_SITE_URL: " https://verdict.example ",
        VERCEL_PROJECT_PRODUCTION_URL: "other.vercel.app",
      }),
    ).toBe("https://verdict.example");
  });

  it("falls back to the Vercel production domain over https", () => {
    expect(siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: "verdict.vercel.app" })).toBe(
      "https://verdict.vercel.app",
    );
  });

  it("skips invalid or non-http values", () => {
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: "not a url" })).toBe("http://localhost:3000");
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: "ftp://verdict.example" })).toBe(
      "http://localhost:3000",
    );
  });

  it("defaults to localhost", () => {
    expect(siteUrl({})).toBe("http://localhost:3000");
  });
});

describe("contactEmail", () => {
  it("returns a configured address, trimmed", () => {
    expect(contactEmail({ CONTACT_EMAIL: " hello@verdict.app " })).toBe("hello@verdict.app");
  });

  it("hides unset, malformed and placeholder addresses", () => {
    for (const v of [undefined, "", "   ", "not-an-email", "a@b", "privacy@example.com", "x@EXAMPLE.org", "x@mail.example"]) {
      expect(contactEmail({ CONTACT_EMAIL: v })).toBeNull();
    }
  });
});
