"use client";

import { useEffect, useRef, useState } from "react";
import { FrameworkPicker } from "@/components/FrameworkPicker";
import { ThinkingDig } from "@/components/ThinkingDig";
import { VerdictView } from "@/components/VerdictView";
import { DEFAULT_FRAMEWORK } from "@/lib/frameworks";
import { ERROR_KEY_BY_CODE, t, type Lang } from "@/lib/i18n";
import { setLang, useLang } from "@/lib/lang";
import { MAX_FINISH_MS } from "@/lib/thinking";
import type { FrameworkChoice, VerdictResponse } from "@/lib/types";

function LangToggle({ lang }: { lang: Lang }) {
  const side = (l: Lang, label: string, aria: string) => {
    const active = lang === l;
    return (
      <button
        type="button"
        aria-pressed={active}
        aria-label={aria}
        onClick={() => setLang(l)}
        className={active ? "text-xs font-semibold" : "text-xs"}
        style={{ color: active ? "var(--ink)" : "var(--muted)" }}
      >
        {label}
      </button>
    );
  };
  return (
    <div className="absolute right-0 top-0 flex items-center gap-1.5">
      {side("tr", "TR", t(lang, "langToggle.toTr"))}
      <span aria-hidden className="text-xs" style={{ color: "var(--muted)" }}>
        |
      </span>
      {side("en", "EN", t(lang, "langToggle.toEn"))}
    </div>
  );
}

export default function Home() {
  const lang = useLang();
  const [argument, setArgument] = useState("");
  const [framework, setFramework] = useState<FrameworkChoice>(DEFAULT_FRAMEWORK);
  const [phase, setPhase] = useState<"intake" | "judging" | "verdict">("intake");
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<VerdictResponse | null>(null);
  const verdictRef = useRef<HTMLDivElement>(null);

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

  async function submit() {
    setError(null);
    setResponse(null);
    setPhase("judging");
    try {
      const res = await fetch("/api/verdict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // lang MUST be sent: the zod default("en") makes forgetting it
        // silent — the toggle would flip the UI while verdicts stay English.
        body: JSON.stringify({ argument, framework, lang }),
      });
      const json = await res.json();
      if (!res.ok) {
        const key =
          typeof json.code === "string" ? ERROR_KEY_BY_CODE[json.code] : undefined;
        setError(
          key !== undefined
            ? t(lang, key)
            : typeof json.error === "string"
              ? json.error
              : t(lang, "errorFallback"),
        );
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
  }

  return (
    <main
      lang={lang}
      className="flex-1 w-full max-w-md mx-auto px-4 py-8 flex flex-col gap-6"
    >
      <header className="relative text-center">
        <LangToggle lang={lang} />
        <h1 className="text-3xl font-black tracking-tight" style={{ color: "var(--ink)" }}>
          ⚖️ Verdict
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--ink-2)" }}>
          {t(lang, "tagline")}
        </p>
      </header>

      {phase === "intake" ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <textarea
            value={argument}
            onChange={(e) => setArgument(e.target.value)}
            placeholder={t(lang, "placeholder")}
            rows={7}
            maxLength={6000}
            required
            minLength={20}
            className="w-full rounded-2xl px-4 py-3 text-sm leading-relaxed resize-y outline-none focus:ring-2"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--ring)",
              color: "var(--ink)",
            }}
          />

          <FrameworkPicker value={framework} onChange={setFramework} />

          {error ? (
            <p className="text-sm text-center" role="alert" style={{ color: "#d03b3b" }}>
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={argument.trim().length < 20}
            className="rounded-full px-5 py-3.5 text-base font-bold disabled:opacity-40"
            style={{ background: "var(--ink)", color: "var(--plane)" }}
          >
            {t(lang, "getVerdict")}
          </button>

          <p className="text-[11px] text-center leading-relaxed" style={{ color: "var(--muted)" }}>
            {t(lang, "privacyNote")}
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
            className="text-sm underline underline-offset-2 self-center pb-6"
            style={{ color: "var(--ink-2)" }}
          >
            {t(lang, "judgeAnother")}
          </button>
        </div>
      ) : null}
    </main>
  );
}
