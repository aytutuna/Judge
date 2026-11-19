"use client";

import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type ReactNode } from "react";
import { EvidenceAdd, EvidenceNotes, EvidenceRows, type EvidenceController } from "@/components/case/EvidencePicker";
import { useReducedMotion } from "@/components/scene/useReducedMotion";
import { flashSteps, runFlash, shortBoxes } from "@/lib/flash";
import { t, type Lang } from "@/lib/i18n";
import { langTag } from "@/lib/langs";
import { MAX_ARGUMENT, type SideInput } from "@/lib/sides";
import type { Venue } from "@/lib/venues";
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
  /** Lit as if written in: a send went out with this box too short. */
  flash?: boolean;
  children?: ReactNode;
};

function SideCard({ side, head, flash = false, children }: CardProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Grows with the text; the CSS min and max heights bound it.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [side.value]);

  return (
    <div className={styles.card} data-side={side.letter} data-flash={flash ? "" : undefined} role="group" aria-label={head ? side.label : undefined}>
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
  /** The place the court on the form is set in. */
  venue: Venue;
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
  /** Context uploads, when this deployment has them: one per side box, A to D. */
  evidence?: readonly EvidenceController[];
  /** Signed out: "Add context" asks for sign-in instead of picking a file. */
  onAddContextSignIn?: () => void;
};

const NO_MORE: readonly SideInput[] = [];

export function HomeForm(p: HomeFormProps) {
  const { lang, evidence } = p;
  const more = p.more ?? NO_MORE;
  const tag = langTag(lang);
  const reduced = useReducedMotion();

  // The boxes that light up when a send is tapped with too little written.
  const [flashing, setFlashing] = useState<readonly number[]>([]);
  const [short, setShort] = useState<{ boxes: number[] } | null>(null);
  useEffect(() => {
    if (!short) return;
    return runFlash(flashSteps(reduced), (lit) => setFlashing(lit ? short.boxes : []));
  }, [short, reduced]);
  const flashShort = () => {
    if (p.holding) return;
    const texts = [p.mine, ...(p.theirsOpen ? [p.theirs, ...more.map((s) => s.text)] : [])];
    const boxes = shortBoxes(texts);
    if (boxes.length) setShort({ boxes });
  };
  const submit = () => {
    if (p.canSubmit) p.onSubmit();
    else flashShort();
  };

  // The court gives way while a box is being written in, as the apps' does under the keyboard.
  const [writing, setWriting] = useState(false);
  const isField = (el: EventTarget | null) => el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement;
  const onFocus = (e: FocusEvent) => {
    if (isField(e.target) && window.matchMedia("(pointer: coarse)").matches) setWriting(true);
  };
  const onBlur = (e: FocusEvent) => {
    if (!isField(e.relatedTarget)) setWriting(false);
  };

  // Opening or removing their side swaps the composer, so focus moves to the new one.
  // Not on touch screens, where that would pop the keyboard up (the apps don't either).
  const focusNext = useRef<string | null>(null);
  useEffect(() => {
    if (!focusNext.current) return;
    if (!window.matchMedia("(pointer: coarse)").matches) document.getElementById(focusNext.current)?.focus();
    focusNext.current = null;
  }, [p.theirsOpen, more.length]);

  /** The images of box `i` (sides A to D), and the notes when picking went wrong. */
  const files = (i: number) => {
    const e = evidence?.[i];
    if (!e || p.onAddContextSignIn || !(e.items.length || e.failure || e.overLimit)) return null;
    return (
      <div className={styles.files}>
        <EvidenceRows lang={lang} items={e.items} onRemove={e.remove} />
        <EvidenceNotes lang={lang} overLimit={e.overLimit} failure={e.failure} />
      </div>
    );
  };

  const addContext = (i: number) =>
    evidence && !evidence[i].full ? (
      <EvidenceAdd disabled={false} className={styles.context} onAdd={evidence[i].add} onSignIn={p.onAddContextSignIn}>
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

  /** The part of a box under its text: Add context, then the images picked for it. */
  const context = (i: number) => (
    <>
      {addContext(i)}
      {files(i)}
    </>
  );

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
  const cards = [mine, ...(p.theirsOpen ? [theirs, ...(sideC ? [sideC] : []), ...(sideD ? [sideD] : [])] : [])];
  const othersEmpty = !p.theirs.trim() && more.every((s) => !s.text.trim());
  // Another side while there are fewer than four, and links for everyone else while none has text.
  const canAddSide = !p.theirsOpen || more.length < 2;
  const offerLink = p.onInvite !== undefined && othersEmpty;

  return (
    <form
      className={styles.wrap}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      <fieldset className={styles.form} disabled={p.holding} data-blank={p.blank ? "" : undefined}>
        <div className={styles.stage} data-writing={writing ? "" : undefined}>
          <HomeCourt className={styles.court} busy={p.holding} venue={p.venue} />
        </div>

        <div className={styles.mid}>
          {cards.map((side, i) => (
            <SideCard key={side.id} side={side} head={p.theirsOpen} flash={flashing.includes(i)}>
              {context(i)}
            </SideCard>
          ))}

          {p.error ? (
            <p className={styles.error} id="home-error" role="alert">
              {p.error}
            </p>
          ) : null}

          {p.blank ? (
            <div className={styles.quiet}>
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
            </div>
          ) : null}

          {canAddSide || offerLink ? (
            <div className={styles.chips}>
              {canAddSide ? (
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
              ) : null}
              {offerLink ? (
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
          ) : null}
        </div>

        <div className={styles.dock}>
          <div className={styles.bar}>
            {p.blank ? null : (
              <button type="button" className={styles.clear} aria-label={t(lang, "home.clear")} onClick={p.onClear}>
                <svg viewBox="0 0 20 20" aria-hidden>
                  <path
                    d="M4 6h12M8 6V4h4v2M6 6l.7 10h6.6L14 6M8.5 9v4M11.5 9v4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span className={styles.clearLabel}>{t(lang, "home.clear")}</span>
              </button>
            )}
            <span className={styles.count} data-warn={p.length > WARN_AT ? "" : undefined} aria-hidden>
              {p.length.toLocaleString(tag)} / {MAX_ARGUMENT.toLocaleString(tag)}
            </span>
            <button
              type="submit"
              className={styles.send}
              data-busy={p.holding ? "" : undefined}
              aria-disabled={p.canSubmit || p.holding ? undefined : true}
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
          {p.status ? <p className={styles.status}>{p.status}</p> : null}
        </div>
      </fieldset>
    </form>
  );
}
