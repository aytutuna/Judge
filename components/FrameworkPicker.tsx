"use client";

import { useState } from "react";
import { PRESETS, SLIDERS } from "@/lib/frameworks";
import { t } from "@/lib/i18n";
import { useLang } from "@/lib/lang";
import type { FrameworkChoice } from "@/lib/types";
import styles from "./FrameworkPicker.module.css";

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
    <div className={styles.picker}>
      <div className={styles.head}>
        <span className="micro" style={{ color: "var(--muted)" }}>
          {t(lang, "judgeBy")}
        </span>
        <button
          type="button"
          aria-expanded={showSliders}
          onClick={() => setShowSliders((s) => !s)}
          className={styles.toggle}
        >
          {showSliders ? t(lang, "hideFineTune") : t(lang, "fineTune")}
        </button>
      </div>

      <div className={styles.presets}>
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={value.preset === p.id}
            onClick={() => onChange({ ...value, preset: p.id })}
            className={styles.preset}
            title={t(lang, `preset.${p.id}.blurb`)}
          >
            <span aria-hidden>{p.emoji}</span> {t(lang, `preset.${p.id}.label`)}
          </button>
        ))}
      </div>

      {showSliders ? (
        <div className={styles.sliders}>
          {SLIDERS.map((s) => {
            const v = value.sliders?.[s.id] ?? 50;
            const left = t(lang, `slider.${s.id}.left`);
            const right = t(lang, `slider.${s.id}.right`);
            return (
              <label key={s.id} className={styles.slider}>
                <span className={styles.ends}>
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
                  className={styles.range}
                />
              </label>
            );
          })}
          <p className={styles.note}>{t(lang, "sliderNote")}</p>
        </div>
      ) : null}
    </div>
  );
}
