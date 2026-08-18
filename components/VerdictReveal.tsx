import type { VerdictResult } from "@/lib/types";
import { ConfidenceMeter } from "./ConfidenceMeter";

const TYPE_BADGE: Record<VerdictResult["dispute_type"], { emoji: string; label: string }> = {
  factual: { emoji: "⚖️", label: "Factual" },
  logical: { emoji: "🧠", label: "Logical" },
  definitional: { emoji: "💬", label: "Definitional" },
  values: { emoji: "🧭", label: "Values" },
  mixed: { emoji: "🔀", label: "Mixed" },
};

function verdictLabel(r: VerdictResult, nameA: string, nameB: string): string {
  const wins = (n: string) => (n.toLowerCase() === "you" ? "You're right" : `${n} is right`);
  switch (r.verdict) {
    case "side_a":
      return wins(nameA);
    case "side_b":
      return wins(nameB);
    case "split":
      return "Split decision";
    case "conditional":
      return "It depends on your values";
    case "dissolved":
      return "Same word, different meanings";
    case "too_close":
      return "Too close to call";
  }
}

/** Final divider position of the tug-of-war bar (Party A's share, %). */
function tugFinal(verdict: VerdictResult["verdict"]): number {
  switch (verdict) {
    case "side_a":
      return 80;
    case "side_b":
      return 20;
    default:
      return 50;
  }
}

/** Gamified reveal: tug-of-war resolves, then the verdict card pops in. */
export function VerdictReveal({
  result,
  nameA,
  nameB,
}: {
  result: VerdictResult;
  nameA: string;
  nameB: string;
}) {
  const badge = TYPE_BADGE[result.dispute_type];
  const final = tugFinal(result.verdict);

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
          aria-label={`Verdict: ${verdictLabel(result, nameA, nameB)}`}
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
          <span aria-hidden>{badge.emoji}</span> {badge.label} dispute
        </span>

        <h2 className="text-2xl font-bold leading-tight" style={{ color: "var(--ink)" }}>
          {verdictLabel(result, nameA, nameB)}
        </h2>
        <p className="text-sm" style={{ color: "var(--ink-2)" }}>
          {result.headline}
        </p>

        <ConfidenceMeter value={result.confidence} />

        {result.model_refused ? (
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            The AI declined to judge this one — no verdict beats a fake one.
          </p>
        ) : null}
        {result.demo ? (
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            🎭 Demo mode — sample verdict, no AI key configured
          </p>
        ) : null}
      </div>

      {/* split / conditional branches */}
      {result.verdict === "split" && result.split_points?.length ? (
        <div className="rise-in grid gap-2">
          {result.split_points.map((p, i) => (
            <div
              key={i}
              className="rounded-xl px-4 py-3 text-sm"
              style={{
                background: p.party === "a" ? "var(--party-a-soft)" : "var(--party-b-soft)",
                borderLeft: `3px solid ${p.party === "a" ? "var(--party-a)" : "var(--party-b)"}`,
                color: "var(--ink)",
              }}
            >
              <span className="font-semibold">{p.party === "a" ? nameA : nameB} is right:</span>{" "}
              {p.point}
            </div>
          ))}
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
                If{" "}
                {(() => {
                  const s = c.if_value.replace(/^if\s+/i, "");
                  return /^(You|Your)\b/.test(s)
                    ? s.charAt(0).toLowerCase() + s.slice(1)
                    : s;
                })()}
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
