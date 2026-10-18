import { t, type Key, type Lang } from "@/lib/i18n";
import { ConfidenceMeter } from "./ConfidenceMeter";

/** Below-the-fold homepage sections. Static markup, no hooks: the parent
 * passes the language. */

export const HOW_STEPS = [
  { emoji: "🛡️", title: "how.step1.title", body: "how.step1.body" },
  { emoji: "🏷️", title: "how.step2.title", body: "how.step2.body" },
  { emoji: "⚡", title: "how.step3.title", body: "how.step3.body" },
  { emoji: "⚖️", title: "how.step4.title", body: "how.step4.body" },
  { emoji: "🧾", title: "how.step5.title", body: "how.step5.body" },
] as const satisfies readonly { emoji: string; title: Key; body: Key }[];

function SectionHeading({ id, title, lead }: { id: string; title: string; lead?: string }) {
  return (
    <div className="flex flex-col gap-1.5 text-center">
      <h2 id={id} className="text-2xl font-black tracking-tight" style={{ color: "var(--ink)" }}>
        {title}
      </h2>
      {lead ? (
        <p className="text-sm max-w-md mx-auto" style={{ color: "var(--ink-2)" }}>
          {lead}
        </p>
      ) : null}
    </div>
  );
}

/** The five steps as a numbered timeline, with a one-line pipeline strip on
 * top as the compact visual (decorative; the list carries the meaning). */
export function HowItWorks({ lang }: { lang: Lang }) {
  return (
    <section id="how" aria-labelledby="how-title" className="scroll-mt-6 flex flex-col gap-6">
      <SectionHeading id="how-title" title={t(lang, "how.title")} lead={t(lang, "how.lead")} />

      <div
        aria-hidden
        className="flex items-center justify-center gap-1.5 sm:gap-3 text-xl sm:text-2xl select-none"
      >
        {HOW_STEPS.map((s, i) => (
          <span key={s.title} className="flex items-center gap-1.5 sm:gap-3">
            <span
              className="flex items-center justify-center rounded-full"
              style={{
                width: 44,
                height: 44,
                background: "var(--surface)",
                border: "1px solid var(--ring)",
              }}
            >
              {s.emoji}
            </span>
            {i < HOW_STEPS.length - 1 ? (
              <span className="text-sm" style={{ color: "var(--muted)" }}>
                →
              </span>
            ) : null}
          </span>
        ))}
      </div>

      <ol className="grid gap-3 sm:grid-cols-2">
        {HOW_STEPS.map((s, i) => (
          <li
            key={s.title}
            className={[
              "flex gap-3 rounded-2xl px-4 py-4",
              i === HOW_STEPS.length - 1 ? "sm:col-span-2" : "",
            ].join(" ")}
            style={{ background: "var(--surface)", border: "1px solid var(--ring)" }}
          >
            <span
              aria-hidden
              className="flex shrink-0 items-center justify-center rounded-full text-xs font-bold"
              style={{ width: 26, height: 26, background: "var(--ink)", color: "var(--plane)" }}
            >
              {i + 1}
            </span>
            <div className="flex flex-col gap-1 min-w-0">
              <h3 className="text-sm font-bold" style={{ color: "var(--ink)" }}>
                <span aria-hidden>{s.emoji}</span> {t(lang, s.title)}
              </h3>
              <p className="text-sm leading-snug" style={{ color: "var(--ink-2)" }}>
                {t(lang, s.body)}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** A static, clearly badged example in the same visual language as the real
 * verdict card: tug bar, badge, label, headline, meter, crux, best point. */
export function SampleVerdict({ lang }: { lang: Lang }) {
  const nameA = t(lang, "sample.nameA");
  const nameB = t(lang, "sample.nameB");
  return (
    <section aria-labelledby="sample-title" className="flex flex-col gap-6">
      <SectionHeading id="sample-title" title={t(lang, "sample.title")} lead={t(lang, "sample.lead")} />

      <figure
        className="relative mx-auto w-full max-w-md rounded-3xl px-4 py-5 sm:px-6 flex flex-col gap-4"
        style={{
          background: "var(--plane)",
          border: "1px solid var(--line)",
          boxShadow: "0 12px 40px rgba(0,0,0,0.06)",
        }}
      >
        <span
          className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
          style={{ background: "var(--ink)", color: "var(--plane)" }}
        >
          {t(lang, "sample.badge")}
        </span>

        <div>
          <div
            className="flex justify-between text-xs font-semibold mb-1"
            style={{ color: "var(--ink-2)" }}
          >
            <span>
              <span aria-hidden style={{ color: "var(--party-a)" }}>●</span> {nameA}
            </span>
            <span>
              {nameB} <span aria-hidden style={{ color: "var(--party-b)" }}>●</span>
            </span>
          </div>
          <div
            className="relative h-3 rounded-full overflow-hidden"
            style={{ background: "var(--party-b)" }}
            aria-hidden
          >
            <div
              className="absolute inset-y-0 left-0"
              style={{
                width: "20%",
                background: "var(--party-a)",
                borderRight: "2px solid var(--surface)",
              }}
            />
          </div>
        </div>

        <div
          className="rounded-2xl px-4 py-4 text-center flex flex-col items-center gap-2"
          style={{ background: "var(--surface)", border: "1px solid var(--ring)" }}
        >
          <span
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide rounded-full px-3 py-1"
            style={{ background: "var(--plane)", border: "1px solid var(--ring)", color: "var(--ink-2)" }}
          >
            <span aria-hidden>💬</span> {t(lang, "badge.definitional")}
          </span>
          <p className="text-xl font-bold leading-tight" style={{ color: "var(--ink)" }}>
            {t(lang, "sample.label")}
          </p>
          <p className="text-sm" style={{ color: "var(--ink-2)" }}>
            {t(lang, "sample.headline")}
          </p>
          <ConfidenceMeter value={4} lang={lang} />
        </div>

        <div
          className="rounded-xl px-4 py-3 text-center"
          style={{ background: "var(--surface)", border: "2px dashed var(--muted)" }}
        >
          <div
            className="text-[10px] font-semibold uppercase tracking-wide mb-1"
            style={{ color: "var(--muted)" }}
          >
            {t(lang, "cruxShort")}
          </div>
          <p className="text-sm font-medium leading-snug" style={{ color: "var(--ink)" }}>
            {t(lang, "sample.crux")}
          </p>
        </div>

        <figcaption className="flex flex-col gap-1.5">
          <span
            className="text-xs font-semibold uppercase tracking-wide"
            style={{ color: "var(--muted)" }}
          >
            {t(lang, "bestPointTitle")}
          </span>
          <span
            className="rounded-xl px-4 py-3 text-sm leading-snug"
            style={{ background: "var(--surface)", border: "1px solid var(--ring)", color: "var(--ink-2)" }}
          >
            {t(lang, "sample.bestPoint")}
          </span>
        </figcaption>
      </figure>
    </section>
  );
}

export const FAQ_ITEMS = [
  { q: "faq.fair.q", a: "faq.fair.a" },
  { q: "faq.private.q", a: "faq.private.a" },
  { q: "faq.powers.q", a: "faq.powers.a" },
  { q: "faq.taste.q", a: "faq.taste.a" },
  { q: "faq.legal.q", a: "faq.legal.a" },
] as const satisfies readonly { q: Key; a: Key }[];

/** Native <details> accordions: keyboard and screen-reader support for free. */
export function Faq({ lang }: { lang: Lang }) {
  return (
    <section aria-labelledby="faq-title" className="flex flex-col gap-6">
      <SectionHeading id="faq-title" title={t(lang, "faq.title")} />
      <div className="flex flex-col gap-2 max-w-xl mx-auto w-full">
        {FAQ_ITEMS.map((item) => (
          <details
            key={item.q}
            className="faq rounded-2xl px-4"
            style={{ background: "var(--surface)", border: "1px solid var(--ring)" }}
          >
            <summary
              className="flex cursor-pointer items-center justify-between gap-3 py-3.5 text-sm font-semibold"
              style={{ color: "var(--ink)" }}
            >
              {t(lang, item.q)}
              <span aria-hidden className="faq-icon text-base" style={{ color: "var(--muted)" }}>
                +
              </span>
            </summary>
            <p className="pb-4 text-sm leading-relaxed" style={{ color: "var(--ink-2)" }}>
              {t(lang, item.a)}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}
