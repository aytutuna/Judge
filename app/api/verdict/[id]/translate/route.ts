import { NextResponse } from "next/server";
import { clientIp } from "@/lib/client-ip";
import type { Lang } from "@/lib/i18n";
import { verdictRemoved } from "@/lib/originals/removed";
import { checkTranslateLimits, type LimitDecision } from "@/lib/ratelimit";
import { translatedVerdict } from "@/lib/translate";
import type { TranslateResponse } from "@/lib/types";

export const runtime = "nodejs";
// One translation call (TRANSLATE_TIMEOUT_MS, 60s) plus database reads and
// the limit check, with headroom. A literal: Next reads it statically.
export const maxDuration = 90;

const UNAVAILABLE_MESSAGE = "Translation is unavailable right now — try again in a minute.";

function unavailable(): NextResponse {
  return NextResponse.json({ error: UNAVAILABLE_MESSAGE, code: "unavailable" }, { status: 503 });
}

function notFound(): NextResponse {
  return NextResponse.json({ error: "No verdict with that id.", code: "not_found" }, { status: 404 });
}

/** Share ids are nanoid(10); anything that could not be one is a 404
 * without a database read. */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

type Refusal = Exclude<LimitDecision, { ok: true }>;

/**
 * POST /api/verdict/[id]/translate?lang=en|tr
 * The verdict's content in `lang`: the original when it is already in that
 * language, a stored translation when there is one, else a new translation
 * (stored for everyone after). Only new translations pass the per-IP limit;
 * no Turnstile, since each pair costs one call ever.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/verdict/[id]/translate">) {
  const { id } = await ctx.params;
  const raw = new URL(req.url).searchParams.get("lang");
  if (raw !== "en" && raw !== "tr") {
    return NextResponse.json({ error: "lang must be en or tr", code: "invalid" }, { status: 400 });
  }
  const lang: Lang = raw;
  if (!ID_PATTERN.test(id)) return notFound();
  // A removed verdict is not translated (or served translated) any more.
  try {
    if (await verdictRemoved(id)) {
      return NextResponse.json(
        { error: "This verdict was removed. Its link no longer works.", code: "removed" },
        { status: 410, headers: { "Cache-Control": "no-store" } },
      );
    }
  } catch (e) {
    console.error("[translate] removed check failed:", e instanceof Error ? e.message : String(e));
    return unavailable();
  }

  const ip = clientIp(req.headers);
  let outcome;
  try {
    outcome = await translatedVerdict<Refusal>(id, lang, async () => {
      const limit = await checkTranslateLimits(ip);
      return limit.ok ? null : limit;
    });
  } catch (e) {
    console.error("[translate] failed:", e instanceof Error ? e.message : String(e));
    return unavailable();
  }

  switch (outcome.status) {
    case "not_found":
      return notFound();
    case "failed":
      return unavailable();
    case "gated": {
      const refusal = outcome.reason;
      if (refusal.code !== "rate_limited") return unavailable();
      return NextResponse.json(
        {
          error: "Too many translations from you — try again later.",
          code: "rate_limited",
          retryAfterSec: refusal.retryAfterSec,
        },
        { status: 429, headers: { "Retry-After": String(refusal.retryAfterSec) } },
      );
    }
    case "ok": {
      const body: TranslateResponse = {
        id,
        lang,
        source: outcome.source,
        translated: outcome.translated,
        result: outcome.result,
      };
      return NextResponse.json(body);
    }
  }
}
