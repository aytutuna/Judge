"use client";

import { useEffect, useRef, useState } from "react";
import { HOW_STEPS, stepNumeral } from "@/lib/how-steps";
import { KIND_KEY, t, type Lang } from "@/lib/i18n";
import { setSceneYou, setStoryProgress } from "@/lib/scene-bridge";
import { ss } from "@/lib/scene-poses";
import { hyphenRuns, noOrphan } from "@/lib/text";
import type { ClaimKind } from "@/lib/types";
import styles from "./ScrollStory.module.css";

/**
 * "How it works" as a five-step scroll story over the sticky 3D stage
 * (render inside <SceneStage>). Scroll progress q goes to the scene bridge;
 * step i is active when round(q) === i. Without JS every step is fully
 * visible: the dimming of inactive steps only applies once `data-ready` is
 * set after mount.
 */

const KINDS: readonly ClaimKind[] = ["fact", "value", "definition", "logic"];

/** The same shapes as the 3D claim pieces: cube, ball, tetrahedron, octahedron. */
function KindGlyph({ kind }: { kind: ClaimKind }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 14 14" className={styles.glyph} aria-hidden="true" focusable="false">
      {kind === "fact" ? <rect x="2.5" y="2.5" width="9" height="9" rx="1.6" {...common} /> : null}
      {kind === "value" ? <circle cx="7" cy="7" r="4.6" {...common} /> : null}
      {kind === "definition" ? <path d="M7 2.2 12 11.4H2z" {...common} /> : null}
      {kind === "logic" ? <path d="M7 1.8 12.2 7 7 12.2 1.8 7z" {...common} /> : null}
    </svg>
  );
}

const LAST = stepNumeral(HOW_STEPS.length - 1);

export function ScrollStory({ lang }: { lang: Lang }) {
  const sectionRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLOListElement>(null);
  const hudRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const section = sectionRef.current;
    const track = trackRef.current;
    if (!section || !track) return;
    section.dataset.ready = "";
    // The story is the sample's case, where the reader is Party B ("You").
    setSceneYou("b");
    let last = -1;
    let ticking = false;
    const update = () => {
      ticking = false;
      const first = track.firstElementChild as HTMLElement | null;
      const stepH = first?.offsetHeight || window.innerHeight;
      const q = -track.getBoundingClientRect().top / stepH;
      setStoryProgress(q);
      const step = Math.max(0, Math.min(HOW_STEPS.length - 1, Math.round(q)));
      if (step !== last) {
        last = step;
        setActive(step);
      }
      const hud = hudRef.current;
      if (hud) hud.style.opacity = (ss(-0.4, 0, q) * (1 - ss(4.1, 4.5, q))).toFixed(3);
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    const first = requestAnimationFrame(update);
    return () => {
      cancelAnimationFrame(first);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      delete section.dataset.ready;
      setStoryProgress(-3);
      setSceneYou(null);
    };
  }, []);

  return (
    <section ref={sectionRef} id="how" aria-labelledby="how-title" className={styles.how}>
      <div className={styles.inner}>
        <div className={styles.intro}>
          <div className={styles.introText} data-scene-avoid="">
            <p className={styles.kicker}>{t(lang, "how.kicker")}</p>
            <h2 id="how-title" className={styles.title}>
              {noOrphan(t(lang, "how.title"))}
            </h2>
            <p className={styles.lead}>{t(lang, "how.lead")}</p>
          </div>
        </div>

        <div className={styles.hudRail} aria-hidden="true">
          <div ref={hudRef} className={styles.hud}>
            <span>
              {stepNumeral(active)} / {LAST}
            </span>
            <span className={styles.ticks}>
              {HOW_STEPS.map((s, i) => (
                <i key={s.title} data-on={i === active ? "" : undefined} />
              ))}
            </span>
          </div>
        </div>

        <ol ref={trackRef} className={styles.track}>
          {HOW_STEPS.map((s, i) => (
            <li key={s.title} className={styles.step} data-active={i === active ? "" : undefined}>
              <div className={styles.card}>
                <p className={styles.num} aria-hidden="true">
                  {stepNumeral(i)} <span className={styles.of}>/ {LAST}</span>
                </p>
                <h3 className={styles.stepTitle}>
                  {hyphenRuns(noOrphan(t(lang, s.title))).map((r, j) =>
                    r.keep ? (
                      <span key={j} className={styles.nobreak}>
                        {r.text}
                      </span>
                    ) : (
                      r.text
                    ),
                  )}
                </h3>
                <p className={styles.body}>{t(lang, s.body)}</p>
                {i === 1 ? (
                  <ul className={styles.kinds} aria-hidden="true">
                    {KINDS.map((k) => (
                      <li key={k}>
                        <KindGlyph kind={k} />
                        {t(lang, KIND_KEY[k])}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
