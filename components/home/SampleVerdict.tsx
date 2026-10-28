"use client";

import { useEffect, useRef } from "react";
import { t, type Lang } from "@/lib/i18n";
import { noOrphan, stripLeadingEmoji } from "@/lib/text";
import { VerdictCardShell } from "../verdict/VerdictCardShell";
import { CardTopRow, ExamplePill } from "../verdict/CardTopRow";
import { TugBar } from "../verdict/TugBar";
import { VerdictMain } from "../verdict/VerdictMain";
import { CruxBlock } from "../verdict/CruxBlock";
import { WhyBlock } from "../verdict/WhyBlock";
import { BestPointBlock } from "../verdict/BestPointBlock";
import { CardActions } from "../verdict/CardActions";
import type { Vote } from "../verdict/VoteDots";
import styles from "./SampleVerdict.module.css";

/** The hot dog case: Party B ("You") wins 3–0, confidence 3 of 3. The 3D
 * story's verdict step uses the same tugA, so the scene and the card agree. */
export const SAMPLE_TUG_A = 20;
const SAMPLE_VOTES: readonly Vote[] = ["b", "b", "b"];

/** Share of the card that must be on screen before it plays. A card taller
 * than the viewport also plays once it fills half the screen. */
const PLAY_RATIO = 0.45;
const THRESHOLDS = Array.from({ length: 21 }, (_, i) => i / 20);

/**
 * "What a verdict looks like": a clearly badged, static example in the same
 * card as the real verdict. It plays once (tug 50 → 20, dots pop, label
 * lifts, meter fills) when it scrolls into view. The server markup is the
 * final state; script only "arms" the start pose when motion is allowed, so
 * no-JS and reduced-motion visitors simply see the finished card.
 */
export function SampleVerdict({ lang }: { lang: Lang }) {
  const cardRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = cardRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    el.dataset.state = "armed";
    const io = new IntersectionObserver(
      (entries) => {
        const seen = entries.some(
          (e) =>
            e.isIntersecting &&
            (e.intersectionRatio >= PLAY_RATIO ||
              e.intersectionRect.height >= (e.rootBounds?.height ?? window.innerHeight) * 0.5),
        );
        if (!seen) return;
        io.disconnect();
        void el.offsetWidth; // commit the armed pose before the transitions start
        el.dataset.state = "play";
      },
      { threshold: THRESHOLDS },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      delete el.dataset.state;
    };
  }, []);

  const nameA = t(lang, "sample.nameA");
  const nameB = t(lang, "sample.nameB");
  const label = t(lang, "sample.label");
  const votesLabel = t(lang, "judgesVoted.other", { n: SAMPLE_VOTES.length });
  const votesSr = `${votesLabel} ${SAMPLE_VOTES.map(() => nameB).join(" · ")}`;

  return (
    <section id="sample" aria-labelledby="sample-title" className={styles.sample}>
      <div className={`wrap ${styles.grid}`}>
        <div className={styles.copy}>
          <p className="kicker">{t(lang, "sample.kicker")}</p>
          <h2 id="sample-title" className={styles.title}>
            {noOrphan(t(lang, "sample.title"))}
          </h2>
          <p className={styles.lead}>{t(lang, "sample.lead")}</p>
        </div>

        <div className={styles.cardWrap}>
          <VerdictCardShell
            ref={cardRef}
            top={
              <CardTopRow
                pill={<ExamplePill>{t(lang, "sample.badge")}</ExamplePill>}
                votes={SAMPLE_VOTES}
                votesLabel={votesLabel}
                votesSr={votesSr}
              />
            }
          >
            <TugBar
              nameA={nameA}
              nameB={nameB}
              tugA={SAMPLE_TUG_A}
              ariaLabel={t(lang, "verdictAria", { label })}
            />
            <VerdictMain
              badge={t(lang, "badge.definitional")}
              label={label}
              labelAs="h3"
              seal="b"
              headline={t(lang, "sample.headline")}
              agreement={{ n: SAMPLE_VOTES.length, total: SAMPLE_VOTES.length }}
              lang={lang}
            />
            <WhyBlock title={t(lang, "why")} text={t(lang, "sample.why")} />
            <CruxBlock title={stripLeadingEmoji(t(lang, "cruxShort"))} text={t(lang, "sample.crux")} />
            <BestPointBlock
              title={stripLeadingEmoji(t(lang, "bestPointTitle"))}
              text={t(lang, "sample.bestPoint")}
            />
            <CardActions again={{ label: t(lang, "footer.home"), href: "/" }} />
          </VerdictCardShell>
        </div>
      </div>
    </section>
  );
}
