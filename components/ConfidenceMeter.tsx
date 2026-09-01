import { t, type Key, type Lang } from "@/lib/i18n";

/** Indexed by clamped value - 1 — a typed lookup, no `as Key` cast. */
const CONF_KEY = [
  "confidence.1",
  "confidence.2",
  "confidence.3",
  "confidence.4",
  "confidence.5",
] as const satisfies readonly Key[];

export function ConfidenceMeter({ value, lang = "en" }: { value: number; lang?: Lang }) {
  const v = Math.max(1, Math.min(5, Math.round(value)));
  const word = t(lang, CONF_KEY[v - 1]);
  return (
    <div
      className="flex items-center gap-2"
      role="meter"
      aria-valuemin={1}
      aria-valuemax={5}
      aria-valuenow={v}
      aria-label={t(lang, "confidenceAria", { n: v })}
    >
      <div className="flex gap-1.5">
        {[1, 2, 3, 4, 5].map((i) => (
          <span
            key={i}
            className={i <= v ? "dot-fill" : undefined}
            style={{
              width: 10,
              height: 10,
              borderRadius: 999,
              background: i <= v ? "var(--ink)" : "transparent",
              border: `1.5px solid ${i <= v ? "var(--ink)" : "var(--muted)"}`,
              animationDelay: `${2 + i * 0.12}s`,
              display: "inline-block",
            }}
          />
        ))}
      </div>
      <span className="text-xs" style={{ color: "var(--ink-2)" }}>
        {t(lang, "confidenceWord", { word, n: v })}
      </span>
    </div>
  );
}
