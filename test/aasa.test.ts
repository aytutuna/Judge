import { describe, expect, it } from "vitest";
import { GET } from "../app/.well-known/apple-app-site-association/route";

describe("apple-app-site-association", () => {
  it("is JSON naming the app and the case and invite paths", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    const body = await res.json();
    const detail = body.applinks.details[0];
    expect(detail.appIDs).toEqual(["8XT2U634Z4.com.okjudge.judge"]);
    expect(detail.components).toEqual([{ "/": "/c/*" }, { "/": "/r/*" }]);
    expect(detail.appID).toBe("8XT2U634Z4.com.okjudge.judge");
    expect(detail.paths).toEqual(["/c/*", "/r/*"]);
  });
});
