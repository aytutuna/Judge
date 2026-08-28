"use client";

import { useEffect, useRef, useState } from "react";
import { FrameworkPicker } from "@/components/FrameworkPicker";
import { VerdictView } from "@/components/VerdictView";
import { DEFAULT_FRAMEWORK } from "@/lib/frameworks";
import type { FrameworkChoice, VerdictResponse } from "@/lib/types";

const STAGES = [
  "Reading both sides…",
  "Steelmanning the weaker telling…",
  "Labeling claims: fact · value · definition · logic…",
  "Digging down to bedrock…",
  "Locating the crux…",
  "Three independent judges deliberating…",
  "Counting the votes…",
];

const PLACEHOLDER =
  "Describe the argument. Who says what, and why?\n\nInclude the other person's side as they would state it — the judge steelmans both sides either way.";

export default function Home() {
  const [argument, setArgument] = useState("");
  const [framework, setFramework] = useState<FrameworkChoice>(DEFAULT_FRAMEWORK);
  const [phase, setPhase] = useState<"intake" | "judging" | "verdict">("intake");
  const [stage, setStage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<VerdictResponse | null>(null);
  const stageTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (phase === "judging") {
      stageTimer.current = setInterval(
        () => setStage((s) => Math.min(s + 1, STAGES.length - 1)),
        7000,
      );
    }
    return () => {
      if (stageTimer.current) clearInterval(stageTimer.current);
    };
  }, [phase]);

  async function submit() {
    setError(null);
    setStage(0);
    setPhase("judging");
    try {
      const res = await fetch("/api/verdict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ argument, framework }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error ?? "Something went wrong");
      }
      setResponse(json as VerdictResponse);
      setPhase("verdict");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setPhase("intake");
    }
  }

  function reset() {
    setResponse(null);
    setArgument("");
    setPhase("intake");
  }

  return (
    <main className="flex-1 w-full max-w-md mx-auto px-4 py-8 flex flex-col gap-6">
      <header className="text-center">
        <h1 className="text-3xl font-black tracking-tight" style={{ color: "var(--ink)" }}>
          ⚖️ Verdict
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--ink-2)" }}>
          Tell it the argument. It digs to bedrock and rules.
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
            placeholder={PLACEHOLDER}
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
            Get the verdict
          </button>

          <p className="text-[11px] text-center leading-relaxed" style={{ color: "var(--muted)" }}>
            Names are replaced with Party A / Party B before judging — the judge
            never knows who is who, and only the anonymous version is stored.
          </p>
        </form>
      ) : null}

      {phase === "judging" ? (
        <div className="flex flex-col items-center gap-4 py-14" aria-live="polite">
          <span className="weigh text-6xl" aria-hidden>
            ⚖️
          </span>
          <p className="text-sm font-medium" style={{ color: "var(--ink-2)" }}>
            {STAGES[stage]}
          </p>
          <p className="text-[11px]" style={{ color: "var(--muted)" }}>
            Three separate AI judges rule independently — this takes a minute.
          </p>
        </div>
      ) : null}

      {phase === "verdict" && response ? (
        <>
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
            Judge another argument
          </button>
        </>
      ) : null}
    </main>
  );
}
