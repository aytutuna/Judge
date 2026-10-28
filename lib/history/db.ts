/**
 * The reads behind GET /api/v1/me/history. Four sources, each newest first
 * by (at, key) under the same cursor and capped by the caller, merged in
 * http.ts: stored one-sided verdicts, one-sided jobs with nothing stored
 * yet, cases the viewer started, cases the viewer answered. Server only.
 */

import type { InStatement, Row } from "@libsql/client";
import { mapCase, type CaseRow } from "@/lib/cases/db";
import type { AppealStatus, PartyLetter } from "@/lib/case-types";
import { getDb } from "@/lib/db";
import { VerdictResult } from "@/lib/types";
import { ensureVerdictJobTables } from "@/lib/verdict-jobs";

/** Rows strictly after the cursor in (at DESC, key DESC) order. */
export type Cursor = { at: string; key: string } | null;

const after = (cursor: Cursor) =>
  cursor
    ? { sql: "AND (h.at < ? OR (h.at = ? AND h.k < ?))", args: [cursor.at, cursor.at, cursor.key] }
    : { sql: "", args: [] as string[] };

function parseResult(raw: unknown): VerdictResult | null {
  if (raw == null) return null;
  try {
    const parsed = VerdictResult.safeParse(JSON.parse(String(raw)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const strOrNull = (v: unknown): string | null => (v == null ? null : String(v));

const jobStatus = (v: unknown): AppealStatus | null =>
  v == null ? null : String(v) === "ready" ? "judged" : String(v) === "failed" ? "failed" : "judging";

export type HistoryVerdictRow = {
  id: string;
  at: string;
  createdAt: string;
  removedAt: string | null;
  /** The ruling shown: the newest ready round's, else the verdict's own. */
  result: VerdictResult | null;
  fromRound: boolean;
  round: AppealStatus | null;
  sealed: string | null;
};

/** Stored one-sided verdicts the user owns, without the verdicts rounds of
 * added context produced. Sorted by when the verdict was asked for (its
 * job), so a verdict keeps its place when it finishes. */
function verdictsQuery(userId: string, limit: number, cursor: Cursor): InStatement {
  const c = after(cursor);
  // The newest round still open (no removal of its own) that has a verdict.
  const shown = `FROM verdict_appeals a JOIN verdicts av ON av.id = a.id
                   LEFT JOIN verdict_meta am ON am.verdict_id = a.id
                 WHERE a.verdict_id = m.verdict_id AND am.removed_at IS NULL
                 ORDER BY a.created_at DESC, a.id DESC LIMIT 1`;
  return {
    sql: `SELECT h.* FROM (
            SELECT m.verdict_id AS id, m.created_at, m.removed_at, o.sealed,
              COALESCE(j.created_at, m.created_at) AS at, 'v:' || m.verdict_id AS k,
              (SELECT a.id ${shown}) AS shown_round,
              COALESCE((SELECT av.result ${shown}), v.result) AS result,
              (SELECT rj.status FROM verdict_appeals a JOIN verdict_jobs rj ON rj.id = a.id
               WHERE a.verdict_id = m.verdict_id ORDER BY a.created_at DESC, a.id DESC LIMIT 1) AS round_status
            FROM verdict_meta m
            JOIN verdicts v ON v.id = m.verdict_id
            LEFT JOIN verdict_jobs j ON j.id = m.verdict_id
            LEFT JOIN originals o ON o.subject = 'verdict:' || m.verdict_id
            WHERE m.owner_user_id = ? AND m.kind IN ('free','premium')
              AND NOT EXISTS (SELECT 1 FROM verdict_appeals a WHERE a.id = m.verdict_id)
          ) h WHERE 1 = 1 ${c.sql}
          ORDER BY h.at DESC, h.k DESC LIMIT ?`,
    args: [userId, ...c.args, limit],
  };
}

function mapVerdict(r: Row): HistoryVerdictRow {
  return {
    id: String(r.id),
    at: String(r.at),
    createdAt: String(r.created_at),
    removedAt: strOrNull(r.removed_at),
    result: parseResult(r.result),
    fromRound: r.shown_round != null,
    round: jobStatus(r.round_status),
    sealed: strOrNull(r.sealed),
  };
}

export type HistoryJobRow = { id: string; status: "judging" | "failed"; at: string };

/** The user's one-sided verdicts still being judged, and the ones that
 * failed since `failedSince` (nothing was stored for them). Rounds of added
 * context are not listed: they show on their verdict's row. */
function jobsQuery(userId: string, failedSince: string, limit: number, cursor: Cursor): InStatement {
  const c = after(cursor);
  return {
    sql: `SELECT h.* FROM (
            SELECT j.id, j.status, j.created_at AS at, 'v:' || j.id AS k
            FROM verdict_jobs j
            WHERE j.owner_user_id = ?
              AND (j.status = 'judging' OR (j.status = 'failed' AND j.updated_at > ?))
              AND NOT EXISTS (SELECT 1 FROM verdict_appeals a WHERE a.id = j.id)
              AND NOT EXISTS (SELECT 1 FROM verdict_meta m WHERE m.verdict_id = j.id)
          ) h WHERE 1 = 1 ${c.sql}
          ORDER BY h.at DESC, h.k DESC LIMIT ?`,
    args: [userId, failedSince, ...c.args, limit],
  };
}

function mapJob(r: Row): HistoryJobRow {
  return {
    id: String(r.id),
    status: String(r.status) === "failed" ? "failed" : "judging",
    at: String(r.at),
  };
}

export type HistoryCaseRow = CaseRow & {
  at: string;
  appeals: { id: string; party: PartyLetter; status: AppealStatus }[];
  /** The newest case verdict: its appeal and its result (null when it no longer parses). */
  latestAppealId: string | null;
  latestResult: VerdictResult | null;
  /** The start of the viewer's own anonymized side. */
  sideStart: string | null;
};

function mapHistoryCase(r: Row): HistoryCaseRow {
  let appeals: HistoryCaseRow["appeals"] = [];
  try {
    const raw = JSON.parse(String(r.appeals_json ?? "[]")) as { id: string; party: string; status: string }[];
    appeals = raw.map((a) => ({
      id: String(a.id),
      party: a.party === "b" ? "b" : "a",
      status: a.status === "judged" ? "judged" : a.status === "failed" ? "failed" : "judging",
    }));
  } catch {
    appeals = [];
  }
  return {
    ...mapCase(r),
    at: String(r.at),
    appeals,
    latestAppealId: strOrNull(r.latest_appeal),
    latestResult: parseResult(r.latest),
    sideStart: strOrNull(r.side_start),
  };
}

function caseColumns(party: PartyLetter): string {
  return `(SELECT json_group_array(json_object('id', a.id, 'party', a.party, 'status', a.status))
             FROM case_appeals a WHERE a.case_id = c.id) AS appeals_json,
           (SELECT cv.appeal_id FROM case_verdicts cv WHERE cv.case_id = c.id ORDER BY cv.seq DESC LIMIT 1) AS latest_appeal,
           (SELECT v.result FROM case_verdicts cv JOIN verdicts v ON v.id = cv.verdict_id
             WHERE cv.case_id = c.id ORDER BY cv.seq DESC LIMIT 1) AS latest,
           (SELECT substr(s.text, 1, 200) FROM case_sides s WHERE s.case_id = c.id AND s.party = '${party}') AS side_start`;
}

/** Cases the user started, by when they started them. */
function ownerCasesQuery(userId: string, limit: number, cursor: Cursor): InStatement {
  const c = after(cursor);
  return {
    sql: `SELECT h.* FROM (
            SELECT c.*, c.created_at AS at, 'c:' || c.id AS k, ${caseColumns("a")}
            FROM cases c WHERE c.owner_id = ?
          ) h WHERE 1 = 1 ${c.sql}
          ORDER BY h.at DESC, h.k DESC LIMIT ?`,
    args: [userId, ...c.args, limit],
  };
}

/** Cases whose side B is bound to the user, by when they answered. */
function answeredCasesQuery(userId: string, limit: number, cursor: Cursor): InStatement {
  const c = after(cursor);
  return {
    sql: `SELECT h.* FROM (
            SELECT c.*, s.submitted_at AS at, 'c:' || c.id AS k, ${caseColumns("b")}
            FROM cases c JOIN case_sides s ON s.case_id = c.id AND s.party = 'b'
            WHERE c.respondent_user_id = ? AND c.owner_id <> ?
          ) h WHERE 1 = 1 ${c.sql}
          ORDER BY h.at DESC, h.k DESC LIMIT ?`,
    args: [userId, userId, ...c.args, limit],
  };
}

export type HistorySources = {
  verdicts: HistoryVerdictRow[];
  jobs: HistoryJobRow[];
  started: HistoryCaseRow[];
  answered: HistoryCaseRow[];
};

/** All four sources, each capped at `limit`, read in one transaction: a job
 * finishing between two separate reads would list its verdict twice or not
 * at all. */
export async function historySources(
  userId: string,
  opts: { failedSince: string; limit: number; cursor: Cursor; cases: boolean },
): Promise<HistorySources> {
  await ensureVerdictJobTables();
  const db = await getDb();
  const { failedSince, limit, cursor, cases } = opts;
  const stmts = [verdictsQuery(userId, limit, cursor), jobsQuery(userId, failedSince, limit, cursor)];
  if (cases) stmts.push(ownerCasesQuery(userId, limit, cursor), answeredCasesQuery(userId, limit, cursor));
  const [v, j, s, a] = await db.batch(stmts, "read");
  return {
    verdicts: v.rows.map(mapVerdict),
    jobs: j.rows.map(mapJob),
    started: s ? s.rows.map(mapHistoryCase) : [],
    answered: a ? a.rows.map(mapHistoryCase) : [],
  };
}
