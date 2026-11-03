"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { t, type Lang } from "@/lib/i18n";
import { MAX_ARGUMENT } from "@/lib/sides";
import styles from "./HomeForm.module.css";

const WARN_AT = 5700;

type Side = {
  id: string;
  letter: "A" | "B";
  value: string;
  onChange: (value: string) => void;
  name: string;
  onName: (value: string) => void;
  namePlaceholder: string;
  label: string;
  fieldLabel: string;
  placeholder: string;
  onSend: () => void;
  describedBy?: string;
  children?: ReactNode;
};

function SideCard({ side }: { side: Side }) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Grows with the text; the CSS min-height is the floor.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [side.value]);

  return (
    <div className={styles.card} data-side={side.letter}>
      <div className={styles.cardHead}>
        <span className={styles.avatar} aria-hidden>
          {side.letter}
        </span>
        <input
          className={styles.name}
          value={side.name}
          maxLength={40}
          placeholder={side.namePlaceholder}
          aria-label={side.namePlaceholder}
          autoComplete={side.letter === "A" ? "given-name" : "off"}
          onChange={(e) => side.onName(e.target.value)}
        />
        <span className={styles.label}>{side.label}</span>
      </div>
      <label htmlFor={side.id} className="sr-only">
        {side.fieldLabel}
      </label>
      <textarea
        id={side.id}
        ref={ref}
        className={styles.editor}
        value={side.value}
        placeholder={side.placeholder}
        maxLength={MAX_ARGUMENT}
        aria-describedby={side.describedBy}
        onChange={(e) => side.onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            side.onSend();
          }
        }}
      />
      {side.children}
    </div>
  );
}

export type HomeFormProps = {
  lang: Lang;
  mine: string;
  onMine: (value: string) => void;
  mineName: string;
  onMineName: (value: string) => void;
  theirs: string;
  onTheirs: (value: string) => void;
  theirName: string;
  onTheirName: (value: string) => void;
  /** Length of what would be sent (both sides joined). */
  length: number;
  /** The signed-in lead: cases are offered. */
  casesOn: boolean;
  /** The "+" that starts over; offered once something is typed. */
  onNew?: () => void;
  onExample: () => void;
  canSubmit: boolean;
  onSubmit: () => void;
  /** "Send them a link", offered while their side is empty. */
  onInvite?: () => void;
  holding: boolean;
  error: string | null;
  /** "Checking…" or "Creating…" while holding, else the balance. */
  status: ReactNode;
  /** Screenshot picker, inside the first card. */
  evidence?: ReactNode;
};

export function HomeForm(p: HomeFormProps) {
  const { lang } = p;
  const blank = !p.mine && !p.theirs;
  const submit = () => {
    if (p.canSubmit) p.onSubmit();
  };
  return (
    <form
      className={styles.wrap}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <fieldset className={styles.form} disabled={p.holding}>
        <div className={styles.top}>
          <button type="button" className={styles.example} onClick={p.onExample}>
            <svg viewBox="0 0 20 20" aria-hidden>
              <path
                d="M3 6h3.5c3 0 4 8 7 8H17M3 14h3.5c1 0 1.8-1 2.5-2.2M17 6h-3.5c-1 0-1.8.8-2.4 1.8M14.5 3.5 17 6l-2.5 2.5M14.5 11.5 17 14l-2.5 2.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {t(lang, "home.example")}
          </button>
          {p.onNew ? (
            <button type="button" className={styles.plus} onClick={p.onNew} aria-label={t(lang, "shell.new")}>
              <svg viewBox="0 0 16 16" aria-hidden>
                <path d="M8 2.5v11M2.5 8h11" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
              </svg>
            </button>
          ) : null}
        </div>
        {blank ? <p className={styles.lead}>{t(lang, p.casesOn ? "home.lead" : "home.leadSolo")}</p> : null}

        <SideCard
          side={{
            id: "argument",
            letter: "A",
            value: p.mine,
            onChange: p.onMine,
            name: p.mineName,
            onName: p.onMineName,
            namePlaceholder: t(lang, "names.you"),
            label: t(lang, "input.labelTwoSided"),
            fieldLabel: t(lang, "home.yourSideLabel"),
            placeholder: t(lang, "thread.placeholderTwoSided"),
            onSend: submit,
            describedBy: p.error ? "home-error" : undefined,
            children: p.evidence,
          }}
        />
        <SideCard
          side={{
            id: "other-side",
            letter: "B",
            value: p.theirs,
            onChange: p.onTheirs,
            name: p.theirName,
            onName: p.onTheirName,
            namePlaceholder: t(lang, "home.theirName"),
            label: t(lang, "home.theirSide"),
            fieldLabel: t(lang, "home.theirSideLabel"),
            placeholder: t(lang, "home.theirPlaceholder"),
            onSend: submit,
            children: p.onInvite ? (
              <button type="button" className={styles.invite} disabled={!p.canSubmit} onClick={p.onInvite}>
                <svg viewBox="0 0 20 20" aria-hidden>
                  <path
                    d="M8.5 11.5a3.5 3.5 0 0 0 5 0l2.5-2.5a3.5 3.5 0 0 0-5-5l-1 1M11.5 8.5a3.5 3.5 0 0 0-5 0L4 11a3.5 3.5 0 0 0 5 5l1-1"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                {t(lang, "home.invite")}
              </button>
            ) : null,
          }}
        />

        <p className={styles.count} data-warn={p.length > WARN_AT ? "" : undefined} aria-hidden>
          {p.length} / {MAX_ARGUMENT}
        </p>
        {p.error ? (
          <p className={styles.error} id="home-error" role="alert">
            {p.error}
          </p>
        ) : null}
        <div className={styles.send}>
          <button type="submit" className={styles.submit} disabled={!p.canSubmit} aria-label={t(lang, "getVerdict")}>
            {p.holding ? (
              <span className={styles.spinner} aria-hidden />
            ) : (
              <>
                {t(lang, "getVerdict")}
                <svg viewBox="0 0 20 20" aria-hidden>
                  <path
                    d="M4 10h12M10.5 4.5 16 10l-5.5 5.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </>
            )}
          </button>
          {p.status ? <p className={styles.status}>{p.status}</p> : null}
        </div>
      </fieldset>
    </form>
  );
}
