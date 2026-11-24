"use client";

import { useEffect, useRef, useState } from "react";
import { t, type Lang } from "@/lib/i18n";
import { partyLabel } from "@/lib/names";
import type { VerdictResult } from "@/lib/types";
import { JudgingStory } from "./court/JudgingStory";
import { SideCard } from "./SideCard";
import styles from "./JudgingScreen.module.css";

export type JudgedSide = { name: string; text: string };

/** The home page while a verdict is being made: the sides as submitted, the
 * judges at work with what they're doing written under them, and a way out.
 * `more` holds sides C and D. */
export function JudgingScreen({
  lang,
  mine,
  theirs,
  more = [],
  venue,
  accepted = false,
  done,
  result,
  onFinished,
  onCancel,
}: {
  lang: Lang;
  mine: JudgedSide | null;
  theirs: JudgedSide | null;
  more?: readonly JudgedSide[];
  venue?: string;
  accepted?: boolean;
  done: boolean;
  result: VerdictResult | null;
  onFinished: () => void;
  onCancel: () => void;
}) {
  const [open, setOpen] = useState<{ party: string; name: string; text: string; tile: HTMLElement } | null>(null);
  const shown = useRef<HTMLElement | null>(null);

  // Back to the tile that opened the card once it is gone.
  useEffect(() => {
    if (open) shown.current = open.tile;
    else shown.current?.focus({ preventScroll: true });
  }, [open]);

  const tile = (party: string, name: string, text: string) => (
    <button
      key={party}
      type="button"
      className={styles.tile}
      data-side={party}
      data-open={open?.party === party ? "" : undefined}
      aria-haspopup="dialog"
      onClick={(e) => setOpen({ party, name, text, tile: e.currentTarget })}
    >
      <span className={styles.name}>{name}</span>
      <span className={styles.text}>{text}</span>
    </button>
  );

  return (
    <div className={styles.root}>
      <div className={styles.tiles}>
        {mine ? tile("A", mine.name.trim() || t(lang, "input.labelTwoSided"), mine.text) : null}
        {theirs ? tile("B", theirs.name.trim() || t(lang, "home.theirSide"), theirs.text) : null}
        {more.map((side, i) => {
          const party = i ? "d" : "c";
          return tile(party.toUpperCase(), side.name.trim() || partyLabel(lang, party), side.text);
        })}
      </div>
      <div className={styles.card}>
        <JudgingStory
          lang={lang}
          accepted={accepted}
          done={done}
          result={result}
          sides={2 + more.length}
          venue={venue}
          onFinished={() => {
            setOpen(null);
            onFinished();
          }}
        />
      </div>
      {done ? null : (
        <button type="button" className={styles.cancel} onClick={onCancel}>
          {t(lang, "case.cancel")}
        </button>
      )}
      {open ? (
        <SideCard
          lang={lang}
          party={open.party}
          name={open.name}
          text={open.text}
          tile={open.tile}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </div>
  );
}
