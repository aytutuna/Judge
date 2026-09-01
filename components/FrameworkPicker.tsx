"use client";

import { useState } from "react";
import { PRESETS, SLIDERS } from "@/lib/frameworks";
import { t } from "@/lib/i18n";
import { useLang } from "@/lib/lang";
import type { FrameworkChoice } from "@/lib/types";

export function FrameworkPicker({
  value,
  onChange,
}: {
  value: FrameworkChoice;
  onChange: (next: FrameworkChoice) => void;
}) {
  const lang = useLang();
  const [showSliders, setShowSliders] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span
          className="text-xs font-semibold uppercase tracking-wide"
          style={{ color: "var(--muted)" }}
        >
          {t(lang, "judgeBy")}
        </span>
        <button
          type="button"
          onClick={() => setShowSliders((s) => !s)}
          className="text-xs underline underline-offset-2"
          style={{ color: "var(--ink-2)" }}
        >
          {showSliders ? t(lang, "hideFineTune") : t(lang, "fineTune")}
        </button>
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        {PRESETS.map((p) => {
          const active = value.preset === p.id;
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={active}
              onClick={() => onChange({ ...value, preset: p.id })}
              className="shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition-colors"
              style={{
                background: active ? "var(--ink)" : "var(--surface)",
                color: active ? "var(--plane)" : "var(--ink-2)",
                border: "1px solid var(--ring)",
              }}
              title={t(lang, `preset.${p.id}.blurb`)}
            >
              <span aria-hidden>{p.emoji}</span> {t(lang, `preset.${p.id}.label`)}
            </button>
          );
        })}
      </div>

      {showSliders ? (
        <div
          className="flex flex-col gap-3 rounded-xl px-4 py-3"
          style={{ background: "var(--surface)", border: "1px solid var(--ring)" }}
        >
          {SLIDERS.map((s) => {
            const v = value.sliders?.[s.id] ?? 50;
            const left = t(lang, `slider.${s.id}.left`);
            const right = t(lang, `slider.${s.id}.right`);
            return (
              <label key={s.id} className="flex flex-col gap-1">
                <span
                  className="flex justify-between text-xs font-medium"
                  style={{ color: "var(--ink-2)" }}
                >
                  <span>{left}</span>
                  <span>{right}</span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={v}
                  aria-label={t(lang, "slider.aria", { left, right })}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      sliders: { ...value.sliders, [s.id]: Number(e.target.value) },
                    })
                  }
                  style={{ accentColor: "var(--ink)" }}
                />
              </label>
            );
          })}
          <p className="text-[11px]" style={{ color: "var(--muted)" }}>
            {t(lang, "sliderNote")}
          </p>
        </div>
      ) : null}
    </div>
  );
}
