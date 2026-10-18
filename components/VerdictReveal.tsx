import type { CruxTrial, VerdictResult } from "@/lib/types";
import { t, type Key, type Lang } from "@/lib/i18n";
import { ConfidenceMeter } from "./ConfidenceMeter";

/** Emoji stays local; the badge LABEL is one whole dictionary string per
 * language ("Değer tartışması") — never a translated stem + " dispute"
 * suffix, which breaks in an agglutinative language. */
const TYPE_EMOJI: Record<VerdictResult["dispute_type"], string> = {
  factual: "⚖️",
  logical: "🧠",
  definitional: "💬",
  values: "🧭",
  mixed: "🔀",
};

const BADGE_KEY = {
  factual: "badge.factual",
  logical: "badge.logical",
  definitional: "badge.definitional",
  values: "badge.values",
  mixed: "badge.mixed",
} as const satisfies Record<VerdictResult["dispute_type"], Key>;

/** The self flags are the structural second-person trigger — never a
 * string test on the display name (which cannot see "Sen", and
 * default-locale toLowerCase corrupts Turkish names). */
function verdictLabel(
  r: VerdictResult,
  nameA: string,
  nameB: string,
  aIsSelf: boolean,
  bIsSelf: boolean,
  lang: Lang,
): string {
  switch (r.verdict) {
    case "side_a":
      return aIsSelf ? t(lang, "verdict.winSelf") : t(lang, "verdict.win", { name: nameA });
    case "side_b":
      return bIsSelf ? t(lang, "verdict.winSelf") : t(lang, "verdict.win", { name: nameB });
    case "split":
      return t(lang, "verdict.split");
    case "conditional":
      return t(lang, "verdict.conditional");
    case "dissolved":
      return t(lang, "verdict.dissolved");
    case "too_close":
      return t(lang, "verdict.tooClose");
  }
}

/** Final divider position of the tug-of-war bar (Party A's share, %).
 * A forced-ruling lean nudges the bar to a single fixed 62/38 — visibly
 * off-center yet clearly milder than the 80/20 win, so "more right, not
 * completely" reads at a glance. Deliberately NOT agreement-graded: with one
 * surviving run "unanimous" is vacuous and a stronger bar would overclaim;
 * the agreement note carries that distinction in text. */
function tugFinal(result: VerdictResult): number {
  switch (result.verdict) {
    case "side_a":
      return 80;
    case "side_b":
      return 20;
    default:
      if (result.lean) return result.lean.party === "a" ? 62 : 38;
      return 50;
  }
}

/** Normalize a conditional branch clause for display after the "If"/"Eğer"
 * prefix. BOTH markers are stripped in BOTH branches: share pages can pair
 * tr chrome with English content (and vice versa), and stripping only the
 * chrome-language marker would render a doubled marker — "Eğer If …" — or,
 * worse, tr-lowercase a surviving English "If" into the misspelling "ıf".
 * The tr path lowercases with toLocaleLowerCase("tr") — never
 * default-locale, which turns "İ" into "i̇" — and keeps the capital when the
 * clause starts with the party label "Taraf". */
function conditionalClause(raw: string, lang: Lang): string {
  const s = raw.replace(/^(eğer|if)\s+/i, "");
  if (lang === "tr") {
    if (s.startsWith("Taraf")) return s;
    return s.charAt(0).toLocaleLowerCase("tr") + s.slice(1);
  }
  return /^(You|Your)\b/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

/** Outcome of the adversarial cross-examination of a fact/logic winner
 * ruling. Survived is styled neutral, not green: green here means
 * user-checkable verified facts, and a green shield would read as an
 * endorsement badge — exactly the confidence-laundering this app forbids.
 * "Capped" (never "reduced") because the cap may equal the pre-trial number. */
function CruxTrialNote({ trial, lang }: { trial: CruxTrial; lang: Lang }) {
  if (trial.outcome === "survived") {
    return (
      <>
        <p className="text-xs" style={{ color: "var(--ink-2)" }}>
          {t(lang, "trial.survived")}
        </p>
        {trial.attack.trim() ? (
          <details
            className="text-xs text-left self-stretch"
            style={{ color: "var(--muted)" }}
          >
            <summary className="cursor-pointer">{t(lang, "trial.whatWasTested")}</summary>
            <p className="mt-1">
              {t(lang, "trial.attackPrefix")} {trial.attack}
            </p>
            {trial.reasoning ? (
              <p className="mt-1">
                {t(lang, "trial.refereePrefix")} {trial.reasoning}
              </p>
            ) : null}
          </details>
        ) : null}
      </>
    );
  }
  const overturned = trial.outcome === "overturned";
  return (
    <>
      <p
        className="text-xs"
        style={{ color: overturned ? "#d03b3b" : "var(--ink-2)" }}
      >
        {t(lang, overturned ? "trial.overturned" : "trial.uncertain")}
      </p>
      <p className="text-xs text-left self-stretch" style={{ color: "var(--muted)" }}>
        {t(lang, "trial.attackPrefix")} {trial.attack}
      </p>
      {trial.reasoning ? (
        <p className="text-xs text-left self-stretch" style={{ color: "var(--muted)" }}>
          {t(lang, "trial.refereePrefix")} {trial.reasoning}
        </p>
      ) : null}
    </>
  );
}

/** Gamified reveal: tug-of-war resolves, then the verdict card pops in. */
export function VerdictReveal({
  result,
  nameA,
  nameB,
  aIsSelf,
  bIsSelf,
  lang,
}: {
  result: VerdictResult;
  nameA: string;
  nameB: string;
  aIsSelf: boolean;
  bIsSelf: boolean;
  lang: Lang;
}) {
  const final = tugFinal(result);
  const label = verdictLabel(result, nameA, nameB, aIsSelf, bIsSelf, lang);
  const lean = result.lean;
  const leanIsSelf = lean ? (lean.party === "a" ? aIsSelf : bIsSelf) : false;
  const leanName = lean ? (lean.party === "a" ? nameA : nameB) : "";

  return (
    <section className="flex flex-col gap-3">
      {/* tug-of-war bar */}
      <div>
        <div
          className="flex justify-between text-xs font-semibold mb-1"
          style={{ color: "var(--ink-2)" }}
        >
          <span>
            <span style={{ color: "var(--party-a)" }}>●</span> {nameA}
          </span>
          <span>
            {nameB} <span style={{ color: "var(--party-b)" }}>●</span>
          </span>
        </div>
        <div
          className="relative h-4 rounded-full overflow-hidden"
          style={{ background: "var(--party-b)" }}
          role="img"
          aria-label={t(lang, "verdictAria", { label })}
        >
          <div
            className="tug-a absolute inset-y-0 left-0"
            style={{
              background: "var(--party-a)",
              ["--tug-final" as string]: `${final}%`,
              borderRight: "2px solid var(--surface)",
            }}
          />
        </div>
      </div>

      {/* verdict card */}
      <div
        className="pop-in rounded-2xl px-5 py-5 text-center flex flex-col items-center gap-2"
        style={{
          background: "var(--surface)",
          border: "1px solid var(--ring)",
          boxShadow: "0 8px 30px rgba(0,0,0,0.08)",
        }}
      >
        <span
          className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide rounded-full px-3 py-1"
          style={{ background: "var(--plane)", border: "1px solid var(--ring)", color: "var(--ink-2)" }}
        >
          <span aria-hidden>{TYPE_EMOJI[result.dispute_type]}</span>{" "}
          {t(lang, BADGE_KEY[result.dispute_type])}
        </span>

        <h2 className="text-2xl font-bold leading-tight" style={{ color: "var(--ink)" }}>
          {label}
        </h2>
        <p className="text-sm" style={{ color: "var(--ink-2)" }}>
          {result.headline}
        </p>
        {/* Non-winner verdicts state the exception test they met, so the
            reader can check why no single side won. */}
        {result.exception_basis ? (
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            <span className="font-semibold">{t(lang, "exceptionBasis")}</span>{" "}
            {result.exception_basis}
          </p>
        ) : null}

        <ConfidenceMeter value={result.confidence} lang={lang} />

        {/* Forced ruling: directly BELOW the meter — the meter scores the
            MAIN verdict and stays bound to the headline; the lean neither
            borrows the meter's confidence nor gets deflated by it. Lean and
            crux_trial never coexist (trials are winner-only, leans are
            non-winner-only), so this shares the trial-note slot. */}
        {lean ? (
          <>
            <p className="text-sm font-semibold" style={{ color: "var(--ink)" }}>
              <span
                aria-hidden
                style={{ color: lean.party === "a" ? "var(--party-a)" : "var(--party-b)" }}
              >
                ●
              </span>{" "}
              {leanIsSelf ? t(lang, "lean.titleSelf") : t(lang, "lean.title", { name: leanName })}
            </p>
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              {lean.reason}
            </p>
            {result.runs.length >= 2 ? (
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                {t(
                  lang,
                  lean.unanimous ? "lean.unanimous" : lean.tiebreak ? "lean.tiebreak" : "lean.majority",
                )}
              </p>
            ) : null}
          </>
        ) : lean === null ? (
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            {t(lang, "lean.tie")}
          </p>
        ) : null}

        {result.crux_trial ? <CruxTrialNote trial={result.crux_trial} lang={lang} /> : null}

        {result.model_refused ? (
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            {t(lang, "refusedNote")}
          </p>
        ) : null}
        {result.demo ? (
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            {t(lang, "demoNote")}
          </p>
        ) : null}
      </div>

      {/* split / conditional branches */}
      {result.verdict === "split" && result.split_points?.length ? (
        <div className="rise-in grid gap-2">
          {result.split_points.map((p, i) => {
            const isSelf = p.party === "a" ? aIsSelf : bIsSelf;
            const name = p.party === "a" ? nameA : nameB;
            return (
              <div
                key={i}
                className="rounded-xl px-4 py-3 text-sm"
                style={{
                  background: p.party === "a" ? "var(--party-a-soft)" : "var(--party-b-soft)",
                  borderLeft: `3px solid ${p.party === "a" ? "var(--party-a)" : "var(--party-b)"}`,
                  color: "var(--ink)",
                }}
              >
                <span className="font-semibold">
                  {t(lang, isSelf ? "splitWinSelf" : "splitWin", { name })}
                </span>{" "}
                {p.point}
              </div>
            );
          })}
        </div>
      ) : null}

      {result.verdict === "conditional" && result.conditional?.length ? (
        <div className="rise-in grid gap-2">
          {result.conditional.map((c, i) => (
            <div
              key={i}
              className="rounded-xl px-4 py-3 text-sm"
              style={{
                background: "var(--surface)",
                border: "1px solid var(--ring)",
                color: "var(--ink)",
              }}
            >
              <span className="font-semibold" style={{ color: "var(--ink-2)" }}>
                {t(lang, "ifPrefix")} {conditionalClause(c.if_value, lang)}
              </span>
              <span aria-hidden> → </span>
              {c.then}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
