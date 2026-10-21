/**
 * The async free verdict: after the route's synchronous gates and
 * anonymization, start a job, answer 202 and judge in the background.
 * The background run sees only the anonymized text; the text as written
 * and its name map are only sealed into the encrypted original at save,
 * exactly like the synchronous path. Server only.
 */

import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { getViewer, isSameOrigin } from "@/lib/auth";
import { runInBackground } from "@/lib/background";
import { judgeFreeAnonymized } from "@/lib/free-run";
import type { Lang } from "@/lib/i18n";
import { firstNameOf, type OriginalPayload } from "@/lib/originals-types";
import { newOwnerToken } from "@/lib/originals/crypto";
import type { FrameworkChoice, NameMapping } from "@/lib/types";
import { completeVerdictJob, createVerdictJob, failVerdictJob, maybeSweepVerdictJobs } from "@/lib/verdict-jobs";
import { POLL_AFTER_MS, RESPOND_ASYNC, type VerdictAcceptedResponse } from "@/lib/verdict-poll";

export type FreeJobInput = {
  id: string;
  anonymized: string;
  framework: FrameworkChoice;
  lang: Lang;
  ownerUserId: string | null;
  ownerToken: string | null;
  original: OriginalPayload;
};

/** The 202 headers every accepted verdict carries. */
export function acceptedHeaders(id: string): HeadersInit {
  return {
    "Cache-Control": "no-store",
    "Retry-After": String(Math.ceil(POLL_AFTER_MS / 1000)),
    Location: pollPath(id),
    "Preference-Applied": RESPOND_ASYNC,
  };
}

export function pollPath(id: string): string {
  return `/api/v1/verdicts/${id}`;
}

/** Judges and stores one free job. Never throws: every failure ends as a
 * failed job (or, if even that write fails, the sweep fails it later). */
export async function runFreeJob(job: FreeJobInput): Promise<void> {
  try {
    const judged = await judgeFreeAnonymized(job.anonymized, job.framework, job.lang);
    if (!judged.ok) {
      console.error(`[verdict] job ${job.id}: all judge runs failed:`, judged.detail);
      await failVerdictJob(job.id, judged.code, null);
      return;
    }
    const done = await completeVerdictJob(
      {
        id: job.id,
        input: job.anonymized,
        framework: job.framework,
        result: judged.result,
        kind: "free",
        ownerUserId: job.ownerUserId,
        original: job.original,
      },
      { ownerToken: job.ownerToken, reservationId: null, settle: "none" },
    );
    if (!done.stored) console.warn(`[verdict] job ${job.id} was no longer judging; nothing stored`);
  } catch (e) {
    console.error(`[verdict] job ${job.id} failed:`, e instanceof Error ? e.message : String(e));
    await failVerdictJob(job.id, "unavailable", null).catch((err: unknown) => {
      console.error(`[verdict] job ${job.id}: marking failed did not work:`, err instanceof Error ? err.message : String(err));
    });
  } finally {
    await maybeSweepVerdictJobs();
  }
}

/** Starts the job and answers 202, or 503 when the job cannot be written. */
export async function startFreeVerdictJob(
  req: Request,
  input: { anonymized: string; nameMap: NameMapping[]; framework: FrameworkChoice; lang: Lang; rawText: string },
): Promise<NextResponse> {
  // The writer, as on the synchronous path: a signed-in account (bearer, or
  // a same-origin cookie), else a one-time owner token handed out now and
  // bound to the verdict when it is stored.
  const viewer = await getViewer(req).catch(() => null);
  const ownerUserId = viewer && (viewer.via === "bearer" || isSameOrigin(req)) ? viewer.user.id : null;
  const ownerToken = ownerUserId ? null : newOwnerToken();
  const id = nanoid(10);
  try {
    await createVerdictJob({ id, kind: "free", ownerUserId });
  } catch (e) {
    console.error("[verdict] job create failed:", e instanceof Error ? e.message : String(e));
    return NextResponse.json(
      { error: "The judge is unavailable right now — try again in a minute.", code: "unavailable" },
      { status: 503 },
    );
  }
  runInBackground("verdict", () =>
    runFreeJob({
      id,
      anonymized: input.anonymized,
      framework: input.framework,
      lang: input.lang,
      ownerUserId,
      ownerToken,
      original: { v: 1, text: input.rawText, nameMap: input.nameMap },
    }),
  );
  const body: VerdictAcceptedResponse = {
    id,
    status: "judging",
    pollAfterMs: POLL_AFTER_MS,
    poll: pollPath(id),
    name_map: input.nameMap,
    ...(ownerToken ? { owner_token: ownerToken } : {}),
    suggested_display_a: ownerUserId ? firstNameOf(viewer?.user.name) : null,
  };
  return NextResponse.json(body, { status: 202, headers: acceptedHeaders(id) });
}
