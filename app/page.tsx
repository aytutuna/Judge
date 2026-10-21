"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CaseModeSwitch, type CaseMode } from "@/components/case/CaseModeSwitch";
import { EvidencePicker, useEvidence } from "@/components/case/EvidencePicker";
import { ClarifyStep, buildClarifications, type ClarifyQuestion } from "@/components/ClarifyStep";
import { Faq } from "@/components/home/Faq";
import { Hero, type HeroPhase } from "@/components/home/Hero";
import { SampleVerdict } from "@/components/home/SampleVerdict";
import { ScrollStory } from "@/components/home/ScrollStory";
import { JudgingOverlay } from "@/components/JudgingOverlay";
import { SceneStage } from "@/components/scene/SceneStage";
import { SiteFooter, SiteHeader, SkipLink } from "@/components/SiteChrome";
import { TierSwitch } from "@/components/TierSwitch";
import { Turnstile, TURNSTILE_SITE_KEY } from "@/components/Turnstile";
import { VerdictView } from "@/components/VerdictView";
import { MAX_EVIDENCE_PER_SIDE, type CreateCaseResponse } from "@/lib/case-types";
import { saveCaseNames } from "@/lib/case-names-store";
import { verdictLang } from "@/lib/content-lang";
import { firstNameOf, type DisplayState, type MineResponse } from "@/lib/originals-types";
import { saveOwnerToken } from "@/lib/owner-store";
import { buildOwnerShare } from "@/components/ShareDialog";
import heroStyles from "@/components/home/Hero.module.css";
import { clearDraft, registerDraftSource, takeDraft } from "@/lib/draft";
import { DEFAULT_FRAMEWORK } from "@/lib/frameworks";
import { apiErrorMessage, t, type Key } from "@/lib/i18n";
import { useLang } from "@/lib/lang";
import { nudgeScene, resetScene } from "@/lib/scene-bridge";
import { MAX_FINISH_MS } from "@/lib/thinking";
import { effectiveTier, setTierChoice, tierAvailability, useTierChoice } from "@/lib/tier";
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

export default function Home() {
  const lang = useLang();
  const [argument, setArgument] = useState("");
  const [framework, setFramework] = useState<FrameworkChoice>(DEFAULT_FRAMEWORK);
  const [phase, setPhase] = useState<HeroPhase>("intake");
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
  // Premium extras: screenshot evidence and two-sided cases, each only when
  // this deployment offers it (GET /api/v1/config `features`).
  const router = useRouter();
  const [caseMode, setCaseMode] = useState<CaseMode>("now");
  const [creating, setCreating] = useState(false);
  const evidence = useEvidence(EVIDENCE_ENDPOINT, MAX_EVIDENCE_PER_SIDE);
  // The running poll for an async verdict; abort it to drop it.
  const pollRun = useRef<AbortController | null>(null);

  const availability = tierAvailability(viewer.config, viewer.me);
  const tier = effectiveTier(availability, tierChoice);
  const premium = tier === "premium";
  const features = viewer.config?.features;
  const evidenceOn = premium && features?.evidence === true;
  const casesOn = premium && features?.cases === true;
  const twoSided = casesOn && caseMode === "both";
  const holding = checking || creating;

  // Belt and braces: if the judging animation has not handed off shortly
  // after the response arrived, show the verdict anyway.
  useEffect(() => {
    if (phase !== "judging" || response === null) return;
    const t = setTimeout(() => setPhase("verdict"), MAX_FINISH_MS + 2000);
    return () => clearTimeout(t);
  }, [phase, response]);

  // Leaving the page drops a running poll.
  useEffect(
    () => () => {
      pollRun.current?.abort();
    },
    [],
  );

  // A draft saved on the way to /signin comes back once. sessionStorage
  // does not exist during server rendering, so it is read after mount.
  useEffect(() => {
    const draft = takeDraft();
    if (!draft) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of browser storage
    setArgument(draft.argument);
    setFramework(draft.framework);
  }, []);

  // What a sign-in link saves: only an unsent argument.
  useEffect(
    () =>
      registerDraftSource(() =>
        phase === "intake" || phase === "clarify" ? { argument, framework } : null,
      ),
    [argument, framework, phase],
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

  // Premium skips the human check: the signed-in account is the gate.
  const needsToken = TURNSTILE_SITE_KEY !== "" && !premium;
  const canSubmit =
    argument.trim().length >= 20 &&
    !holding &&
    !(evidenceOn && evidence.busy) &&
    (!needsToken || turnstileToken !== null);

  async function submit() {
    // Turnstile tokens are single-use: take it now, and the widget remounts
    // with a fresh one whenever the form comes back.
    const token = turnstileToken;
    setTurnstileToken(null);
    clearDraft();
    setJudgingPremium(false);
    setError(null);
    setResponse(null);
    setPhase("judging");
    try {
      const res = await fetch("/api/verdict", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...ASYNC_HEADERS },
        // lang MUST be sent: the zod default("en") makes forgetting it
        // silent — the toggle would flip the UI while verdicts stay English.
        body: JSON.stringify({
          argument,
          framework,
          lang,
          ...(token ? { turnstileToken: token } : {}),
        }),
      });
      const json: unknown = await res.json().catch(() => null);
      if (!res.ok || json === null) {
        setError(apiErrorMessage(lang, json, res.status));
        setPhase("intake");
        return;
      }
      if (res.status === 202) {
        const accepted = json as VerdictAcceptedResponse;
        saveOwnerToken(accepted.id, accepted.owner_token);
        const verdict = await awaitVerdict(accepted);
        if (!verdict) return;
        setOwnerDisplay(null);
        setResponse(verdict);
        return;
      }
      const verdict = json as VerdictResponse;
      saveOwnerToken(verdict.id, verdict.owner_token);
      setOwnerDisplay(null);
      setResponse(verdict);
    } catch {
      setError(t(lang, "errorFallback"));
      setPhase("intake");
    }
  }

  /**
   * An accepted (202) verdict: poll until it is ready, keeping the judging
   * animation running. Offline spells and server hiccups just keep polling
   * (lib/verdict-poll.ts backs off); a failed verdict shows the usual
   * localized error and returns to the form. Null when it failed or the
   * poll was dropped (reset, a new request, leaving the page).
   */
  async function awaitVerdict(accepted: VerdictAcceptedResponse): Promise<VerdictResponse | null> {
    pollRun.current?.abort();
    const run = new AbortController();
    pollRun.current = run;
    const outcome = await pollVerdict(accepted.id, {
      fetch: (url, init) => fetch(url, init),
      sleep: wakefulSleep,
      ownerToken: accepted.owner_token ?? null,
      firstDelayMs: accepted.pollAfterMs,
      signal: run.signal,
    });
    if (pollRun.current === run) pollRun.current = null;
    if (outcome.kind === "aborted") return null;
    if (outcome.kind === "ready") {
      const { result, owner } = outcome.body;
      // A retry that joined a running verdict got no name map: the
      // writer's view has it.
      const mine = accepted.replayed ? await readMine(accepted.id, run.signal) : null;
      if (run.signal.aborted) return null;
      return {
        id: accepted.id,
        result,
        name_map: mine?.nameMap ?? accepted.name_map,
        ...(accepted.owner_token ? { owner_token: accepted.owner_token } : {}),
        ...(owner ? { originals_stored: owner.originals_stored, display: owner.display } : {}),
        suggested_display_a: mine?.suggested.a ?? accepted.suggested_display_a ?? null,
      };
    }
    setError(
      outcome.kind === "failed"
        ? apiErrorMessage(lang, { code: outcome.code }, outcome.status === 200 ? 502 : outcome.status)
        : t(lang, "errorFallback"),
    );
    setPhase("intake");
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
    premiumInput.current = input;
    clearDraft();
    setError(null);
    setChecking(true);
    let found: ClarifyQuestion[] = [];
    try {
      const res = await fetch("/api/v1/clarify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ argument: input.argument, lang }),
      });
      const json: unknown = await res.json().catch(() => null);
      if (res.ok) {
        found = ((json as ClarifyResponse | null)?.questions ?? []).slice(0, 2);
      } else if (ACCOUNT_STATUSES.has(res.status) || res.status === 400 || res.status === 403) {
        setError(apiErrorMessage(lang, json, res.status));
        setChecking(false);
        if (ACCOUNT_STATUSES.has(res.status)) void refreshViewer();
        return;
      }
    } catch {
      // Offline or timed out: judge without questions.
    }
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
          await new Promise((resolve) => setTimeout(resolve, IN_PROGRESS_POLL_MS));
          continue;
        }
        if (!res.ok || json === null) {
          setError(apiErrorMessage(lang, json, res.status));
          setPhase("intake");
          if (ACCOUNT_STATUSES.has(res.status)) void refreshViewer();
          return;
        }
        if (res.status === 202) {
          const accepted = json as VerdictAcceptedResponse;
          if (accepted.entitlement) applyEntitlement(accepted.entitlement);
          const verdict = await awaitVerdict(accepted);
          // A refused or degraded verdict, or a failed one, gave the unit back.
          void refreshViewer();
          if (!verdict) return;
          if (premiumKey.current?.key === key) premiumKey.current = null;
          setOwnerDisplay(null);
          setResponse(verdict);
          return;
        }
        if (premiumKey.current?.key === key) premiumKey.current = null;
        const verdict = json as VerdictApiResponse;
        if (verdict.entitlement) applyEntitlement(verdict.entitlement);
        setOwnerDisplay(null);
        setResponse(verdict);
        return;
      }
    } catch {
      setError(t(lang, "errorFallback"));
      setPhase("intake");
    }
  }

  /** Premium, both sides: create the case with the owner's side (one
   * premium verdict is held), keep the returned names in this browser and
   * open the case page with the invite link. No clarifying step: the other
   * side's account fills the gaps. */
  async function createCase() {
    const tokens = evidenceOn ? evidence.tokens : [];
    clearDraft();
    setError(null);
    setCreating(true);
    const name = shownCaseName.trim();
    const body = JSON.stringify({
      text: argument,
      framework,
      lang,
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
        setError(apiErrorMessage(lang, json, res.status));
        setCreating(false);
        if (ACCOUNT_STATUSES.has(res.status)) void refreshViewer();
        return;
      }
      if (premiumKey.current?.key === key) premiumKey.current = null;
      saveCaseNames(created.case.id, "a", created.name_map ?? []);
      if (created.entitlement) applyEntitlement(created.entitlement);
      evidence.clear();
      // `creating` stays on: the form holds until the case page takes over.
      router.push(`/c/${encodeURIComponent(created.case.id)}`);
    } catch {
      setError(t(lang, "errorFallback"));
      setCreating(false);
    }
  }

  function finishClarify(skip: boolean) {
    const input = premiumInput.current;
    if (!input) return;
    void judgePremium(input, buildClarifications(questions, answers, skip));
  }

  // The hero focuses the textarea once the form is back.
  function reset() {
    pollRun.current?.abort();
    resetScene();
    setResponse(null);
    setArgument("");
    setQuestions([]);
    setAnswers({});
    setJudgingPremium(false);
    evidence.clear();
    setPhase("intake");
    window.scrollTo({ top: 0 });
  }

  function changeArgument(value: string) {
    setArgument(value);
    nudgeScene("type");
  }

  function fillExample(key: Key, index: number) {
    setArgument(t(lang, key));
    setError(null);
    nudgeScene("example", index % 2 ? 1 : -1);
  }

  return (
    <div lang={lang} className="contents">
      <SkipLink lang={lang} />
      <SiteHeader lang={lang} toggle howLink overlay />

      <main id="main" tabIndex={-1} className="flex-1 w-full outline-none">
        <SceneStage lang={lang}>
          <Hero
            lang={lang}
            phase={phase}
            argument={argument}
            onArgumentChange={changeArgument}
            onExample={fillExample}
            onSubmit={() => void (premium ? (twoSided ? createCase() : submitPremium()) : submit())}
            canSubmit={canSubmit}
            error={error}
            framework={framework}
            onFrameworkChange={setFramework}
            turnstile={
              needsToken ? (
                <Turnstile siteKey={TURNSTILE_SITE_KEY} lang={lang} onToken={setTurnstileToken} />
              ) : null
            }
            tierSwitch={
              availability === "hidden" ? undefined : (
                <TierSwitch
                  lang={lang}
                  availability={availability}
                  value={tier}
                  onChange={setTierChoice}
                  entitlement={viewer.me?.entitlement ?? null}
                  disabled={holding}
                  onPremiumIntent={() => setTierChoice("premium")}
                />
              )
            }
            status={checking ? t(lang, "tier.checking") : creating ? t(lang, "case.creating") : null}
            busy={holding}
            ctaLabel={twoSided ? t(lang, "case.create") : undefined}
            twoSided={twoSided}
            ctaExtra={
              twoSided ? (
                <label className={heroStyles.nameField}>
                  <span className={heroStyles.nameLabel}>{t(lang, "case.displayName")}</span>
                  <input
                    className={heroStyles.nameInput}
                    value={shownCaseName}
                    maxLength={40}
                    autoComplete="given-name"
                    disabled={holding}
                    onChange={(e) => setCaseName(e.target.value)}
                  />
                </label>
              ) : undefined
            }
            extras={
              casesOn || evidenceOn ? (
                <>
                  {casesOn ? (
                    <CaseModeSwitch lang={lang} value={caseMode} onChange={setCaseMode} disabled={holding} />
                  ) : null}
                  {evidenceOn ? (
                    <EvidencePicker
                      lang={lang}
                      max={MAX_EVIDENCE_PER_SIDE}
                      items={evidence.items}
                      full={evidence.full}
                      failure={evidence.failure}
                      overLimit={evidence.overLimit}
                      disabled={holding}
                      onAdd={evidence.add}
                      onRemove={evidence.remove}
                    />
                  ) : null}
                </>
              ) : undefined
            }
            clarify={
              <ClarifyStep
                lang={lang}
                questions={questions}
                answers={answers}
                onAnswer={(id, value) => setAnswers((a) => ({ ...a, [id]: value }))}
                onSubmit={() => finishClarify(false)}
                onSkip={() => finishClarify(true)}
                onBack={() => setPhase("intake")}
              />
            }
            judging={
              <JudgingOverlay
                lang={lang}
                done={response !== null}
                result={response?.result ?? null}
                onFinished={() => setPhase("verdict")}
                premium={judgingPremium}
              />
            }
            verdict={
              response ? (
                <VerdictView
                  result={response.result}
                  nameMap={response.name_map}
                  shareId={response.id}
                  onJudgeAnother={reset}
                  fresh
                  owner={owner}
                />
              ) : null
            }
          />
          <ScrollStory lang={lang} />
        </SceneStage>
        <SampleVerdict lang={lang} />
        <Faq lang={lang} features={viewer.config?.premiumEnabled ? (features ?? null) : null} />
      </main>

      <SiteFooter lang={lang} toggle />
    </div>
  );
}
