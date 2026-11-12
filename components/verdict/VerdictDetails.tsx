"use client";

import { useId, useState, type ReactNode } from "react";
import type { CruxTrial, VerdictResult } from "@/lib/types";
import { KIND_KEY, t, type Key, type Lang } from "@/lib/i18n";
import { cruxStyle } from "@/lib/crux-style";
import { stripLeadingEmoji } from "@/lib/text";
import { leanTally } from "@/lib/verdict-display";
import { FactCheckList } from "../FactCheckList";
import { isMany } from "./ManySides";
import { TwoSidedFacts, WouldChangeBlock, evidenceNote, type PartyLabels } from "../case/TwoSidedBlocks";
import styles from "./verdict.module.css";

/** The badge LABEL is one whole dictionary string per language ("Değer
 * tartışması"), never a translated stem + " dispute" suffix, which breaks in
 * an agglutinative language. */
const BADGE_KEY = {
  factual: "badge.factual",
  logical: "badge.logical",
  definitional: "badge.definitional",
  values: "badge.values",
  mixed: "badge.mixed",
} as const satisfies Record<VerdictResult["dispute_type"], Key>;

/** Non-side votes rendered whole from the dictionary — never
 * `r.replace("_", " ")`, which would splice raw English enum words into a
 * Turkish sentence. */
const VOTE_KEY = {
  split: "vote.split",
  conditional: "vote.conditional",
  dissolved: "vote.dissolved",
} as const satisfies Record<string, Key>;

/** "Deniz's best point" when one side won, the plain title otherwise. */
function bestPointTitle(lang: Lang, result: VerdictResult, p: PartyLabels): string {
  if (result.verdict !== "side_a" && result.verdict !== "side_b") return stripLeadingEmoji(t(lang, "bestPointTitle"));
  const loserA = result.verdict === "side_b";
  if (loserA ? p.aIsSelf : p.bIsSelf) return t(lang, "bestPoint.self");
  return t(lang, "bestPoint.of", { name: loserA ? p.nameA : p.nameB });
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 16 16" className={styles.noteIcon} aria-hidden>
      <path
        d="M8 1.8 13 3.6v4c0 3-2.2 5.4-5 6.6-2.8-1.2-5-3.6-5-6.6v-4z"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg viewBox="0 0 16 16" className={styles.noteIcon} aria-hidden>
      <path
        d="M8 2 14.5 13.5h-13z"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      <path d="M8 6.5v3.2" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
      <circle cx={8} cy={11.6} r={0.9} fill="currentColor" />
    </svg>
  );
}

function Chevron() {
  return (
    <svg viewBox="0 0 16 16" className={styles.chev} aria-hidden>
      <path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Outcome of the stress test of a fact/logic winner ruling. Survived is
 * styled neutral, not green: green here means user-checkable verified facts,
 * and a green shield would read as an endorsement badge — exactly the
 * confidence-laundering this app forbids. Doubt always comes with its reason
 * (the referee's, else the objection itself).
 * The dictionary's leading emoji is swapped for a drawn icon. */
function CruxTrialNote({ trial, mixed, lang }: { trial: CruxTrial; mixed: boolean; lang: Lang }) {
  if (trial.outcome === "survived") {
    return (
      <div className={styles.noteBlock}>
        <p className={styles.noteText} style={{ color: "var(--ink-2)" }}>
          <ShieldIcon /> {stripLeadingEmoji(t(lang, "trial.survived"))}
        </p>
        {trial.attack.trim() ? (
          <details className={styles.disclosure}>
            <summary>{t(lang, "trial.whatWasTested")}</summary>
            <p>
              {t(lang, "trial.attackPrefix")} {trial.attack}
            </p>
            {trial.reasoning ? (
              <p>
                {t(lang, "trial.refereePrefix")} {trial.reasoning}
              </p>
            ) : null}
          </details>
        ) : null}
      </div>
    );
  }
  const overturned = trial.outcome === "overturned";
  const why = trial.reasoning.trim() || trial.attack.trim();
  return (
    <div className={styles.noteBlock}>
      <p
        className={overturned ? `${styles.noteText} ${styles.danger}` : styles.noteText}
        style={overturned ? undefined : { color: "var(--ink-2)" }}
      >
        <AlertIcon /> {stripLeadingEmoji(t(lang, overturned ? "trial.overturned" : "trial.uncertain"))}
      </p>
      {why ? (
        <p className={styles.noteText}>
          {t(lang, "trial.refereePrefix")} {why}
        </p>
      ) : null}
      {mixed ? <p className={styles.noteText}>{t(lang, "trial.mixedNote")}</p> : null}
      {trial.reasoning.trim() && trial.attack.trim() ? (
        <details className={styles.disclosure}>
          <summary>{t(lang, "trial.whatWasTested")}</summary>
          <p>
            {t(lang, "trial.attackPrefix")} {trial.attack}
          </p>
        </details>
      ) : null}
    </div>
  );
}

function Detail({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className={styles.detail}>
      {title ? <h3 className={styles.sectionTitle}>{title}</h3> : null}
      {children}
    </section>
  );
}

/**
 * Under the card: rows that open the details (what the ruling turns on, how
 * each side got there, the losing side's best point) and the details
 * themselves. The apps push this as a screen; here it is a panel under the
 * rows, always in the markup (hidden until a row is pressed) so the share
 * page text stays readable without script. Nothing for a refusal.
 */
export function VerdictDetails({
  result,
  parties,
  lang,
  loading = false,
}: {
  result: VerdictResult;
  parties: PartyLabels;
  lang: Lang;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  if (result.model_refused) return null;

  const { nameA, nameB, aIsSelf, bIsSelf } = parties;
  const map = result.argument_map;
  const sideNames = parties.sides;
  const manySides = sideNames && isMany(result) ? (result.sides ?? []) : null;
  const hasSides = manySides
    ? manySides.some((s) => s.bedrock || s.claims.length)
    : Boolean(map.bedrock_a || map.bedrock_b || map.side_a.length || map.side_b.length);
  const lean = result.lean;
  const leanIsSelf = lean ? (lean.party === "a" ? aIsSelf : bIsSelf) : false;
  const leanName = lean ? (lean.party === "a" ? nameA : nameB) : "";
  const twoSided = result.two_sided === true;
  const hasTwoSidedFacts =
    (twoSided || manySides !== null) &&
    Boolean(result.agreed_facts?.length || result.disputed_facts?.length || (manySides && result.disputes?.length));
  const evidenceLine = evidenceNote(result, lang);
  const bestTitle = bestPointTitle(lang, result, parties);
  const rows = [
    result.crux ? stripLeadingEmoji(t(lang, "cruxShort")) : null,
    hasSides ? t(lang, "card.sides") : null,
    result.losing_side_best_point ? bestTitle : null,
  ].filter((r): r is string => r !== null);
  const face = cruxStyle(result.crux) === "serif" ? styles.cruxSerif : styles.cruxSans;

  return (
    <>
      {rows.length ? (
        <div className={styles.rows}>
          {rows.map((title) => (
            <button
              key={title}
              type="button"
              className={styles.row}
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => setOpen(!open)}
            >
              {title}
              <Chevron />
            </button>
          ))}
        </div>
      ) : null}

      <div
        id={panelId}
        hidden={!open}
        className={loading ? `${styles.panel} ${styles.busy}` : styles.panel}
        aria-busy={loading}
      >
        <Detail>
          <div className={styles.badges}>
            <p className={styles.dispute}>{t(lang, BADGE_KEY[result.dispute_type])}</p>
            {twoSided ? <span className={styles.heard}>{t(lang, "twoSided.badge")}</span> : null}
          </div>
          {/* Forced ruling: the confidence on the card scores the MAIN
              verdict; the lean neither borrows it nor gets deflated by it.
              Lean and crux_trial never coexist (trials are winner-only,
              leans are non-winner-only). */}
          {lean ? (
            <div className={styles.noteBlock}>
              <p className={styles.noteTitle}>
                <i
                  aria-hidden
                  className={styles.nameDot}
                  style={{ background: `var(--party-${lean.party}-strong)` }}
                />
                {leanIsSelf ? t(lang, "lean.titleSelf") : t(lang, "lean.title", { name: leanName })}
              </p>
              <p className={styles.noteText}>{lean.reason}</p>
              {result.runs.length >= 2 ? (
                <p className={styles.noteText}>
                  {lean.unanimous
                    ? t(lang, "lean.unanimous")
                    : t(lang, "lean.majority", leanTally(lean, result.runs.length))}
                </p>
              ) : null}
            </div>
          ) : lean === null ? (
            <p className={styles.noteText}>{t(lang, "lean.tie")}</p>
          ) : null}
          {result.crux_trial ? <CruxTrialNote trial={result.crux_trial} mixed={result.dispute_type === "mixed"} lang={lang} /> : null}
          {result.demo ? <p className={styles.noteText}>{stripLeadingEmoji(t(lang, "demoNote"))}</p> : null}
        </Detail>

        {result.crux ? (
          <Detail title={stripLeadingEmoji(t(lang, "cruxShort"))}>
            <p className={`${styles.cruxText} ${face}`}>{result.crux}</p>
          </Detail>
        ) : null}

        {hasSides && manySides && sideNames ? (
          <Detail title={t(lang, "card.sides")}>
            <div className={styles.tiles}>
              {manySides
                .filter((s) => s.bedrock)
                .map((s) => (
                  <div key={s.party} className={styles.tile} data-party={s.party}>
                    <span className={styles.tileName}>{sideNames[s.party].name}</span>
                    <p>{s.bedrock}</p>
                  </div>
                ))}
            </div>
            <h4 className={styles.sectionTitle}>{t(lang, "card.claims")}</h4>
            <ul className={styles.claimList}>
              {manySides.flatMap((s) =>
                s.claims.map((c, i) => (
                  <li key={`${s.party}${i}`} className={styles.claim}>
                    <span className={styles.claimTag} data-party={s.party}>
                      {s.party.toUpperCase()} · {t(lang, KIND_KEY[c.kind])}
                    </span>
                    <span>{c.claim}</span>
                  </li>
                )),
              )}
            </ul>
          </Detail>
        ) : hasSides ? (
          <Detail title={t(lang, "card.sides")}>
            {map.bedrock_a || map.bedrock_b ? (
              <div className={styles.tiles}>
                <div className={styles.tile} data-party="a">
                  <span className={styles.tileName}>{nameA}</span>
                  <p>{map.bedrock_a}</p>
                </div>
                <div className={styles.tile} data-party="b">
                  <span className={styles.tileName}>{nameB}</span>
                  <p>{map.bedrock_b}</p>
                </div>
              </div>
            ) : null}
            <h4 className={styles.sectionTitle}>{t(lang, "card.claims")}</h4>
            <ul className={styles.claimList}>
              {(["a", "b"] as const).flatMap((party) =>
                (party === "a" ? map.side_a : map.side_b).map((c, i) => (
                  <li key={`${party}${i}`} className={styles.claim}>
                    <span className={party === "a" ? styles.claimTag : `${styles.claimTag} ${styles.claimTagB}`}>
                      {party.toUpperCase()} · {t(lang, KIND_KEY[c.kind])}
                    </span>
                    <span>{c.claim}</span>
                  </li>
                )),
              )}
            </ul>
          </Detail>
        ) : null}

        {result.losing_side_best_point ? (
          <Detail title={bestTitle}>
            <p className={styles.bestText}>{result.losing_side_best_point}</p>
          </Detail>
        ) : null}

        {result.facts_relied_on.length ? (
          <Detail title={stripLeadingEmoji(t(lang, "factsTitle"))}>
            <ul className={styles.factList}>
              {result.facts_relied_on.map((f, i) => (
                <li key={i} className={styles.fact}>
                  <span className={styles.factCheck} aria-hidden>
                    <svg viewBox="0 0 10 10">
                      <path
                        d="M2 5.3 4.1 7.3 8 2.9"
                        fill="none"
                        stroke="var(--paper)"
                        strokeWidth={1.6}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </Detail>
        ) : null}

        {hasTwoSidedFacts ? <TwoSidedFacts result={result} lang={lang} parties={parties} /> : null}
        {result.fact_check ? (
          <FactCheckList factCheck={result.fact_check} lang={lang} disputeType={result.dispute_type} />
        ) : null}
        {result.would_change?.length ? <WouldChangeBlock items={result.would_change} lang={lang} /> : null}

        {result.runs.length > 0 ? (
          <p className={styles.footnote}>
            {result.escalated ? (
              <>
                {t(lang, "escalated")}
                <br />
              </>
            ) : null}
            {t(lang, result.runs.length === 1 ? "judgesVoted.one" : "judgesVoted.other", {
              n: result.runs.length,
            })}{" "}
            {result.runs
              .map((r, i) => {
                const vote = manySides && sideNames ? (result.votes?.[i] ?? "other") : null;
                if (vote) return vote === "other" ? t(lang, "vote.split") : sideNames?.[vote]?.name;
                return r === "side_a" ? nameA : r === "side_b" ? nameB : t(lang, VOTE_KEY[r]);
              })
              .join(" · ")}
            {result.tier === "premium" ? (
              <>
                <br />
                {t(lang, "panel.premium")}
              </>
            ) : null}
            {evidenceLine ? (
              <>
                <br />
                {evidenceLine}
              </>
            ) : null}
          </p>
        ) : null}
      </div>
    </>
  );
}
