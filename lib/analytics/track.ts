/**
 * Usage events, written to our own database (./db). Server only.
 *
 * The apps and the website send theirs to POST /api/v1/events while
 * `features.analytics` in GET /api/v1/config is true:
 *
 *   app_open
 *   screen_view         props: screen
 *   case_started
 *   case_submitted
 *   evidence_added
 *   question_answered
 *   verdict_viewed
 *   share_tapped
 *   buy_tapped          props: product
 *   purchase_completed
 *   sign_in_started     props: provider
 *   sign_in_completed
 *   settings_changed    props: key
 *   error_shown         props: code
 *
 * The server records its own with track(): case_created, verdict_ready,
 * verdict_failed, case_claimed, purchase_granted and sign_in. Clients cannot
 * send those names.
 */

import { analyticsEnabled } from "@/lib/features";
import { insertEvents, type Platform } from "./db";
import { propsProblem, type Props, type ServerEvent } from "./validate";

type TrackOptions = {
  userId: string | null;
  platform?: Platform;
  deviceId?: string | null;
  country?: string | null;
  props?: Props;
};

/** Records one event. Never throws: losing an event must not fail the flow
 * that sent it. */
export async function track(name: ServerEvent, opts: TrackOptions): Promise<void> {
  if (!analyticsEnabled()) return;
  try {
    const problem = opts.props ? propsProblem(opts.props) : null;
    if (problem) throw new Error(problem);
    await insertEvents([
      {
        at: Date.now(),
        userId: opts.userId,
        anonId: null,
        deviceId: opts.deviceId ?? null,
        platform: opts.platform ?? "server",
        appVersion: null,
        osVersion: null,
        deviceModel: null,
        country: opts.country ?? null,
        locale: null,
        name,
        props: opts.props ? JSON.stringify(opts.props) : null,
      },
    ]);
  } catch (e) {
    console.error(`[analytics] ${name} not recorded:`, e instanceof Error ? e.message : String(e));
  }
}
