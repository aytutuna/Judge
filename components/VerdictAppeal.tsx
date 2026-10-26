"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { Lang } from "@/lib/i18n";
import { ownerHeaders } from "@/lib/owner-store";
import type { NameMapping, StoredVerdictResponse, VerdictAppealView, VerdictResult } from "@/lib/types";
import { pollVerdict, type VerdictAppealResponse, type VerdictOwnerState } from "@/lib/verdict-poll";
import {
  AppealSection,
  appealArea,
  focusAppealForm,
  useAppealDraft,
  useAppealFinished,
  type AppealSubject,
} from "./case/AppealForm";

/** One verdict as a page shows it. */
export type ShownVerdict = { id: string; result: VerdictResult; createdAt: string };

type Rounds = { appeals: VerdictAppealView[]; appeal: NonNullable<VerdictOwnerState["appeal"]> };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The rounds and the writer's appeal state from GET /api/v1/verdicts/{id};
 * null for anyone but the writer, undefined when it could not be read. */
async function fetchRounds(id: string, token: string | null, signal: AbortSignal): Promise<Rounds | null | undefined> {
  try {
    const res = await fetch(`/api/v1/verdicts/${encodeURIComponent(id)}`, {
      cache: "no-store",
      signal,
      headers: { Accept: "application/json", ...ownerHeaders(token) },
    });
    if (!res.ok) return undefined;
    const json = (await res.json()) as StoredVerdictResponse & { owner?: VerdictOwnerState };
    if (json.id !== id) return undefined;
    return json.owner?.appeal ? { appeals: json.appeals ?? [], appeal: json.owner.appeal } : null;
  } catch {
    // Offline or aborted.
    return undefined;
  }
}

/** The writer's names plus the ones their rounds of context brought in. */
export function withRoundNames(base: NameMapping[] | undefined, added: NameMapping[]): NameMapping[] | undefined {
  if (added.length === 0) return base;
  const have = new Set((base ?? []).map((m) => m.replacement));
  return [...(base ?? []), ...added.filter((m) => !have.has(m.replacement))];
}

/**
 * "Add context" on a one-sided verdict, for its writer: the rounds from
 * GET /api/v1/verdicts/{id}, the case appeal's form and states
 * (case/AppealForm), and each new round's verdict polled in like an async
 * verdict. `verdicts` starts as what the page already shows (the first
 * verdict, then every judged round's, oldest first; the last is current)
 * and grows as rounds finish. Nothing is fetched until `enabled` (the
 * viewer is known to be the writer). `onAddContext` is the card's action
 * (undefined when there is nothing to offer); `panel` goes under the
 * verdict. A verdict written signed out is kept in the account (claimed)
 * as the context is sent.
 */
export function useVerdictAppeal({
  id,
  lang,
  token,
  enabled,
  initial,
  evidence,
}: {
  id: string;
  lang: Lang;
  token: string | null;
  enabled: boolean;
  initial: ShownVerdict[];
  /** Offer the screenshot picker (the deployment takes evidence). */
  evidence: boolean;
}): {
  verdicts: ShownVerdict[];
  names: NameMapping[];
  finished: boolean;
  onAddContext?: () => void;
  panel: ReactNode;
} {
  const [forId, setForId] = useState(id);
  const [verdicts, setVerdicts] = useState(initial);
  const [rounds, setRounds] = useState<Rounds | null>(null);
  const [names, setNames] = useState<NameMapping[]>([]);
  const [open, setOpen] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  if (forId !== id) {
    // A new verdict in the same page (the home page's next argument).
    setForId(id);
    setVerdicts(initial);
    setRounds(null);
    setNames([]);
    setOpen(false);
  }

  const load = useCallback(
    async (signal: AbortSignal) => {
      const next = await fetchRounds(id, token, signal);
      if (next !== undefined && !signal.aborted) setRounds(next);
    },
    [id, token],
  );

  useEffect(() => {
    if (!enabled || !id) return;
    const ctrl = new AbortController();
    void fetchRounds(id, token, ctrl.signal).then((next) => {
      if (next !== undefined && !ctrl.signal.aborted) setRounds(next);
    });
    return () => ctrl.abort();
  }, [enabled, id, token]);

  const judging = rounds?.appeals.find((a) => a.status === "judging")?.id ?? null;
  useEffect(() => {
    if (!judging) return;
    const ctrl = new AbortController();
    void (async () => {
      const outcome = await pollVerdict(judging, { fetch: (url, init) => fetch(url, init), sleep, signal: ctrl.signal });
      if (ctrl.signal.aborted) return;
      if (outcome.kind === "ready") {
        const next = { id: outcome.body.id, result: outcome.body.result, createdAt: outcome.body.createdAt };
        setVerdicts((v) => (v.some((x) => x.id === next.id) ? v : [...v, next]));
        setOpen(false);
      } else {
        // The form says it didn't go through (and that the credit is back).
        setOpen(true);
      }
      await load(ctrl.signal);
    })();
    return () => ctrl.abort();
  }, [judging, load]);

  useEffect(() => {
    if (focusTick > 0) focusAppealForm();
  }, [focusTick]);

  const claimFirst = async () => {
    const res = await fetch(`/api/v1/verdicts/${encodeURIComponent(id)}/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...ownerHeaders(token) },
      body: "{}",
    });
    if (!res.ok) throw new Error(`claim answered ${res.status}`);
  };
  const needsClaim = rounds?.appeal.blockedBy === "claim_required";
  const draft = useAppealDraft<VerdictAppealResponse>({
    endpoint: `/api/v1/verdicts/${encodeURIComponent(id)}/appeals`,
    lang,
    prepare: needsClaim ? claimFirst : undefined,
    onSent: (res) => {
      setNames((n) => [...n, ...(res.name_map ?? [])]);
      setRounds({ appeals: res.appeals, appeal: { allowed: false, blockedBy: "busy" } });
    },
  });

  const latest = rounds?.appeals.at(-1);
  const subject: AppealSubject | null = rounds
    ? {
        status: "judged",
        role: "owner",
        yourParty: "a",
        appeals: latest ? [{ party: "a", status: latest.status, error: latest.error }] : [],
        appeal: needsClaim ? { allowed: true, blockedBy: null } : rounds.appeal,
      }
    : null;
  const finished = useAppealFinished(subject) && latest?.status === "judged";
  const area = subject ? appealArea(subject) : null;
  const offer = area?.kind === "form" || area?.kind === "upsell" || area?.kind === "blocked";

  return {
    verdicts,
    names,
    finished,
    onAddContext: offer
      ? () => {
          setOpen(true);
          setFocusTick((n) => n + 1);
        }
      : undefined,
    panel:
      subject && (open || area?.kind === "judging") ? (
        <AppealSection
          lang={lang}
          view={subject}
          signInHref={`/signin?next=${encodeURIComponent(`/v/${id}`)}`}
          draft={draft}
          evidence={evidence}
          lead="appeal.leadVerdict"
        />
      ) : null,
  };
}
