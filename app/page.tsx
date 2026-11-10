"use client";

import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useEvidence } from "@/components/case/EvidencePicker";
import { ClarifyStep, buildClarifications, type ClarifyQuestion } from "@/components/ClarifyStep";
import { Balance } from "@/components/home/Balance";
import { HomeForm } from "@/components/home/HomeForm";
import { JudgingScreen, type JudgedSide } from "@/components/JudgingScreen";
import { ENDING_MAX_MS } from "@/components/court/story";
import { AppShell } from "@/components/shell/AppShell";
import { refreshHistory, useHistory } from "@/components/shell/useHistory";
import styles from "@/components/home/page.module.css";
import { apiFetch } from "@/lib/api-fetch";
import { MAX_EVIDENCE_PER_SIDE, type CreateCaseResponse } from "@/lib/case-types";
import { saveCaseNames } from "@/lib/case-names-store";
import { firstNameOf } from "@/lib/originals-types";
import { ownerTokenIds } from "@/lib/owner-store";
import { track, trackApiError } from "@/lib/analytics/client";
import { clearDraft, registerDraftSource, saveDraftForSignIn, takeDraft } from "@/lib/draft";
import { startHistory } from "@/lib/history-store";
import { apiErrorMessage, t } from "@/lib/i18n";
import { useLang } from "@/lib/lang";
import { resetScene } from "@/lib/scene-bridge";
import { EXAMPLES, MAX_ARGUMENT, inviteTextOk, joinSides } from "@/lib/sides";
import type { Clarification, ClarifyResponse, VerdictApiResponse, VerdictResponse } from "@/lib/types";
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

/** What a verdict request judges, fixed when it is submitted. `evidence`
 * holds signed screenshot tokens; the sides are what the judging screen
 * shows. */
type PremiumInput = {
  argument: string;
  evidence: string[];
  mine: JudgedSide | null;
  theirs: JudgedSide | null;
};

/** Signed-in screenshot uploads (the respondent's page uses its own). */
const EVIDENCE_ENDPOINT = "/api/v1/evidence";

/** "clarify": the questions replace the form; "judging": the judging screen. */
type Phase = "form" | "clarify" | "judging";

export default function Home() {
  const lang = useLang();
  // Both sides stay in state while a request runs, so a failed one finds
  // the form as it was.
  const [argument, setArgument] = useState("");
  const [otherSide, setOtherSide] = useState("");
  // Their side stays closed until asked for; closed, it is always empty.
  const [theirsOpen, setTheirsOpen] = useState(false);
  // Null: the account's first name until they type.
  const [mineName, setMineName] = useState<string | null>(null);
  const [otherName, setOtherName] = useState("");
  const [phase, setPhase] = useState<Phase>("form");
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<VerdictResponse | null>(null);
  const [accepted, setAccepted] = useState(false);
  const viewer = useViewer();
  // Nothing from it is listed here; the hook still settles entries left
  // judging and warms the Verdicts tab.
  useHistory(viewer);
  const [checking, setChecking] = useState(false);
  const [questions, setQuestions] = useState<ClarifyQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const premiumInput = useRef<PremiumInput | null>(null);
  const [judged, setJudged] = useState<PremiumInput | null>(null);
  // One key per exact premium request (input, language, answers): a retry
  // of the same request reuses it, so the server replays or waits instead
  // of charging again. A success or a different request gets a new key.
  const premiumKey = useRef<{ request: string; key: string } | null>(null);
  // The example that filled the form last, so the next one differs, and the
  // name it wrote, which "New argument" drops but keeps a typed one.
  const lastExample = useRef<string | null>(null);
  const exampleName = useRef<string | null>(null);
  // Screenshot evidence and two-sided cases, each only when this deployment
  // offers it (GET /api/v1/config `features`).
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const evidence = useEvidence(EVIDENCE_ENDPOINT, MAX_EVIDENCE_PER_SIDE);
  // The current argument. "New argument" or leaving the page aborts it:
  // the clarify check is cancelled, while a verdict or case already sent
  // runs to the end so its owner token and history entry are kept, just
  // without touching the screen any more.
  const thread = useRef<AbortController | null>(null);
  const opened = useRef(false);

  const features = viewer.config?.features;
  // Signed out, the form still takes the text: sending it goes to sign-in
  // first and the draft comes back afterwards. Uploads need the account.
  const signedIn = Boolean(viewer.me?.user);
  const entitlement = signedIn ? (viewer.me?.entitlement ?? null) : null;
  const evidenceOffered = features?.evidence === true;
  const evidenceOn = signedIn && evidenceOffered;
  // Signed out, "Send them a link" goes to sign-in first.
  const casesOn = features?.cases === true;
  const holding = checking || creating;
  const open = useEffectEvent(judgingFinished);

  // Belt and braces: if the judging animation has not handed off shortly
  // after the response arrived, open the verdict anyway.
  useEffect(() => {
    if (phase !== "judging" || response === null) return;
    const t = setTimeout(() => open(), ENDING_MAX_MS + 2000);
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

  // A draft saved on the way to /signin comes back once. localStorage
  // does not exist during server rendering, so it is read after mount.
  useEffect(() => {
    const draft = takeDraft();
    if (!draft) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of browser storage
    setArgument(draft.argument);
    setOtherSide(draft.otherSide ?? "");
    setTheirsOpen(Boolean(draft.otherSide) || draft.theirsOpen === true);
    if (draft.mineName !== undefined) setMineName(draft.mineName);
    setOtherName(draft.otherName ?? "");
  }, []);

  // The index has to exist before the first addHistory, or the verdicts
  // this browser wrote before it would never be queued for the Verdicts list.
  useEffect(() => startHistory(ownerTokenIds()), []);

  // What a sign-in link saves: only an unsent argument.
  useEffect(
    () =>
      registerDraftSource(() =>
        phase === "judging"
          ? null
          : {
              argument,
              ...(otherSide ? { otherSide } : {}),
              ...(mineName !== null ? { mineName } : {}),
              ...(otherName ? { otherName } : {}),
              ...(theirsOpen ? { theirsOpen } : {}),
            },
      ),
    [argument, otherSide, mineName, otherName, theirsOpen, phase],
  );

  const shownMineName = mineName ?? firstNameOf(viewer.me?.user?.name) ?? "";
  const joined = joinSides(lang, { text: argument, name: shownMineName }, { text: otherSide, name: otherName });

  // Until /me answers, a click could send a signed-in writer to sign in.
  // If it failed, the server decides (401 when signed out).
  const viewerKnown = viewer.status === "ready" || viewer.status === "error";
  const canSubmit =
    argument.trim().length + otherSide.trim().length >= 20 &&
    joined.length <= MAX_ARGUMENT &&
    viewerKnown &&
    !holding &&
    !(evidenceOn && evidence.busy);

  // A link needs a side worth judging, or none at all (the other person can
  // write theirs first); text with a few words or only images does not count.
  const canInvite =
    !theirsOpen &&
    viewerKnown &&
    !holding &&
    !(evidenceOn && evidence.busy) &&
    inviteTextOk(argument, evidence.items.length);

  function signInFirst() {
    saveDraftForSignIn();
    router.push("/signin?next=%2F");
  }

  // The button only renders once /config and /me are in, so this also runs
  // when /me failed; /signin sends a signed-in person back.
  function addContextSignIn() {
    signInFirst();
  }

  /** Nothing left to spend: pricing, with the text kept for afterwards. */
  function pricingFirst() {
    saveDraftForSignIn();
    router.push("/pricing");
  }

  /** Back to the form, with why if the request failed. */
  function fail(message: string | null) {
    setError(message);
    setPhase("form");
  }

  /** The verdict has its own page; the account that wrote it sees the
   * writer's view there. */
  function judgingFinished() {
    if (!response || opened.current) return;
    opened.current = true;
    router.push(`/v/${encodeURIComponent(response.id)}`);
  }

  /**
   * An accepted (202) verdict: poll until it is ready, keeping the judging
   * animation running. Offline spells and server hiccups just keep polling
   * (lib/verdict-poll.ts backs off); a failed verdict shows the usual
   * localized error and returns to the form. The poll is not aborted with
   * the thread: the Verdicts list still needs the outcome.
   */
  async function awaitVerdict(accepted: VerdictAcceptedResponse, signal: AbortSignal): Promise<VerdictResponse | null> {
    const outcome = await pollVerdict(accepted.id, {
      fetch: (url, init) => apiFetch(url, init),
      sleep: wakefulSleep,
      ownerToken: accepted.owner_token ?? null,
      firstDelayMs: accepted.pollAfterMs,
    });
    if (outcome.kind === "ready") {
      const { result, owner } = outcome.body;
      const verdict: VerdictResponse = {
        id: accepted.id,
        result,
        name_map: accepted.name_map,
        ...(accepted.owner_token ? { owner_token: accepted.owner_token } : {}),
        ...(owner ? { originals_stored: owner.originals_stored, display: owner.display } : {}),
        suggested_display_a: accepted.suggested_display_a ?? null,
      };
      void refreshHistory();
      return verdict;
    }
    if (signal.aborted) return null;
    if (outcome.kind === "failed") trackApiError({ code: outcome.code }, outcome.status);
    fail(
      outcome.kind === "failed"
        ? apiErrorMessage(lang, { code: outcome.code }, outcome.status === 200 ? 502 : outcome.status)
        : t(lang, "errorFallback"),
    );
    return null;
  }

  /** Step 1: ask whether key facts are missing. Network trouble or
   * a server error never blocks the verdict: it just goes ahead without
   * questions. Account problems (401/402) and bad input stop on the form. */
  async function submitPremium() {
    track("case_submitted");
    // Judged as submitted: later edits never mix into this request.
    const input: PremiumInput = {
      argument: joined,
      evidence: evidenceOn ? evidence.tokens : [],
      mine: argument.trim() ? { name: shownMineName, text: argument.trim() } : null,
      theirs: otherSide.trim() ? { name: otherName, text: otherSide.trim() } : null,
    };
    const signal = threadSignal();
    premiumInput.current = input;
    setJudged(input);
    clearDraft();
    setError(null);
    setChecking(true);
    let found: ClarifyQuestion[] = [];
    try {
      const res = await apiFetch("/api/v1/clarify", {
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
        trackApiError(json, res.status);
        fail(apiErrorMessage(lang, json, res.status));
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

  /** Step 2: the verdict itself. */
  async function judgePremium(input: PremiumInput, clarifications: Clarification[] | undefined) {
    const signal = threadSignal();
    setError(null);
    setResponse(null);
    setAccepted(false);
    opened.current = false;
    setPhase("judging");
    const body = JSON.stringify({
      argument: input.argument,
      lang,
      ...(clarifications ? { clarifications } : {}),
      ...(input.evidence.length ? { evidence: input.evidence } : {}),
    });
    const key = keyFor(body);
    const waitUntil = Date.now() + IN_PROGRESS_WAIT_MS;
    try {
      for (;;) {
        const res = await apiFetch("/api/v1/verdict", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": key,
            ...ASYNC_HEADERS,
          },
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
          trackApiError(json, res.status);
          fail(apiErrorMessage(lang, json, res.status));
          return;
        }
        if (res.status === 202) {
          const pending = json as VerdictAcceptedResponse;
          if (pending.entitlement) applyEntitlement(pending.entitlement);
          if (!signal.aborted) setAccepted(true);
          const verdict = await awaitVerdict(pending, signal);
          // A refused or degraded verdict, or a failed one, gave the unit back.
          void refreshViewer();
          if (!verdict) return;
          if (premiumKey.current?.key === key) premiumKey.current = null;
          if (!signal.aborted) setResponse(verdict);
          return;
        }
        if (premiumKey.current?.key === key) premiumKey.current = null;
        const verdict = json as VerdictApiResponse;
        if (verdict.entitlement) applyEntitlement(verdict.entitlement);
        void refreshHistory();
        if (!signal.aborted) setResponse(verdict);
        return;
      }
    } catch {
      if (signal.aborted) return;
      fail(t(lang, "errorFallback"));
    }
  }

  /** Send a link: create the case with the owner's side if they wrote one (it
   * holds one premium verdict), keep the returned names in this browser and open
   * the case page with the invite link. No clarifying step: the other side's
   * account fills the gaps. */
  async function createCase() {
    track("case_submitted");
    const tokens = evidenceOn ? evidence.tokens : [];
    const text = argument.trim() ? argument : undefined;
    const signal = threadSignal();
    clearDraft();
    setError(null);
    setCreating(true);
    const name = shownMineName.trim();
    const body = JSON.stringify({
      text,
      lang,
      ...(tokens.length ? { evidence: tokens } : {}),
      ...(name ? { displayName: name } : {}),
    });
    const key = keyFor(body);
    try {
      const res = await apiFetch("/api/v1/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body,
      });
      const json: unknown = await res.json().catch(() => null);
      const created = json as CreateCaseResponse | null;
      if (!res.ok || !created?.case) {
        if (ACCOUNT_STATUSES.has(res.status)) void refreshViewer();
        if (signal.aborted) return;
        trackApiError(json, res.status);
        fail(apiErrorMessage(lang, json, res.status));
        setCreating(false);
        return;
      }
      if (premiumKey.current?.key === key) premiumKey.current = null;
      saveCaseNames(created.case.id, "a", created.name_map ?? []);
      if (created.entitlement) applyEntitlement(created.entitlement);
      void refreshHistory();
      if (signal.aborted) return;
      evidence.clear();
      // `creating` stays on: the form holds until the case page takes over.
      router.push(`/c/${encodeURIComponent(created.case.id)}`);
    } catch {
      if (signal.aborted) return;
      fail(t(lang, "errorFallback"));
      setCreating(false);
    }
  }

  function finishClarify(skip: boolean) {
    const input = premiumInput.current;
    if (!input) return;
    if (!skip) for (const q of questions) if (answers[q.id]?.trim()) track("question_answered");
    void judgePremium(input, buildClarifications(questions, answers, skip));
  }

  function reset() {
    thread.current?.abort();
    thread.current = null;
    premiumInput.current = null;
    resetScene();
    setResponse(null);
    setAccepted(false);
    setError(null);
    setArgument("");
    setOtherSide("");
    setOtherName("");
    setTheirsOpen(false);
    if (mineName !== null && mineName === exampleName.current) setMineName(null);
    exampleName.current = null;
    setChecking(false);
    setCreating(false);
    setQuestions([]);
    setAnswers({});
    evidence.clear();
    setPhase("form");
    window.scrollTo({ top: 0 });
  }

  /** Stops the request and returns to the form with everything kept. */
  function cancelJudging() {
    thread.current?.abort();
    thread.current = null;
    resetScene();
    setResponse(null);
    setAccepted(false);
    setChecking(false);
    setPhase("form");
  }

  const started = useRef(false);
  useEffect(() => {
    if (argument && !started.current) track("case_started");
    started.current = argument !== "";
  }, [argument]);

  function removeTheirs() {
    setOtherSide("");
    setOtherName("");
    setTheirsOpen(false);
    if (mineName !== null && mineName === exampleName.current) setMineName(null);
    exampleName.current = null;
  }

  function fillExample() {
    const pool = EXAMPLES.filter((id) => id !== lastExample.current);
    const id = pool[Math.floor(Math.random() * pool.length)];
    lastExample.current = id;
    const name = t(lang, `pairs.${id}.aName`);
    exampleName.current = name;
    setMineName(name);
    setArgument(t(lang, `pairs.${id}.a`));
    setOtherName(t(lang, `pairs.${id}.bName`));
    setOtherSide(t(lang, `pairs.${id}.b`));
    setTheirsOpen(true);
    setError(null);
  }

  function onSubmit() {
    if (viewer.status === "ready" && !signedIn) signInFirst();
    else if (entitlement?.canUsePremium === false) pricingFirst();
    else void submitPremium();
  }

  function onInvite() {
    if (viewer.status === "ready" && !signedIn) signInFirst();
    else if (entitlement?.canUsePremium === false) pricingFirst();
    else void createCase();
  }

  const progress = checking ? t(lang, "tier.checking") : creating ? t(lang, "case.creating") : null;

  // The first field takes focus whenever the form comes back (a new
  // argument, a failed request, back from the questions).
  const shown = useRef<Phase>("form");
  useEffect(() => {
    if (phase === "form" && shown.current !== "form")
      document.getElementById("argument")?.focus({ preventScroll: true });
    if (phase !== "form") window.scrollTo({ top: 0 });
    shown.current = phase;
  }, [phase]);

  // iOS Safari keeps dvh at full height under the keyboard, so the chat
  // follows the visual viewport where there is one.
  useEffect(() => {
    const vv = window.visualViewport;
    if (phase !== "form" || !vv) return;
    const root = document.documentElement;
    const size = () => root.style.setProperty("--vvh", `${vv.height}px`);
    size();
    vv.addEventListener("resize", size);
    return () => {
      vv.removeEventListener("resize", size);
      root.style.removeProperty("--vvh");
    };
  }, [phase]);

  return (
    // The menu button gives way to the judging screen, as the apps' full-screen cover does.
    <AppShell lang={lang} toggle footer={false} tabs={phase !== "judging"} onHome={phase !== "form" ? reset : undefined}>
      <main id="main" tabIndex={-1} className={phase === "form" ? `${styles.main} ${styles.chat}` : styles.main}>
        <div className={`wrap ${styles.column}`}>
          <h1 className="sr-only">{t(lang, "hero.title")}</h1>
          <p className="sr-only" role="status" aria-live="polite">
            {progress}
          </p>
          {phase === "clarify" ? (
            <ClarifyStep
              lang={lang}
              questions={questions}
              answers={answers}
              onAnswer={(id, value) => setAnswers((a) => ({ ...a, [id]: value }))}
              onSubmit={() => finishClarify(false)}
              onSkip={() => finishClarify(true)}
              onBack={() => fail(null)}
            />
          ) : phase === "judging" && judged ? (
            <JudgingScreen
              lang={lang}
              mine={judged.mine}
              theirs={judged.theirs}
              accepted={accepted}
              done={response !== null}
              result={response?.result ?? null}
              onFinished={judgingFinished}
              onCancel={cancelJudging}
            />
          ) : (
            <HomeForm
              lang={lang}
              mine={argument}
              onMine={setArgument}
              mineName={shownMineName}
              onMineName={setMineName}
              theirs={otherSide}
              onTheirs={setOtherSide}
              theirName={otherName}
              onTheirName={setOtherName}
              theirsOpen={theirsOpen}
              onAddTheirs={() => setTheirsOpen(true)}
              onRemoveTheirs={removeTheirs}
              length={joined.length}
              blank={!argument && !theirsOpen && evidence.items.length === 0}
              onClear={reset}
              onExample={fillExample}
              canSubmit={canSubmit}
              onSubmit={onSubmit}
              onInvite={casesOn ? onInvite : undefined}
              canInvite={canInvite}
              holding={holding}
              error={error}
              status={progress ?? (entitlement ? <Balance lang={lang} entitlement={entitlement} /> : null)}
              evidence={evidenceOffered ? evidence : undefined}
              onAddContextSignIn={signedIn ? undefined : addContextSignIn}
            />
          )}
        </div>
      </main>
    </AppShell>
  );
}
