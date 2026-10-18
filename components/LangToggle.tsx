"use client";

import { t, type Lang } from "@/lib/i18n";
import { setLang } from "@/lib/lang";

/** TR | EN switch. Writes the client language store, so it only belongs on
 * pages whose chrome reads that store (not the Accept-Language share page). */
export function LangToggle({ lang }: { lang: Lang }) {
  // Each button's label is written in its target language, so it carries
  // that lang for screen readers whatever the page language is.
  const side = (l: Lang, label: string, aria: string) => {
    const active = lang === l;
    return (
      <button
        type="button"
        lang={l}
        aria-pressed={active}
        aria-label={aria}
        onClick={() => setLang(l)}
        className={`rounded-md px-1.5 py-1 text-xs ${active ? "font-semibold" : ""}`}
        style={{ color: active ? "var(--ink)" : "var(--muted)" }}
      >
        {label}
      </button>
    );
  };
  return (
    <div className="flex items-center gap-0.5" role="group" aria-label={t(lang, "footer.language")}>
      {side("tr", "TR", t(lang, "langToggle.toTr"))}
      <span aria-hidden className="text-xs" style={{ color: "var(--muted)" }}>
        |
      </span>
      {side("en", "EN", t(lang, "langToggle.toEn"))}
    </div>
  );
}
