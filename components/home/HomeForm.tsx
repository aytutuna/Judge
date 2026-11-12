"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { EvidenceAdd, EvidenceNotes, EvidenceRows, type EvidenceController } from "@/components/case/EvidencePicker";
import { t, type Lang } from "@/lib/i18n";
import { langTag } from "@/lib/langs";
import { MAX_ARGUMENT, type SideInput } from "@/lib/sides";
import { HomeCourt } from "@/components/court/HomeCourt";
import styles from "./HomeForm.module.css";

const WARN_AT = 5700;

type Side = {
  id: string;
  letter: "A" | "B" | "C" | "D";
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
  onRemove?: () => void;
  removeLabel?: string;
};

type CardProps = {
  side: Side;
  /** The name header; one lone side goes without it. */
  head: boolean;
  /** The composer at the bottom, as opposed to a card in the middle. */
  docked?: boolean;
  children?: ReactNode;
};

function SideCard({ side, head, docked = false, children }: CardProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Grows with the text; the CSS min and max heights bound it.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [side.value]);

  return (
    <div className={styles.card} data-side={side.letter} data-docked={docked ? "" : undefined} role="group" aria-label={head ? side.label : undefined}>
      {head ? (
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
            onKeyDown={(e) => {
              // Enter in a name moves to the text instead of submitting the verdict.
              if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
              e.preventDefault();
              ref.current?.focus();
            }}
          />
          {side.onRemove ? (
            <button type="button" className={styles.remove} onClick={side.onRemove} aria-label={side.removeLabel}>
              <span>
                <svg viewBox="0 0 12 12" aria-hidden>
                  <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </span>
            </button>
          ) : null}
        </div>
      ) : null}
      <label htmlFor={side.id} className="sr-only">
        {side.fieldLabel}
      </label>
      <textarea
        id={side.id}
        ref={ref}
        className={styles.editor}
        rows={1}
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
      {children}
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
  /** Their side is open: yours moves up, theirs takes the composer. */
  theirsOpen: boolean;
  onAddTheirs: () => void;
  onRemoveTheirs: () => void;
  /** Sides C and D, added under their side; the last one takes the composer. */
  more?: readonly SideInput[];
  onMoreText?: (index: number, value: string) => void;
  onMoreName?: (index: number, value: string) => void;
  onAddMore?: () => void;
  onRemoveMore?: () => void;
  /** Length of what would be sent (both sides joined). */
  length: number;
  /** Nothing typed, no context and no second side. */
  blank: boolean;
  onClear: () => void;
  onExample: () => void;
  canSubmit: boolean;
  onSubmit: () => void;
  /** "Send them a link", offered while their side is closed or no side but
   * yours has text (every other side then gets its own link). */
  onInvite?: () => void;
  canInvite: boolean;
  holding: boolean;
  error: string | null;
  /** "Checking…" or "Creating…" while holding, else the balance. */
  status: ReactNode;
  /** Context uploads, when this deployment has them. */
  evidence?: EvidenceController;
  /** Signed out: "Add context" asks for sign-in instead of picking a file. */
  onAddContextSignIn?: () => void;
};

const NO_MORE: readonly SideInput[] = [];

export function HomeForm(p: HomeFormProps) {
  const { lang, evidence } = p;
  const more = p.more ?? NO_MORE;
  const tag = langTag(lang);
  const submit = () => {
    if (p.canSubmit) p.onSubmit();
  };

  // Opening or removing their side swaps the composer, so focus moves to the new one.
  const mid = useRef<HTMLDivElement>(null);
  const focusNext = useRef<string | null>(null);
  useEffect(() => {
    if (!focusNext.current) return;
    document.getElementById(focusNext.current)?.focus();
    focusNext.current = null;
  }, [p.theirsOpen, more.length]);

  // Short of room the middle rests at its top; keep the part by the composer in view.
  useLayoutEffect(() => {
    const el = mid.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [p.error, p.theirsOpen, more.length, evidence?.items.length, evidence?.failure, evidence?.overLimit]);

  const addContext = evidence ? (
    <EvidenceAdd disabled={evidence.full} className={styles.context} onAdd={evidence.add} onSignIn={p.onAddContextSignIn}>
      <svg viewBox="0 0 24 24" aria-hidden>
        <path
          d="M21 11.5 12.5 20a5.5 5.5 0 0 1-7.8-7.8l8.5-8.5a3.7 3.7 0 0 1 5.2 5.2l-8.5 8.5a1.8 1.8 0 0 1-2.6-2.6L15 7"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {t(lang, "home.addContext")}
    </EvidenceAdd>
  ) : null;

  const mine: Side = {
    id: "argument",
    letter: "A",
    value: p.mine,
    onChange: p.onMine,
    name: p.mineName,
    onName: p.onMineName,
    namePlaceholder: t(lang, "names.you"),
    label: t(lang, "input.labelTwoSided"),
    fieldLabel: t(lang, "home.yourSideLabel"),
    placeholder: t(lang, "home.yourPlaceholder"),
    onSend: submit,
    describedBy: p.error ? "home-error" : undefined,
  };
  const theirs: Side = {
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
    // Only the last side can be removed.
    onRemove: more.length
      ? undefined
      : () => {
          focusNext.current = "argument";
          p.onRemoveTheirs();
        },
    removeLabel: t(lang, "home.removeTheirSide"),
  };
  const extra = (i: number): Side => {
    const letter = i ? "D" : "C";
    return {
      id: `side-${letter.toLowerCase()}`,
      letter,
      value: more[i].text,
      onChange: (value) => p.onMoreText?.(i, value),
      name: more[i].name,
      onName: (value) => p.onMoreName?.(i, value),
      namePlaceholder: t(lang, "home.theirName"),
      label: t(lang, "home.theirSide"),
      fieldLabel: `${t(lang, "home.theirSideLabel")} (${letter})`,
      placeholder: t(lang, "home.theirPlaceholder"),
      onSend: submit,
      removeLabel: t(lang, "home.removeTheirSide"),
    };
  };
  const sideC: Side | null =
    more.length > 0
      ? {
          ...extra(0),
          onRemove:
            more.length === 1
              ? () => {
                  focusNext.current = "other-side";
                  p.onRemoveMore?.();
                }
              : undefined,
        }
      : null;
  const sideD: Side | null =
    more.length > 1
      ? {
          ...extra(1),
          onRemove: () => {
            focusNext.current = "side-c";
            p.onRemoveMore?.();
          },
        }
      : null;
  const composer = !p.theirsOpen ? mine : (sideD ?? sideC ?? theirs);
  const lastText = (more.length ? more[more.length - 1].text : p.theirs).trim();
  const othersEmpty = !p.theirs.trim() && more.every((s) => !s.text.trim());
  // Another side once the last one has text, or links for everyone else while none has.
  const room = p.theirsOpen && more.length < 2 && (lastText !== "" || (p.onInvite !== undefined && othersEmpty));

  return (
    <form
      className={styles.wrap}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <fieldset className={styles.form} disabled={p.holding} data-blank={p.blank ? "" : undefined}>
        <div className={styles.stage}>
          <HomeCourt className={styles.court} busy={p.holding} />
        </div>

        <div className={styles.mid} ref={mid}>
          {p.theirsOpen ? (
            <SideCard side={mine} head>
              {addContext ? <div className={styles.row}>{addContext}</div> : null}
            </SideCard>
          ) : null}
          {p.theirsOpen && sideC ? <SideCard side={theirs} head /> : null}
          {p.theirsOpen && sideD ? <SideCard side={sideC as Side} head /> : null}

          {evidence && !p.onAddContextSignIn ? (
            <>
              <EvidenceRows lang={lang} items={evidence.items} onRemove={evidence.remove} />
              <EvidenceNotes lang={lang} overLimit={evidence.overLimit} failure={evidence.failure} />
            </>
          ) : null}

          {p.error ? (
            <p className={styles.error} id="home-error" role="alert">
              {p.error}
            </p>
          ) : null}

          <div className={styles.quiet}>
            {p.blank ? (
              <button type="button" onClick={p.onExample}>
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
            ) : (
              <button type="button" onClick={p.onClear}>
                {t(lang, "home.clear")}
              </button>
            )}
          </div>

          {p.theirsOpen && !room ? null : (
            <div className={styles.chips}>
              <button
                type="button"
                className={styles.chip}
                onClick={() => {
                  if (p.theirsOpen) {
                    focusNext.current = more.length ? "side-d" : "side-c";
                    p.onAddMore?.();
                  } else {
                    focusNext.current = "other-side";
                    p.onAddTheirs();
                  }
                }}
              >
                <svg viewBox="0 0 16 16" aria-hidden>
                  <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
                {t(lang, p.theirsOpen ? "home.addSide" : "home.addTheirSide")}
              </button>
              {p.onInvite && othersEmpty ? (
                <button type="button" className={styles.chip} disabled={!p.canInvite} onClick={p.onInvite}>
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
                  {t(lang, "home.sendLink")}
                </button>
              ) : null}
            </div>
          )}
        </div>

        <div className={styles.dock}>
          <SideCard key={composer.id} side={composer} head={p.theirsOpen} docked>
            <div className={styles.row}>
              {addContext}
              <span className={styles.count} data-warn={p.length > WARN_AT ? "" : undefined} aria-hidden>
                {p.length.toLocaleString(tag)} / {MAX_ARGUMENT.toLocaleString(tag)}
              </span>
              <button
                type="submit"
                className={styles.send}
                data-busy={p.holding ? "" : undefined}
                disabled={!p.canSubmit}
                aria-label={t(lang, "getVerdict")}
              >
                <span>
                  {p.holding ? (
                    <span className={styles.spinner} aria-hidden />
                  ) : (
                    <svg viewBox="0 0 20 20" aria-hidden>
                      <path
                        d="M10 16V4M4.5 9.5 10 4l5.5 5.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </span>
              </button>
            </div>
          </SideCard>
          {p.status ? <p className={styles.status}>{p.status}</p> : null}
        </div>
      </fieldset>
    </form>
  );
}
