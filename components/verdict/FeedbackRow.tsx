"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { askSignIn, fetchConsent, fetchRating, saveConsent, saveRating, type Rating } from "@/lib/feedback-client";
import { t, type Lang } from "@/lib/i18n";
import { useViewer } from "@/lib/use-viewer";
import styles from "./verdict.module.css";

const THUMB_UP = "M7 11v9H4v-9h3Zm0 0 4-8c1.7 0 2.7 1.3 2.4 3L13 9h5.5a2 2 0 0 1 2 2.4l-1.2 6A2 2 0 0 1 17.3 19H7";
const THUMB_DOWN = "M7 13V4H4v9h3Zm0 0 4 8c1.7 0 2.7-1.3 2.4-3L13 15h5.5a2 2 0 0 0 2-2.4l-1.2-6A2 2 0 0 0 17.3 5H7";

/** "Fair verdict?" at the very end of a finished verdict. Tapping the
 * chosen thumb again clears it; signed out, a tap asks for sign-in. */
export function RatingRow({ id, lang }: { id: string; lang: Lang }) {
  const viewer = useViewer();
  const signedIn = Boolean(viewer.me?.user);
  const [rating, setRating] = useState<Rating | null>(null);

  useEffect(() => {
    if (!signedIn) {
      setRating(null);
      return;
    }
    let live = true;
    void fetchRating(id).then((r) => live && setRating(r));
    return () => {
      live = false;
    };
  }, [id, signedIn]);

  function pick(value: Rating) {
    if (!signedIn) return askSignIn();
    const next = rating === value ? null : value;
    const before = rating;
    setRating(next);
    void saveRating(id, next).then((ok) => {
      if (!ok) setRating(before);
    });
  }

  const thumb = (value: Rating, d: string, label: string) => (
    <button
      type="button"
      className={styles.thumb}
      aria-label={label}
      aria-pressed={rating === value}
      onClick={() => pick(value)}
    >
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d={d} fill={rating === value ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.7} strokeLinejoin="round" />
      </svg>
    </button>
  );

  return (
    <div className={styles.rating} role="group" aria-label={t(lang, "rating.prompt")}>
      <span>{t(lang, "rating.prompt")}</span>
      {thumb("up", THUMB_UP, t(lang, "rating.fair"))}
      {thumb("down", THUMB_DOWN, t(lang, "rating.notFair"))}
      <span className="sr-only" aria-live="polite">
        {rating ? t(lang, "rating.thanks") : ""}
      </span>
    </div>
  );
}

/** Asked once, after a person's second finished verdict (the server's `ask`
 * flag). Any answer is stored on the account, so it never shows again. */
export function ConsentCard({ lang }: { lang: Lang }) {
  const viewer = useViewer();
  const signedIn = Boolean(viewer.me?.user);
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    void fetchConsent().then((s) => live && setOpen(s?.ask === true));
    return () => {
      live = false;
    };
  }, [signedIn]);

  // transitionend never fires without a transition (reduced motion), so a timer backs it up
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => setOpen(false), 400);
    return () => clearTimeout(timer);
  }, [leaving]);

  if (!open) return null;

  function answer(choice: "on" | "off") {
    setLeaving(true);
    void saveConsent(choice, "card", "consent.cardBody", lang).then((s) => {
      if (s) return;
      setOpen(true);
      setLeaving(false);
    });
  }

  return (
    <div
      className={`${styles.consentWrap} ${leaving ? styles.consentLeaving : ""}`}
      onTransitionEnd={(e) => e.target === e.currentTarget && leaving && setOpen(false)}
    >
      <div className={styles.consentClip}>
        <section className={styles.consent} aria-labelledby="consent-title">
          <h2 id="consent-title">{t(lang, "consent.cardTitle")}</h2>
          <p>
            {t(lang, "consent.cardBody")}{" "}
            <Link href="/privacy#help-improve" className={styles.consentLink}>
              {t(lang, "consent.cardLink")}
            </Link>
          </p>
          <div className={styles.consentButtons}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnOutline}`}
              disabled={leaving}
              onClick={() => answer("on")}
            >
              {t(lang, "consent.cardYes")}
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnOutline}`}
              disabled={leaving}
              onClick={() => answer("off")}
            >
              {t(lang, "consent.cardNo")}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
