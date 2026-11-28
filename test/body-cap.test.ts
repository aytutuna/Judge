import { describe, expect, it } from "vitest";
import { capBody } from "../lib/body-cap";

/** A request whose body arrives in `chunks` pieces of `size` bytes, with no Content-Length. */
function chunked(chunks: number, size: number): Request {
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent++ === chunks) return controller.close();
      controller.enqueue(new Uint8Array(size));
    },
  });
  return new Request("https://example.test/api/v1/evidence", { method: "POST", body, duplex: "half" } as RequestInit);
}

describe("capBody", () => {
  it("lets a body under the cap through whole", async () => {
    const capped = capBody(chunked(4, 1000), 10_000);
    expect((await capped.request.arrayBuffer()).byteLength).toBe(4000);
    expect(capped.exceeded()).toBe(false);
  });

  it("stops a chunked body at the cap and says it went over", async () => {
    const capped = capBody(chunked(30, 1000), 10_000);
    await expect(capped.request.arrayBuffer()).rejects.toThrow();
    expect(capped.exceeded()).toBe(true);
  });

  it("leaves a request without a body alone", () => {
    const get = new Request("https://example.test/api/health");
    expect(capBody(get, 10).request).toBe(get);
  });
});
