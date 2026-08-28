export function FactChips({ facts }: { facts: string[] }) {
  if (!facts.length) return null;
  return (
    <section className="rise-in-late">
      <h3
        className="text-xs font-semibold uppercase tracking-wide mb-2"
        style={{ color: "var(--muted)" }}
      >
        Facts this verdict leans on — check them
      </h3>
      <ul className="flex flex-col gap-1.5">
        {facts.map((f, i) => (
          <li
            key={i}
            className="flex items-start gap-2 rounded-lg px-3 py-2 text-sm"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--ring)",
              color: "var(--ink-2)",
            }}
          >
            <span aria-hidden style={{ color: "var(--good)" }}>
              ✓
            </span>
            <span>{f}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
