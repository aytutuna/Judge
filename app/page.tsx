"use client";

import { useEffect, useState } from "react";
import { Faq } from "@/components/home/Faq";
import { Hero } from "@/components/home/Hero";
import { SampleVerdict } from "@/components/home/SampleVerdict";
import { ScrollStory } from "@/components/home/ScrollStory";
import { JudgingOverlay } from "@/components/JudgingOverlay";
import { SceneStage } from "@/components/scene/SceneStage";
import { SiteFooter, SiteHeader, SkipLink } from "@/components/SiteChrome";
import { Turnstile, TURNSTILE_SITE_KEY } from "@/components/Turnstile";
import { VerdictView } from "@/components/VerdictView";
import { DEFAULT_FRAMEWORK } from "@/lib/frameworks";
import { apiErrorMessage, t, type Key } from "@/lib/i18n";
import { useLang } from "@/lib/lang";
import { nudgeScene, resetScene } from "@/lib/scene-bridge";
import { MAX_FINISH_MS } from "@/lib/thinking";
import type { FrameworkChoice, VerdictResponse } from "@/lib/types";

export default function Home() {
  const lang = useLang();
  const [argument, setArgument] = useState("");
  const [framework, setFramework] = useState<FrameworkChoice>(DEFAULT_FRAMEWORK);
  const [phase, setPhase] = useState<"intake" | "judging" | "verdict">("intake");
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<VerdictResponse | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

  // Belt and braces: if the judging animation has not handed off shortly
  // after the response arrived, show the verdict anyway.
  useEffect(() => {
    if (phase !== "judging" || response === null) return;
    const t = setTimeout(() => setPhase("verdict"), MAX_FINISH_MS + 2000);
    return () => clearTimeout(t);
  }, [phase, response]);

  const needsToken = TURNSTILE_SITE_KEY !== "";
  const canSubmit = argument.trim().length >= 20 && (!needsToken || turnstileToken !== null);

  async function submit() {
    // Turnstile tokens are single-use: take it now, and the widget remounts
    // with a fresh one whenever the form comes back.
    const token = turnstileToken;
    setTurnstileToken(null);
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

  // The hero focuses the textarea once the form is back.
  function reset() {
    resetScene();
    setResponse(null);
    setArgument("");
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
            onSubmit={() => void submit()}
            canSubmit={canSubmit}
            error={error}
            framework={framework}
            onFrameworkChange={setFramework}
            turnstile={
              needsToken ? (
                <Turnstile siteKey={TURNSTILE_SITE_KEY} lang={lang} onToken={setTurnstileToken} />
              ) : null
            }
            judging={
              <JudgingOverlay
                lang={lang}
                done={response !== null}
                result={response?.result ?? null}
                onFinished={() => setPhase("verdict")}
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
