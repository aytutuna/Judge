import { NextResponse, type NextRequest } from "next/server";
import { removedHtml } from "@/lib/removed-page";

/**
 * Removed verdicts answer their share page with HTTP 410 and a small "this
 * verdict was removed" page. Next has no way for a page to set a 410 itself,
 * so this runs in front of /v/<id> (Node runtime, the Proxy default). It
 * fails closed: when the check itself fails, the page answers 503 (no-store)
 * instead of rendering a verdict that may have been removed. The preview
 * image route answers 410 or 503 on its own and is not matched here.
 */
export const config = { matcher: ["/v/:id"] };

const ID = /^[A-Za-z0-9_-]{1,64}$/;

export async function proxy(req: NextRequest) {
  const id = req.nextUrl.pathname.split("/")[2] ?? "";
  if (!ID.test(id)) return NextResponse.next();
  try {
    // Loaded on first use: keeps the database client out of the proxy's
    // startup (a static import makes `next dev` reload pages in a loop).
    const { verdictRemoved } = await import("@/lib/originals/removed");
    if (await verdictRemoved(id)) return removedHtml(req);
  } catch (e) {
    console.error("[proxy] removed check failed:", e instanceof Error ? e.message : String(e));
    return removedHtml(req, "unavailable");
  }
  return NextResponse.next();
}
