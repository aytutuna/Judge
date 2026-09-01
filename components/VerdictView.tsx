"use client";

import { useState } from "react";
import type { NameMapping, VerdictResult } from "@/lib/types";
import { t, type Key, type Lang } from "@/lib/i18n";
import { useLang } from "@/lib/lang";
import { partyNames } from "@/lib/names";
import { VerdictReveal } from "./VerdictReveal";
import { ArgumentMap } from "./ArgumentMap";
import { FactChips } from "./FactChips";

/** Non-side votes rendered whole from the dictionary — never
 * `r.replace("_", " ")`, which would splice raw English enum words into a
 * Turkish sentence. */
const VOTE_KEY = {
  split: "vote.split",
  conditional: "vote.conditional",
  dissolved: "vote.dissolved",
} as const satisfies Record<string, Key>;

/** Full verdict display: reveal, argument map, facts, losing side's best point.
 * `lang` prop: the share page passes its Accept-Language value (the store is
 * the viewer's own preference and never applies there); the main page passes
 * nothing and the store wins. */
export function VerdictView({
  result,
  nameMap,
  shareId,
  lang: langProp,
}: {
  result: VerdictResult;
  nameMap?: NameMapping[];
  shareId?: string;
  lang?: Lang;
}) {
  const storeLang = useLang();
  const lang = langProp ?? storeLang;
  const { nameA, nameB, aIsSelf, bIsSelf } = partyNames(nameMap, lang);
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    if (!shareId) return;
    const url = `${window.location.origin}/v/${shareId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt(t(lang, "copyPrompt"), url);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <VerdictReveal
        result={result}
        nameA={nameA}
        nameB={nameB}
        aIsSelf={aIsSelf}
        bIsSelf={bIsSelf}
        lang={lang}
      />

      {!result.model_refused ? (
        <>
          <ArgumentMap
            map={result.argument_map}
            crux={result.crux}
            nameA={nameA}
            nameB={nameB}
            lang={lang}
          />

          <FactChips facts={result.facts_relied_on} lang={lang} />

          {result.losing_side_best_point ? (
            <section className="rise-in-late">
              <h3
                className="text-xs font-semibold uppercase tracking-wide mb-2"
                style={{ color: "var(--muted)" }}
              >
                {t(lang, "bestPointTitle")}
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
          {t(lang, result.runs.length === 1 ? "judgesVoted.one" : "judgesVoted.other", {
            n: result.runs.length,
          })}{" "}
          {result.runs
            .map((r) =>
              r === "side_a" ? nameA : r === "side_b" ? nameB : t(lang, VOTE_KEY[r]),
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
          {copied ? t(lang, "copied") : t(lang, "share")}
        </button>
      ) : null}
    </div>
  );
}
