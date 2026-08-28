"use client";

import { useState } from "react";
import type { NameMapping, VerdictResult } from "@/lib/types";
import { partyNames } from "@/lib/names";
import { VerdictReveal } from "./VerdictReveal";
import { ArgumentMap } from "./ArgumentMap";
import { FactChips } from "./FactChips";

/** Full verdict display: reveal, argument map, facts, losing side's best point. */
export function VerdictView({
  result,
  nameMap,
  shareId,
}: {
  result: VerdictResult;
  nameMap?: NameMapping[];
  shareId?: string;
}) {
  const { nameA, nameB } = partyNames(nameMap);
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    if (!shareId) return;
    const url = `${window.location.origin}/v/${shareId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this link:", url);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <VerdictReveal result={result} nameA={nameA} nameB={nameB} />

      {!result.model_refused ? (
        <>
          <ArgumentMap
            map={result.argument_map}
            crux={result.crux}
            nameA={nameA}
            nameB={nameB}
          />

          <FactChips facts={result.facts_relied_on} />

          {result.losing_side_best_point ? (
            <section className="rise-in-late">
              <h3
                className="text-xs font-semibold uppercase tracking-wide mb-2"
                style={{ color: "var(--muted)" }}
              >
                🤍 Strongest point for the other side
              </h3>
              <p
                className="rounded-xl px-4 py-3 text-sm leading-snug"
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--ring)",
                  color: "var(--ink-2)",
                }}
              >
                {result.losing_side_best_point}
              </p>
            </section>
          ) : null}
        </>
      ) : null}

      {result.runs.length > 0 ? (
        <p className="text-[11px] text-center" style={{ color: "var(--muted)" }}>
          {result.runs.length} independent AI judge{result.runs.length > 1 ? "s" : ""} voted:{" "}
          {result.runs
            .map((r) =>
              r === "side_a" ? nameA : r === "side_b" ? nameB : r.replace("_", " "),
            )
            .join(" · ")}
        </p>
      ) : null}

      {shareId ? (
        <button
          type="button"
          onClick={copyLink}
          className="rise-in-late rounded-full px-5 py-3 text-sm font-semibold self-center"
          style={{
            background: "var(--ink)",
            color: "var(--plane)",
          }}
        >
          {copied ? "✓ Link copied" : "🔗 Share this verdict"}
        </button>
      ) : null}
    </div>
  );
}
