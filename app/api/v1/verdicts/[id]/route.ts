import { NextResponse } from "next/server";
import { apiErrorBody } from "@/lib/api-errors";
import { clientIp } from "@/lib/client-ip";
import { getPublicVerdict } from "@/lib/originals/display";
import type { VerdictMeta } from "@/lib/originals/db";
import { checkIpLimits } from "@/lib/ratelimit";
import type { StoredVerdictResponse } from "@/lib/types";
import { getVerdictJob, failVerdictJob, isStale, maybeSweepVerdictJobs, type VerdictJob } from "@/lib/verdict-jobs";
import { POLL_AFTER_MS, type VerdictOwnerState, type VerdictPollResponse } from "@/lib/verdict-poll";

export const runtime = "nodejs";

/** Share ids are nanoid(10); anything that could not be one is a 404
 * without a database read (same rule as the translate route). */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const NO_STORE = { "Cache-Control": "no-store" } as const;

const FAILED_MESSAGES = {
  quota: "The judge hit its AI quota for now — try again in a few minutes.",
  unavailable: "The judge is unavailable right now — try again in a minute.",
  refused: "The judges declined to rule on this one.",
} as const;

function notFound(): NextResponse {
  return NextResponse.json(apiErrorBody("not_found", "No verdict with that id."), { status: 404 });
}

function unavailable(): NextResponse {
  return NextResponse.json(
    apiErrorBody("unavailable", "Verdicts are unavailable right now — try again in a minute."),
    { status: 503, headers: NO_STORE },
  );
}

/**
 * A verdict still judging or failed (async verdicts). Rate limited per IP;
 * a job judging past the stale mark is failed (and refunded) right here.
 */
async function jobAnswer(req: Request, job: VerdictJob): Promise<NextResponse> {
  try {
    const limit = await checkIpLimits(clientIp(req.headers), "verdict_poll");
    if (!limit.ok) {
      if (limit.code === "unavailable") return unavailable();
      return NextResponse.json(
        apiErrorBody("rate_limited", "Too many requests — take a breather and try again later.", {
          retryAfterSec: limit.retryAfterSec,
        }),
        { status: 429, headers: { ...NO_STORE, "Retry-After": String(limit.retryAfterSec) } },
      );
    }
  } catch {
    return unavailable();
  }
  let state: Pick<VerdictJob, "status" | "errorCode"> = job;
  if (isStale(job)) {
    await failVerdictJob(job.id, "unavailable", job.reservationId);
    state = (await getVerdictJob(job.id)) ?? { status: "failed", errorCode: "unavailable" };
  }
  void maybeSweepVerdictJobs();
  if (state.status === "judging") {
    const body: VerdictPollResponse = { id: job.id, status: "judging", pollAfterMs: POLL_AFTER_MS };
    return NextResponse.json(body, {
      headers: { ...NO_STORE, "Retry-After": String(Math.ceil(POLL_AFTER_MS / 1000)) },
    });
  }
  const code = state.errorCode ?? "unavailable";
  const body: VerdictPollResponse = { id: job.id, status: "failed", code, error: FAILED_MESSAGES[code] };
  return NextResponse.json(body, { headers: NO_STORE });
}

/** The writer's share-page state, only for the writer: the owner token in
 * X-Owner-Token, or the owning session. Undefined for everyone else, and
 * not looked up at all for a request without credentials. */
async function ownerState(req: Request, meta: VerdictMeta | null): Promise<VerdictOwnerState | undefined> {
  if (!meta || meta.kind === "case" || meta.removedAt) return undefined;
  const token = req.headers.get("x-owner-token")?.trim() || null;
  if (!token && !req.headers.has("authorization") && !req.headers.has("cookie")) return undefined;
  try {
    const { ownerTokenMatches } = await import("@/lib/originals/crypto");
    let mine = ownerTokenMatches(token, meta.ownerTokenHash);
    if (!mine && meta.ownerUserId) {
      const { getViewer } = await import("@/lib/auth");
      const viewer = await getViewer(req).catch(() => null);
      mine = viewer?.user.id === meta.ownerUserId;
    }
    if (!mine) return undefined;
    const [{ getOriginal, subjects }, { openVerdictDisplay }] = await Promise.all([
      import("@/lib/originals/db"),
      import("@/lib/originals/display"),
    ]);
    const original = await getOriginal(subjects.verdict(meta.verdictId));
    return {
      originals_stored: Boolean(original?.sealed),
      display: { ...openVerdictDisplay(meta), namesVisible: meta.namesVisible },
    };
  } catch (e) {
    console.error("[verdicts] owner state read failed:", e instanceof Error ? e.message : String(e));
    return undefined;
  }
}

/**
 * GET /api/v1/verdicts/{id}: a stored verdict, public like a share link,
 * with the display names the share page shows (null = the labels) and
 * `status: "ready"`. The stored input text is never returned. A removed
 * verdict answers 410. An async verdict still being judged answers
 * `{ status: "judging", pollAfterMs }`, a failed one
 * `{ status: "failed", code, error }` (both HTTP 200).
 */
export async function GET(req: Request, ctx: RouteContext<"/api/v1/verdicts/[id]">) {
  const { id } = await ctx.params;
  if (!ID_PATTERN.test(id)) return notFound();
  let found;
  try {
    // One primary-key read; a job that is ready falls through to the verdict.
    const job = await getVerdictJob(id);
    if (job && job.status !== "ready") return await jobAnswer(req, job);
    found = await getPublicVerdict(id);
  } catch (e) {
    console.error("[verdicts] read failed:", e instanceof Error ? e.message : String(e));
    return unavailable();
  }
  if (!found) return notFound();
  if (found.removed) {
    return NextResponse.json(apiErrorBody("removed", "This verdict was removed. Its link no longer works."), {
      status: 410,
      headers: NO_STORE,
    });
  }
  const { stored, display } = found;
  const owner = await ownerState(req, found.meta);
  const body: StoredVerdictResponse & { status: "ready"; owner?: VerdictOwnerState } = {
    id: stored.id,
    result: stored.result,
    createdAt: stored.createdAt,
    display,
    status: "ready",
    ...(owner ? { owner } : {}),
  };
  return NextResponse.json(body, { headers: NO_STORE });
}
