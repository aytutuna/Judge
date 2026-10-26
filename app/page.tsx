"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CaseModeSwitch, type CaseMode } from "@/components/case/CaseModeSwitch";
import { EvidencePicker, useEvidence } from "@/components/case/EvidencePicker";
import { ClarifyStep, buildClarifications, type ClarifyQuestion } from "@/components/ClarifyStep";
import { JudgingOverlay } from "@/components/JudgingOverlay";
import { restoredHeadline } from "@/components/account/VerdictList";
import { Recent } from "@/components/home/Recent";
import JudgingScene from "@/components/scene/JudgingScene";
import { AppShell } from "@/components/shell/AppShell";
import { refreshHistory, useHistory } from "@/components/shell/useHistory";
import { Composer, NextSteps } from "@/components/thread/Composer";
import { Thread } from "@/components/thread/Thread";
import styles from "@/components/thread/thread.module.css";
import { TierSwitch } from "@/components/TierSwitch";
import { Turnstile, TURNSTILE_SITE_KEY } from "@/components/Turnstile";
import { VerdictView } from "@/components/VerdictView";
import { useVerdictAppeal, withRoundNames } from "@/components/VerdictAppeal";
import { VerdictHistory } from "@/components/case/VerdictHistory";
import { MAX_EVIDENCE_PER_SIDE, type CreateCaseResponse } from "@/lib/case-types";
import { saveCaseNames } from "@/lib/case-names-store";
import { verdictLang } from "@/lib/content-lang";
import { firstNameOf, type DisplayState, type MineResponse } from "@/lib/originals-types";
import { ownerTokenIds, saveOwnerToken } from "@/lib/owner-store";
import { buildOwnerShare } from "@/components/ShareDialog";
import { clearDraft, registerDraftSource, takeDraft } from "@/lib/draft";
import { DEFAULT_FRAMEWORK } from "@/lib/frameworks";
import { addHistory, dropHistory, startHistory } from "@/lib/history-store";
import { apiErrorMessage, t, type Key } from "@/lib/i18n";
import { useLang } from "@/lib/lang";
import { resetScene } from "@/lib/scene-bridge";
import { MAX_FINISH_MS } from "@/lib/thinking";
import { judgesLabel } from "@/lib/verdict-display";
import { effectiveTier, setTierChoice, signInOffered, tierAvailability, useTierChoice } from "@/lib/tier";
import type {
  Clarification,
  ClarifyResponse,
  FrameworkChoice,
  VerdictApiResponse,
  VerdictResponse,
} from "@/lib/types";
import { applyEntitlement, refreshViewer, useViewer } from "@/lib/use-viewer";
import { pollVerdict, RESPOND_ASYNC, type VerdictAcceptedResponse } from "@/lib/verdict-poll";

/** A new Idempotency-Key. randomUUID needs a secure context; plain-http
 * hosts fall back to getRandomValues. */
function idempotencyKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Account-side failures: the viewer's entitlement is stale, refetch it. */
const ACCOUNT_STATUSES = new Set([401, 402]);

/** While the server answers 409 in_progress (the same request is still being
 * judged, e.g. after a dropped connection), ask again every few seconds
 * until it replays the finished verdict, for at most the route's 300s. */
const IN_PROGRESS_POLL_MS = 4000;
const IN_PROGRESS_WAIT_MS = 300_000;

/** Verdict requests ask for the async flow: the server answers 202 once the
 * text is anonymized and the page polls for the verdict, so a long verdict
 * never hits the proxy's request time limit. */
const ASYNC_HEADERS = { Prefer: RESPOND_ASYNC } as const;

/** Waits `ms`, or less when the tab is shown again or the network comes
 * back: background tabs throttle timers, and a returning visitor should
 * not wait out a stretched delay. */
function wakefulSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", done);
      resolve();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") done();
    };
    const timer = setTimeout(done, ms);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", done);
  });
}

/** What a premium request judges, fixed when it is submitted. `evidence`
 * holds signed screenshot tokens; empty keeps the request exactly as before. */
type PremiumInput = { argument: string; framework: FrameworkChoice; evidence: string[] };

/** Signed-in screenshot uploads (the respondent's page uses its own). */
const EVIDENCE_ENDPOINT = "/api/v1/evidence";

/** "clarify": premium only, the thread holds the clarifying questions. */
type Phase = "intake" | "clarify" | "judging" | "verdict";

export default function Home() {
  const lang = useLang();
  // The composer's text, and the argument in the thread once it is sent
  // (null: the empty state). A failed request puts the text back.
  const [argument, setArgument] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [options, setOptions] = useState(false);
  const [framework, setFramework] = useState<FrameworkChoice>(DEFAULT_FRAMEWORK);
  const [phase, setPhase] = useState<Phase>("intake");
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<VerdictResponse | null>(null);
  // The writer's share-page names after they edit them (else the response's).
  const [ownerDisplay, setOwnerDisplay] = useState<DisplayState | null>(null);
  // Two-sided: the owner's name on the case's share pages (prefilled from
  // the account's first name until they type).
  const [caseName, setCaseName] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  // Premium only.
  const viewer = useViewer();
  const history = useHistory(viewer);
  const [now] = useState(Date.now);
  const tierChoice = useTierChoice();
  const [checking, setChecking] = useState(false);
  const [questions, setQuestions] = useState<ClarifyQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [judgingPremium, setJudgingPremium] = useState(false);
  const premiumInput = useRef<PremiumInput | null>(null);
  // One key per exact premium request (input, language, answers): a retry
  // of the same request reuses it, so the server replays or waits instead
  // of charging again. A success or a different request gets a new key.
  const premiumKey = useRef<{ request: string; key: string } | null>(null);
  // Screenshot evidence (Premium) and two-sided cases (any account), each
  // only when this deployment offers it (GET /api/v1/config `features`).
  const router = useRouter();
  const [caseMode, setCaseMode] = useState<CaseMode>("now");
  const [creating, setCreating] = useState(false);
  const evidence = useEvidence(EVIDENCE_ENDPOINT, MAX_EVIDENCE_PER_SIDE);
  // The current argument. "New argument" or leaving the page aborts it:
  // the clarify check is cancelled, while a verdict or case already sent
  // runs to the end so its owner token and history entry are kept, just
  // without touching the screen any more.
  const thread = useRef<AbortController | null>(null);

  const availability = tierAvailability(viewer.config, viewer.me);
  const tier = effectiveTier(availability, tierChoice);
  const premium = tier === "premium";
  const features = viewer.config?.features;
  const evidenceOn = premium && features?.evidence === true;
  // Two-sided cases need an account, not Premium. Signed out, the switch is
  // shown locked behind sign-in.
  const signedIn = Boolean(viewer.me?.user);
  const casesOn = signedIn && features?.cases === true;
  const casesLocked = !signedIn && features?.cases === true && signInOffered(viewer.config);
  const twoSided = casesOn && caseMode === "both";
  const holding = checking || creating;

  // Belt and braces: if the judging animation has not handed off shortly
  // after the response arrived, show the verdict anyway.
  useEffect(() => {
    if (phase !== "judging" || response === null) return;
    const t = setTimeout(() => setPhase("verdict"), MAX_FINISH_MS + 2000);
    return () => clearTimeout(t);
  }, [phase, response]);

  // Leaving the page stops anything still running from touching it.
  useEffect(
    () => () => {
      thread.current?.abort();
    },
    [],
  );

  function threadSignal(): AbortSignal {
    thread.current ??= new AbortController();
    return thread.current.signal;
  }

  // A draft saved on the way to /signin comes back once. sessionStorage
  // does not exist during server rendering, so it is read after mount.
  useEffect(() => {
    const draft = takeDraft();
    if (!draft) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of browser storage
    setArgument(draft.argument);
    setFramework(draft.framework);
  }, []);

  // The index has to exist before the first addHistory, or the verdicts
  // this browser wrote before it would never be queued for My verdicts.
  useEffect(() => startHistory(ownerTokenIds()), []);

  // What a sign-in link saves: only an unsent argument.
  useEffect(
    () =>
      registerDraftSource(() =>
        phase === "intake" || phase === "clarify" ? { argument: sent ?? argument, framework } : null,
      ),
    [argument, sent, framework, phase],
  );

  const shownCaseName = caseName ?? firstNameOf(viewer.me?.user?.name) ?? "";
  const owner =
    response?.display && response.originals_stored
      ? buildOwnerShare({
          verdictId: response.id,
          token: response.owner_token ?? null,
          display: ownerDisplay ?? response.display,
          suggestedA: response.suggested_display_a ?? null,
          nameMap: response.name_map,
          lang: verdictLang(response.result),
          namesConfirmed: ownerDisplay !== null,
          onSaved: setOwnerDisplay,
        })
      : undefined;

  // The writer can add context to the verdict they just got.
  const appeal = useVerdictAppeal({
    id: response?.id ?? "",
    lang,
    token: response?.owner_token ?? null,
    enabled: phase === "verdict",
    initial: response ? [{ id: response.id, result: response.result, createdAt: "" }] : [],
    evidence: features?.evidence === true,
  });
  const shown = appeal.verdicts.at(-1) ?? null;
  const roundNames = withRoundNames(response?.name_map, appeal.names);

  // Premium and cases skip the human check: the signed-in account is the gate.
  const needsToken = TURNSTILE_SITE_KEY !== "" && !premium && !twoSided;
  const canSubmit =
    argument.trim().length >= 20 &&
    !holding &&
    !(evidenceOn && evidence.busy) &&
    (!needsToken || turnstileToken !== null);

  async function submit() {
    // Turnstile tokens are single-use: take it now, and the widget remounts
    // with a fresh one whenever the form comes back.
    const token = turnstileToken;
    const text = argument;
    const signal = threadSignal();
    setTurnstileToken(null);
    clearDraft();
    setJudgingPremium(false);
    setError(null);
    setResponse(null);
    send(text);
    setPhase("judging");
    try {
      const res = await fetch("/api/verdict", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...ASYNC_HEADERS },
        // lang MUST be sent: the zod default("en") makes forgetting it
        // silent — the toggle would flip the UI while verdicts stay English.
        body: JSON.stringify({
          argument: text,
          framework,
          lang,
          ...(token ? { turnstileToken: token } : {}),
        }),
      });
      const json: unknown = await res.json().catch(() => null);
      if (!res.ok || json === null) {
        if (signal.aborted) return;
        restore(text, apiErrorMessage(lang, json, res.status));
        return;
      }
      if (res.status === 202) {
        const accepted = json as VerdictAcceptedResponse;
        saveOwnerToken(accepted.id, accepted.owner_token);
        // Indexed now, not when it finishes, so a closed tab still lists it
        // (My verdicts looks it up again on a later visit).
        if (!signedIn) addHistory({ id: accepted.id, createdAt: new Date().toISOString(), headline: null, pending: true });
        const verdict = await awaitVerdict(accepted, text, signal);
        if (verdict && !signal.aborted) show(verdict);
        return;
      }
      const verdict = json as VerdictResponse;
      saveOwnerToken(verdict.id, verdict.owner_token);
      remember(verdict, new Date().toISOString());
      if (!signal.aborted) show(verdict);
    } catch {
      if (signal.aborted) return;
      restore(text, t(lang, "errorFallback"));
    }
  }

  /** The composer's text becomes the thread's first turn. */
  function send(text: string) {
    setSent(text);
    setArgument("");
    setOptions(false);
  }

  /** Back to the composer with the text that was sent, and why if it failed. */
  function restore(text: string, message: string | null) {
    setError(message);
    setArgument(text);
    setSent(null);
    setPhase("intake");
  }

  function show(verdict: VerdictResponse) {
    setOwnerDisplay(null);
    setResponse(verdict);
  }

  /** A finished verdict goes into My verdicts: the account's list when
   * signed in, else this browser's own index. */
  function remember(verdict: VerdictResponse, createdAt: string) {
    if (signedIn) {
      void refreshHistory();
      return;
    }
    addHistory({
      id: verdict.id,
      createdAt,
      headline: restoredHeadline({ headline: verdict.result.headline, nameMap: verdict.name_map }),
    });
  }

  /**
   * An accepted (202) verdict: poll until it is ready, keeping the judging
   * animation running. Offline spells and server hiccups just keep polling
   * (lib/verdict-poll.ts backs off); a failed verdict shows the usual
   * localized error and returns to the form. The poll is not aborted with
   * the thread: My verdicts still needs the outcome.
   */
  async function awaitVerdict(
    accepted: VerdictAcceptedResponse,
    text: string,
    signal: AbortSignal,
  ): Promise<VerdictResponse | null> {
    const outcome = await pollVerdict(accepted.id, {
      fetch: (url, init) => fetch(url, init),
      sleep: wakefulSleep,
      ownerToken: accepted.owner_token ?? null,
      firstDelayMs: accepted.pollAfterMs,
    });
    if (outcome.kind === "ready") {
      const { result, owner, createdAt } = outcome.body;
      // A retry that joined a running verdict got no name map: the
      // writer's view has it.
      const mine = accepted.replayed && !signal.aborted ? await readMine(accepted.id, signal) : null;
      const verdict: VerdictResponse = {
        id: accepted.id,
        result,
        name_map: mine?.nameMap ?? accepted.name_map,
        ...(accepted.owner_token ? { owner_token: accepted.owner_token } : {}),
        ...(owner ? { originals_stored: owner.originals_stored, display: owner.display } : {}),
        suggested_display_a: mine?.suggested.a ?? accepted.suggested_display_a ?? null,
      };
      remember(verdict, createdAt);
      return verdict;
    }
    if (outcome.kind === "failed") dropHistory(accepted.id);
    if (signal.aborted) return null;
    restore(
      text,
      outcome.kind === "failed"
        ? apiErrorMessage(lang, { code: outcome.code }, outcome.status === 200 ? 502 : outcome.status)
        : t(lang, "errorFallback"),
    );
    return null;
  }

  /** The writer's view of a verdict (its name map), or null on any failure. */
  async function readMine(id: string, signal: AbortSignal): Promise<MineResponse | null> {
    try {
      const res = await fetch(`/api/v1/verdicts/${encodeURIComponent(id)}/mine`, {
        cache: "no-store",
        signal:
          typeof AbortSignal.any === "function" ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : signal,
      });
      return res.ok ? ((await res.json()) as MineResponse) : null;
    } catch {
      return null;
    }
  }

  /** Premium step 1: ask whether key facts are missing. Network trouble or
   * a server error never blocks the verdict: it just goes ahead without
   * questions. Account problems (401/402) and bad input stop on the form. */
  async function submitPremium() {
    // Judged as submitted: later edits never mix into this request.
    const input: PremiumInput = { argument, framework, evidence: evidenceOn ? evidence.tokens : [] };
    const signal = threadSignal();
    premiumInput.current = input;
    clearDraft();
    setError(null);
    setChecking(true);
    send(input.argument);
    let found: ClarifyQuestion[] = [];
    try {
      const res = await fetch("/api/v1/clarify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ argument: input.argument, lang }),
        signal,
      });
      const json: unknown = await res.json().catch(() => null);
      if (signal.aborted) return;
      if (res.ok) {
        found = ((json as ClarifyResponse | null)?.questions ?? []).slice(0, 2);
      } else if (ACCOUNT_STATUSES.has(res.status) || res.status === 400 || res.status === 403) {
        restore(input.argument, apiErrorMessage(lang, json, res.status));
        setChecking(false);
        if (ACCOUNT_STATUSES.has(res.status)) void refreshViewer();
        return;
      }
    } catch {
      // Offline or timed out: judge without questions.
    }
    if (signal.aborted) return;
    setChecking(false);
    if (found.length > 0) {
      setQuestions(found);
      setAnswers({});
      setPhase("clarify");
      return;
    }
    void judgePremium(input, undefined);
  }

  function keyFor(request: string): string {
    const held = premiumKey.current;
    if (held?.request === request) return held.key;
    const key = idempotencyKey();
    premiumKey.current = { request, key };
    return key;
  }

  /** Premium step 2: the verdict itself. */
  async function judgePremium(input: PremiumInput, clarifications: Clarification[] | undefined) {
    const signal = threadSignal();
    setError(null);
    setResponse(null);
    setJudgingPremium(true);
    setPhase("judging");
    const body = JSON.stringify({
      argument: input.argument,
      framework: input.framework,
      lang,
      tier: "premium",
      ...(clarifications ? { clarifications } : {}),
      ...(input.evidence.length ? { evidence: input.evidence } : {}),
    });
    const key = keyFor(body);
    const waitUntil = Date.now() + IN_PROGRESS_WAIT_MS;
    try {
      for (;;) {
        const res = await fetch("/api/v1/verdict", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": key, ...ASYNC_HEADERS },
          body,
        });
        const json: unknown = await res.json().catch(() => null);
        const code = (json as { code?: unknown } | null)?.code;
        if (res.status === 409 && code === "in_progress" && Date.now() < waitUntil) {
          if (signal.aborted) return;
          await new Promise((resolve) => setTimeout(resolve, IN_PROGRESS_POLL_MS));
          continue;
        }
        if (!res.ok || json === null) {
          if (ACCOUNT_STATUSES.has(res.status)) void refreshViewer();
          if (signal.aborted) return;
          restore(input.argument, apiErrorMessage(lang, json, res.status));
          return;
        }
        if (res.status === 202) {
          const accepted = json as VerdictAcceptedResponse;
          if (accepted.entitlement) applyEntitlement(accepted.entitlement);
          const verdict = await awaitVerdict(accepted, input.argument, signal);
          // A refused or degraded verdict, or a failed one, gave the unit back.
          void refreshViewer();
          if (!verdict) return;
          if (premiumKey.current?.key === key) premiumKey.current = null;
          if (!signal.aborted) show(verdict);
          return;
        }
        if (premiumKey.current?.key === key) premiumKey.current = null;
        const verdict = json as VerdictApiResponse;
        if (verdict.entitlement) applyEntitlement(verdict.entitlement);
        remember(verdict, new Date().toISOString());
        if (!signal.aborted) show(verdict);
        return;
      }
    } catch {
      if (signal.aborted) return;
      restore(input.argument, t(lang, "errorFallback"));
    }
  }

  /** Both sides: create the case with the owner's side (a premium case holds
   * one premium verdict), keep the returned names in this browser and open
   * the case page with the invite link. No clarifying step: the other side's
   * account fills the gaps. */
  async function createCase() {
    const tokens = evidenceOn ? evidence.tokens : [];
    const text = argument;
    const signal = threadSignal();
    clearDraft();
    setError(null);
    setCreating(true);
    send(text);
    const name = shownCaseName.trim();
    const body = JSON.stringify({
      text,
      framework,
      lang,
      tier,
      ...(tokens.length ? { evidence: tokens } : {}),
      ...(name ? { displayName: name } : {}),
    });
    const key = keyFor(body);
    try {
      const res = await fetch("/api/v1/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body,
      });
      const json: unknown = await res.json().catch(() => null);
      const created = json as CreateCaseResponse | null;
      if (!res.ok || !created?.case) {
        if (ACCOUNT_STATUSES.has(res.status)) void refreshViewer();
        if (signal.aborted) return;
        restore(text, apiErrorMessage(lang, json, res.status));
        setCreating(false);
        return;
      }
      if (premiumKey.current?.key === key) premiumKey.current = null;
      saveCaseNames(created.case.id, "a", created.name_map ?? []);
      if (created.entitlement) applyEntitlement(created.entitlement);
      void refreshHistory();
      if (signal.aborted) return;
      evidence.clear();
      // `creating` stays on: the thread holds until the case page takes over.
      router.push(`/c/${encodeURIComponent(created.case.id)}`);
    } catch {
      if (signal.aborted) return;
      restore(text, t(lang, "errorFallback"));
      setCreating(false);
    }
  }

  function finishClarify(skip: boolean) {
    const input = premiumInput.current;
    if (!input) return;
    void judgePremium(input, buildClarifications(questions, answers, skip));
  }

  function reset() {
    thread.current?.abort();
    thread.current = null;
    premiumInput.current = null;
    resetScene();
    setResponse(null);
    setError(null);
    setArgument("");
    setSent(null);
    setOptions(false);
    setChecking(false);
    setCreating(false);
    setQuestions([]);
    setAnswers({});
    setJudgingPremium(false);
    evidence.clear();
    setPhase("intake");
    window.scrollTo({ top: 0 });
  }

  function fillExample(key: Key) {
    setArgument(t(lang, key));
    setError(null);
  }

  const empty = sent === null;
  const progress = checking ? t(lang, "tier.checking") : creating ? t(lang, "case.creating") : null;

  // The composer takes focus whenever the thread gives way to it again
  // (a new argument, a failed request, back from the questions).
  const wasEmpty = useRef(true);
  useEffect(() => {
    if (empty && !wasEmpty.current) document.getElementById("argument")?.focus({ preventScroll: true });
    wasEmpty.current = empty;
  }, [empty]);

  return (
    // The tab bar gives way to the docked composer while an argument runs;
    // after the verdict it is back under the "New argument" bar.
    <AppShell
      lang={lang}
      toggle
      footer={false}
      tabs={empty || phase === "verdict"}
      onHome={empty ? undefined : reset}
    >
      <main id="main" tabIndex={-1} className={styles.main} data-empty={empty ? "" : undefined}>
        <div className={`wrap ${styles.column}`}>
          <p className="sr-only" role="status" aria-live="polite">
            {progress}
          </p>
          {empty ? null : (
            <>
              <h1 className="sr-only">{t(lang, "hero.title")}</h1>
              <Thread
                lang={lang}
                argument={sent}
                status={progress}
                judgesLabel={phase === "verdict" && shown ? judgesLabel(lang, shown.result) : undefined}
                clarify={
                  phase === "clarify" ? (
                    <ClarifyStep
                      lang={lang}
                      questions={questions}
                      answers={answers}
                      onAnswer={(id, value) => setAnswers((a) => ({ ...a, [id]: value }))}
                      onSubmit={() => finishClarify(false)}
                      onSkip={() => finishClarify(true)}
                      onBack={() => restore(premiumInput.current?.argument ?? "", null)}
                    />
                  ) : null
                }
                judging={
                  // The scene stays mounted into the verdict, shrunk to a
                  // strip: its settled balance is part of the result.
                  phase === "judging" || (phase === "verdict" && response) ? (
                    <>
                      <JudgingScene
                        className={phase === "verdict" ? `${styles.scene} ${styles.settled}` : styles.scene}
                      />
                      {phase === "judging" ? (
                        <JudgingOverlay
                          lang={lang}
                          done={response !== null}
                          result={response?.result ?? null}
                          onFinished={() => setPhase("verdict")}
                          premium={judgingPremium}
                        />
                      ) : null}
                    </>
                  ) : null
                }
                verdict={
                  phase === "verdict" && response && shown ? (
                    <VerdictView
                      result={shown.result}
                      nameMap={roundNames}
                      shareId={response.id}
                      verdictId={shown.id === response.id ? undefined : shown.id}
                      fresh
                      owner={owner}
                      onAddContext={appeal.onAddContext}
                      focusAppeal={appeal.finished}
                    />
                  ) : null
                }
                followUp={
                  phase === "verdict" && response && (appeal.panel || appeal.verdicts.length > 1) ? (
                    <div className="flex flex-col gap-6 min-w-0">
                      {appeal.panel}
                      <VerdictHistory
                        lang={lang}
                        verdicts={appeal.verdicts}
                        linked={false}
                        names={roundNames ?? []}
                        selfParty="A"
                        viewerIsSelfParty={false}
                      />
                    </div>
                  ) : null
                }
              />
            </>
          )}
          {phase === "verdict" ? (
            <NextSteps lang={lang} onNew={reset} />
          ) : phase === "judging" ? null : (
            <Composer
              lang={lang}
              value={argument}
              onChange={setArgument}
              onSubmit={() => void (twoSided ? createCase() : premium ? submitPremium() : submit())}
              canSubmit={canSubmit}
              disabled={!empty}
              error={error}
              framework={framework}
              onFrameworkChange={setFramework}
              expanded={options}
              onExpandedChange={setOptions}
              tierSwitch={
                availability === "hidden" ? undefined : (
                  <TierSwitch
                    lang={lang}
                    availability={availability}
                    value={tier}
                    onChange={setTierChoice}
                    entitlement={viewer.me?.entitlement ?? null}
                    onPremiumIntent={() => setTierChoice("premium")}
                  />
                )
              }
              extras={
                <>
                  {casesOn || casesLocked ? (
                    <CaseModeSwitch
                      lang={lang}
                      value={twoSided ? "both" : "now"}
                      onChange={setCaseMode}
                      locked={casesLocked}
                    />
                  ) : null}
                  {twoSided ? (
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>{t(lang, "case.displayName")}</span>
                      <input
                        className={styles.fieldInput}
                        value={shownCaseName}
                        maxLength={40}
                        autoComplete="given-name"
                        onChange={(e) => setCaseName(e.target.value)}
                      />
                    </label>
                  ) : null}
                  {evidenceOn ? (
                    <EvidencePicker
                      lang={lang}
                      max={MAX_EVIDENCE_PER_SIDE}
                      items={evidence.items}
                      full={evidence.full}
                      failure={evidence.failure}
                      overLimit={evidence.overLimit}
                      onAdd={evidence.add}
                      onRemove={evidence.remove}
                    />
                  ) : null}
                </>
              }
              turnstile={
                needsToken && empty ? (
                  <Turnstile siteKey={TURNSTILE_SITE_KEY} lang={lang} onToken={setTurnstileToken} />
                ) : null
              }
              twoSided={twoSided}
              submitLabel={t(lang, twoSided ? "case.create" : "getVerdict")}
              onExample={empty ? fillExample : undefined}
              card={empty}
              onSwitchSides={
                empty && casesOn ? () => setCaseMode(twoSided ? "now" : "both") : undefined
              }
            />
          )}
          {empty ? (
            <>
              <Recent lang={lang} items={history.items} now={now} />
              <div className={styles.below}>
                <Link href="/about#sample" className={styles.sample}>
                  {t(lang, "thread.sample")} <span aria-hidden>→</span>
                </Link>
                <p className={styles.privacy}>
                  {t(lang, "privacyNote")} <Link href="/privacy">{t(lang, "privacyLink")}</Link>
                </p>
                <p className={styles.privacy}>{t(lang, "footer.note")}</p>
              </div>
            </>
          ) : null}
        </div>
      </main>
    </AppShell>
  );
}
