"use client";

import { useEffect, useRef, useState } from "react";
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

/** What a premium request judges, fixed when it is submitted. */
type PremiumInput = { argument: string; framework: FrameworkChoice };

export default function Home() {
  const lang = useLang();
  const [argument, setArgument] = useState("");
  const [framework, setFramework] = useState<FrameworkChoice>(DEFAULT_FRAMEWORK);
  const [phase, setPhase] = useState<HeroPhase>("intake");
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<VerdictResponse | null>(null);
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

  const availability = tierAvailability(viewer.config, viewer.me);
  const tier = effectiveTier(availability, tierChoice);
  const premium = tier === "premium";

  // Belt and braces: if the judging animation has not handed off shortly
  // after the response arrived, show the verdict anyway.
  useEffect(() => {
    if (phase !== "judging" || response === null) return;
    const t = setTimeout(() => setPhase("verdict"), MAX_FINISH_MS + 2000);
    return () => clearTimeout(t);
  }, [phase, response]);

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

  // Premium skips the human check: the signed-in account is the gate.
  const needsToken = TURNSTILE_SITE_KEY !== "" && !premium;
  const canSubmit =
    argument.trim().length >= 20 && !checking && (!needsToken || turnstileToken !== null);

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
        headers: { "Content-Type": "application/json" },
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
      setResponse(json as VerdictResponse);
    } catch {
      setError(t(lang, "errorFallback"));
      setPhase("intake");
    }
  }

  /** Premium step 1: ask whether key facts are missing. Network trouble or
   * a server error never blocks the verdict: it just goes ahead without
   * questions. Account problems (401/402) and bad input stop on the form. */
  async function submitPremium() {
    // Judged as submitted: later edits never mix into this request.
    const input: PremiumInput = { argument, framework };
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
    });
    const key = keyFor(body);
    const waitUntil = Date.now() + IN_PROGRESS_WAIT_MS;
    try {
      for (;;) {
        const res = await fetch("/api/v1/verdict", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": key },
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
        if (premiumKey.current?.key === key) premiumKey.current = null;
        const verdict = json as VerdictApiResponse;
        if (verdict.entitlement) applyEntitlement(verdict.entitlement);
        setResponse(verdict);
        return;
      }
    } catch {
      setError(t(lang, "errorFallback"));
      setPhase("intake");
    }
  }

  function finishClarify(skip: boolean) {
    const input = premiumInput.current;
    if (!input) return;
    void judgePremium(input, buildClarifications(questions, answers, skip));
  }

  // The hero focuses the textarea once the form is back.
  function reset() {
    resetScene();
    setResponse(null);
    setArgument("");
    setQuestions([]);
    setAnswers({});
    setJudgingPremium(false);
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
            onSubmit={() => void (premium ? submitPremium() : submit())}
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
                  disabled={checking}
                  onPremiumIntent={() => setTierChoice("premium")}
                />
              )
            }
            status={checking ? t(lang, "tier.checking") : null}
            busy={checking}
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
                />
              ) : null
            }
          />
          <ScrollStory lang={lang} />
        </SceneStage>
        <SampleVerdict lang={lang} />
        <Faq lang={lang} />
      </main>

      <SiteFooter lang={lang} toggle />
    </div>
  );
}
