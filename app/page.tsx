"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { FrameworkPicker } from "@/components/FrameworkPicker";
import { Faq, HowItWorks, SampleVerdict } from "@/components/HomeSections";
import { SiteFooter, SiteHeader, SkipLink } from "@/components/SiteChrome";
import { ThinkingDig } from "@/components/ThinkingDig";
import { Turnstile, TURNSTILE_SITE_KEY } from "@/components/Turnstile";
import { VerdictView } from "@/components/VerdictView";
import { DEFAULT_FRAMEWORK, getPreset } from "@/lib/frameworks";
import { apiErrorMessage, t, type Key } from "@/lib/i18n";
import { useLang } from "@/lib/lang";
import { MAX_FINISH_MS } from "@/lib/thinking";
import type { FrameworkChoice, VerdictResponse } from "@/lib/types";

const EXAMPLES = [
  { label: "example.hotdog.label", text: "example.hotdog.text" },
  { label: "example.tomato.label", text: "example.tomato.text" },
  { label: "example.whiteLie.label", text: "example.whiteLie.text" },
  { label: "example.knuckles.label", text: "example.knuckles.text" },
  { label: "example.pineapple.label", text: "example.pineapple.text" },
] as const satisfies readonly { label: Key; text: Key }[];

export default function Home() {
  const lang = useLang();
  const [argument, setArgument] = useState("");
  const [framework, setFramework] = useState<FrameworkChoice>(DEFAULT_FRAMEWORK);
  const [phase, setPhase] = useState<"intake" | "judging" | "verdict">("intake");
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<VerdictResponse | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const verdictRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Belt and braces: if the thinking scene has not handed off shortly after
  // the response arrived, show the verdict anyway.
  useEffect(() => {
    if (phase !== "judging" || response === null) return;
    const t = setTimeout(() => setPhase("verdict"), MAX_FINISH_MS + 2000);
    return () => clearTimeout(t);
  }, [phase, response]);

  // Move focus to the verdict so a screen reader reads its heading next,
  // not stale scene captions.
  useEffect(() => {
    if (phase === "verdict") verdictRef.current?.focus({ preventScroll: true });
  }, [phase]);

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

  function reset() {
    setResponse(null);
    setArgument("");
    setPhase("intake");
    window.scrollTo({ top: 0 });
  }

  function fillExample(key: Key) {
    setArgument(t(lang, key));
    setError(null);
    inputRef.current?.focus();
  }

  const preset = getPreset(framework.preset);
  const presetLabel = `${preset.emoji} ${t(lang, `preset.${preset.id}.label`)}`;

  return (
    <div lang={lang} className="contents">
      <SkipLink lang={lang} />
      <SiteHeader lang={lang} toggle howLink />

      <main
        id="main"
        tabIndex={-1}
        className="flex-1 w-full max-w-3xl mx-auto px-4 pt-8 sm:pt-14 flex flex-col gap-20 outline-none"
      >
        <section aria-labelledby="hero-title" className="w-full max-w-xl mx-auto flex flex-col gap-6">
          <div className="text-center flex flex-col gap-3">
            <h1
              id="hero-title"
              className="hero-title text-4xl sm:text-5xl font-black tracking-tight leading-[1.05]"
              style={{ color: "var(--ink)" }}
            >
              {t(lang, "hero.title")}
            </h1>
            {phase === "intake" ? (
              <p className="text-base leading-relaxed" style={{ color: "var(--ink-2)" }}>
                {t(lang, "hero.lead")}
              </p>
            ) : null}
          </div>

          {phase === "intake" ? (
            <form
              className="flex flex-col gap-4 rounded-3xl p-3 sm:p-4"
              style={{
                background: "var(--surface)",
                border: "1px solid var(--line)",
                boxShadow: "0 12px 40px rgba(0,0,0,0.06)",
              }}
              onSubmit={(e) => {
                e.preventDefault();
                if (canSubmit) void submit();
              }}
            >
              <label htmlFor="argument" className="sr-only">
                {t(lang, "input.label")}
              </label>
              <textarea
                id="argument"
                ref={inputRef}
                value={argument}
                onChange={(e) => setArgument(e.target.value)}
                placeholder={t(lang, "placeholder")}
                rows={7}
                maxLength={6000}
                required
                minLength={20}
                className="w-full rounded-2xl px-4 py-3 text-base sm:text-sm leading-relaxed resize-y"
                style={{
                  background: "var(--plane)",
                  border: "1px solid var(--ring)",
                  color: "var(--ink)",
                }}
              />

              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium px-1" style={{ color: "var(--muted)" }}>
                  {t(lang, "examples.label")}
                </p>
                <ul className="flex flex-wrap gap-1.5">
                  {EXAMPLES.map((ex) => (
                    <li key={ex.label}>
                      <button
                        type="button"
                        onClick={() => fillExample(ex.text)}
                        className="chip rounded-full px-3 py-1.5 text-sm text-left"
                        style={{
                          background: "var(--plane)",
                          border: "1px solid var(--ring)",
                          color: "var(--ink-2)",
                        }}
                      >
                        {t(lang, ex.label)}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              <details className="advanced rounded-2xl px-3" style={{ border: "1px solid var(--ring)" }}>
                <summary
                  className="flex cursor-pointer items-center justify-between gap-2 py-2.5 text-sm font-medium"
                  style={{ color: "var(--ink-2)" }}
                >
                  <span>
                    <span aria-hidden className="advanced-caret inline-block">▸</span>{" "}
                    {t(lang, "advanced.summary")}
                  </span>
                  <span className="text-xs truncate" style={{ color: "var(--muted)" }}>
                    {t(lang, "advanced.current", { label: presetLabel })}
                  </span>
                </summary>
                <div className="pb-3">
                  <FrameworkPicker value={framework} onChange={setFramework} />
                </div>
              </details>

              {needsToken ? (
                <Turnstile siteKey={TURNSTILE_SITE_KEY} lang={lang} onToken={setTurnstileToken} />
              ) : null}

              {error ? (
                <p className="text-sm text-center" role="alert" style={{ color: "var(--danger)" }}>
                  {error}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={!canSubmit}
                className="rounded-full px-5 py-3.5 text-base font-bold transition-transform active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100"
                style={{ background: "var(--ink)", color: "var(--plane)" }}
              >
                {t(lang, "getVerdict")}
              </button>

              <p className="text-xs text-center leading-relaxed px-2" style={{ color: "var(--muted)" }}>
                {t(lang, "privacyNote")}{" "}
                <Link href="/privacy" className="underline underline-offset-2 rounded-sm" style={{ color: "var(--ink-2)" }}>
                  {t(lang, "privacyLink")}
                </Link>
              </p>
            </form>
          ) : null}

          {phase === "judging" ? (
            <ThinkingDig done={response !== null} onFinished={() => setPhase("verdict")} />
          ) : null}

          {phase === "verdict" && response ? (
            <div ref={verdictRef} tabIndex={-1} className="outline-none flex flex-col gap-6">
              <VerdictView
                result={response.result}
                nameMap={response.name_map}
                shareId={response.id}
              />
              <button
                type="button"
                onClick={reset}
                className="text-sm underline underline-offset-2 self-center rounded-sm"
                style={{ color: "var(--ink-2)" }}
              >
                {t(lang, "judgeAnother")}
              </button>
            </div>
          ) : null}
        </section>

        <HowItWorks lang={lang} />
        <SampleVerdict lang={lang} />
        <Faq lang={lang} />
      </main>

      <SiteFooter lang={lang} toggle />
    </div>
  );
}
