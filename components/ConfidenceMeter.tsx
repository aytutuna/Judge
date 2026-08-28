const LABELS = ["", "Very low", "Low", "Moderate", "High", "Very high"];

export function ConfidenceMeter({ value }: { value: number }) {
  const v = Math.max(1, Math.min(5, Math.round(value)));
  return (
    <div
      className="flex items-center gap-2"
      role="meter"
      aria-valuemin={1}
      aria-valuemax={5}
      aria-valuenow={v}
      aria-label={`Confidence ${v} of 5`}
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
        {LABELS[v]} confidence · {v}/5
      </span>
    </div>
  );
}
