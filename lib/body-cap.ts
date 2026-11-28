/**
 * Caps a request body by the bytes that actually arrive: Content-Length is
 * missing on a chunked body and can be false. Past `max` the body stream
 * fails, which stops whatever is reading it, and `exceeded()` says so, so the
 * caller can answer 413. Caddy did this on the VPS.
 */
export function capBody(request: Request, max: number): { request: Request; exceeded: () => boolean } {
  if (!request.body) return { request, exceeded: () => false };
  let seen = 0;
  let over = false;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > max) {
        over = true;
        controller.error(new Error("request body too large"));
        return;
      }
      controller.enqueue(chunk);
    },
  });
  const capped = new Request(request, { body: request.body.pipeThrough(counter), duplex: "half" } as RequestInit);
  return { request: capped, exceeded: () => over };
}
