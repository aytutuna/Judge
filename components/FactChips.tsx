import { t, type Lang } from "@/lib/i18n";

export function FactChips({ facts, lang = "en" }: { facts: string[]; lang?: Lang }) {
  if (!facts.length) return null;
  return (
    <section className="rise-in-late">
      <h3
        className="text-xs font-semibold uppercase tracking-wide mb-2"
        style={{ color: "var(--muted)" }}
      >
        {t(lang, "factsTitle")}
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
