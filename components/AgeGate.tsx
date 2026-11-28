"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { CONTACT_EMAIL } from "@/app/site";
import type { AgeState } from "@/lib/account-types";
import { underThirteen, youngerThan } from "@/lib/age-date";
import { countryOptions } from "@/lib/countries";
import { t, type Lang } from "@/lib/i18n";
import { langTag } from "@/lib/langs";
import { applyAge, currentAge, markSignedOut, refreshViewer, useViewer } from "@/lib/use-viewer";
import styles from "./account/AccountPages.module.css";
import { ParentStep } from "./ParentStep";

/** A stable ref callback: focus once, when the element appears. */
function focusEl(el: HTMLElement | null): void {
  el?.focus();
}

/** Pages a gated account can still open: its account (to delete it) and
 * the two legal pages. */
const OPEN_PAGES = new Set(["/account", "/settings", "/settings/account", "/privacy", "/terms"]);

/** What the date step also asks of a teen: where they live (13 to 15) and,
 * for a 13 year old in Canada, whether in Quebec. */
export type Places = { country: string; quebec: boolean | null };

/** Which of those questions the typed date calls for. */
export function placesAsked(dob: string, country: string): { where: boolean; quebec: boolean } {
  const where = Boolean(dob) && !underThirteen(dob) && youngerThan(dob, 16);
  return { where, quebec: where && youngerThan(dob, 14) && country === "CA" };
}

/** The extra fields the request carries, only for the questions asked. */
export function placesBody(dob: string, p: Places): { country?: string; quebec?: boolean } {
  const asked = placesAsked(dob, p.country);
  return {
    ...(asked.where && p.country ? { country: p.country } : {}),
    ...(asked.quebec && p.quebec !== null ? { quebec: p.quebec } : {}),
  };
}

export type AgeDialogProps = {
  lang: Lang;
  age: AgeState;
  dob: string;
  /** The latest date the field takes: today anywhere on Earth. */
  max: string;
  /** An under-13 date waits for a second look before it is sent. */
  confirming: boolean;
  saving: boolean;
  failed: boolean;
  contactEmail: string | null;
  /** The answers to the places questions; left out, none are asked. */
  places?: Places;
  onPlaces?: (p: Places) => void;
  onDob: (v: string) => void;
  onSubmit: () => void;
  onChange: () => void;
  onSignOut: () => void;
};

function longDate(lang: Lang, dob: string): string {
  const d = new Date(`${dob}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? dob : new Intl.DateTimeFormat(langTag(lang), { dateStyle: "long", timeZone: "UTC" }).format(d);
}

/** The dialog's content, stateless so tests can render both states. */
export function AgeDialogBody({
  lang,
  age,
  dob,
  max,
  confirming,
  saving,
  failed,
  contactEmail,
  places,
  onPlaces,
  onDob,
  onSubmit,
  onChange,
  onSignOut,
}: AgeDialogProps) {
  const signOut = (
    <button type="button" className={`${styles.btn} ${styles.secondary}`} onClick={onSignOut}>
      {t(lang, "nav.signOut")}
    </button>
  );
  const countries = useMemo(() => countryOptions(lang), [lang]);
  const asked = places && onPlaces ? placesAsked(dob, places.country) : { where: false, quebec: false };
  const unanswered = (asked.where && !places?.country) || (asked.quebec && places?.quebec === null);
  if ((age.blocked && !age.needsDob) || age.restricted) {
    const closed = age.blocked && !age.needsDob;
    const [before, after = ""] = t(lang, closed ? "age.blockedContact" : "age.regionContact").split("{email}");
    return (
      <>
        <h2 id="age-title" className={styles.dialogTitle} tabIndex={-1} ref={focusEl}>
          {t(lang, closed ? "age.blockedTitle" : "age.regionTitle")}
        </h2>
        <p className={styles.dialogText}>{t(lang, closed ? "age.blocked" : "age.region")}</p>
        {contactEmail ? (
          <p className={styles.dialogText}>
            {before}
            <a href={`mailto:${contactEmail}`} className={styles.link}>
              {contactEmail}
            </a>
            {after}
          </p>
        ) : null}
        <div className={styles.row}>
          {signOut}
          <Link href="/settings/account" className={styles.link}>
            {t(lang, "account.delete")}
          </Link>
        </div>
      </>
    );
  }
  if (confirming) {
    return (
      <>
        <h2 id="age-title" className={styles.dialogTitle}>
          {t(lang, "age.title")}
        </h2>
        <p className={styles.dialogText} tabIndex={-1} ref={focusEl}>
          {t(lang, "age.confirmDate", { date: longDate(lang, dob) })}
        </p>
        {failed ? (
          <p className={styles.error} role="alert">
            {t(lang, "age.failed")}
          </p>
        ) : null}
        <div className={styles.row}>
          <button type="button" className={`${styles.btn} ${styles.primary}`} disabled={saving} onClick={onSubmit}>
            {t(lang, "age.confirmYes")}
          </button>
          <button type="button" className={`${styles.btn} ${styles.secondary}`} disabled={saving} onClick={onChange}>
            {t(lang, "age.change")}
          </button>
        </div>
      </>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (dob && !saving && !unanswered) onSubmit();
      }}
    >
      <h2 id="age-title" className={styles.dialogTitle}>
        {t(lang, "age.title")}
      </h2>
      <p className={styles.dialogText}>{t(lang, "age.lead")}</p>
      <div className={styles.field}>
        <input
          type="date"
          className={styles.input}
          aria-labelledby="age-title"
          required
          autoFocus
          min="1900-01-01"
          max={max}
          value={dob}
          onChange={(e) => onDob(e.target.value)}
        />
      </div>
      {asked.where && places && onPlaces ? (
        <>
          <p className={styles.dialogText}>{t(lang, "age.whereWhy")}</p>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="age-country">
              {t(lang, "age.where")}
            </label>
            <select
              id="age-country"
              className={styles.input}
              required
              value={places.country}
              onChange={(e) => onPlaces({ ...places, country: e.target.value })}
            >
              <option value="" />
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </>
      ) : null}
      {asked.quebec && places && onPlaces ? (
        <fieldset className={styles.field} style={{ border: 0, padding: 0, margin: "0 0 16px" }}>
          <legend className={styles.label}>{t(lang, "age.quebec")}</legend>
          <div className={styles.row}>
            {([true, false] as const).map((answer) => (
              <label key={String(answer)} className={styles.check} style={{ margin: 0 }}>
                <input type="radio" name="age-quebec" checked={places.quebec === answer} onChange={() => onPlaces({ ...places, quebec: answer })} />
                {t(lang, answer ? "age.yes" : "age.no")}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      {failed ? (
        <p className={styles.error} role="alert">
          {t(lang, "age.failed")}
        </p>
      ) : null}
      <div className={styles.row}>
        <button type="submit" className={`${styles.btn} ${styles.primary}`} disabled={!dob || saving || unanswered}>
          {t(lang, "age.continue")}
        </button>
        {signOut}
      </div>
    </form>
  );
}

/**
 * For signed-in accounts that have not given a date of birth, or that are
 * blocked for good (under 13): a dialog that cannot be dismissed. A block
 * from the old 18+ rule shows the date step too. An under-13 date waits for a
 * second look; the answer to it turns the same dialog into the refusal.
 */
export function AgeGate({ lang }: { lang: Lang }) {
  const pathname = usePathname();
  const { me } = useViewer();
  const age = me?.user ? (me.age ?? null) : null;
  const asking = Boolean(age && age.needsDob);
  const [dob, setDob] = useState("");
  const [max] = useState(() => new Date(Date.now() + 14 * 3_600_000).toISOString().slice(0, 10));
  const [places, setPlaces] = useState<Places>({ country: "", quebec: null });
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  async function send() {
    setSaving(true);
    setFailed(false);
    try {
      const { submitDob } = await import("@/lib/auth-client");
      const res = await submitDob(dob, placesBody(dob, places));
      if ("age" in res) {
        applyAge(res.age);
      } else if (res.status === 409 || res.status === 403) {
        // Given elsewhere, or the account was closed there: show what the server holds.
        await refreshViewer();
        // Still asking: the refusal was not about the date (e.g. a blocked origin), or the refresh failed.
        if (currentAge()?.needsDob !== false) setFailed(true);
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  function submit() {
    if (!confirming && underThirteen(dob)) {
      setConfirming(true);
      return;
    }
    void send();
  }

  const held = Boolean(age && (age.restricted || age.parent));
  const open = Boolean(age) && (age!.blocked || asking || held) && !OPEN_PAGES.has(pathname);

  // The IP's guess pre-selects the questions; the person can change it.
  useEffect(() => {
    if (!asking) return;
    let live = true;
    void import("@/lib/auth-client").then(async ({ fetchAgeHint }) => {
      const hint = await fetchAgeHint();
      if (live && hint?.country) {
        setPlaces((p) => (p.country ? p : { country: hint.country!, quebec: hint.country === "CA" ? hint.quebec : null }));
      }
    });
    return () => {
      live = false;
    };
  }, [asking]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  if (!age || (!age.blocked && !asking && !held)) return null;

  async function signOut() {
    try {
      const { signOut: run } = await import("@/lib/auth-client");
      await run();
    } finally {
      markSignedOut();
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="age-title"
      onCancel={(e) => e.preventDefault()}
      onClose={() => {
        if (open) dialogRef.current?.showModal();
      }}
    >
      {age.parent && !age.blocked && !age.restricted ? (
        <ParentStep lang={lang} status={age.parent} onSignOut={() => void signOut()} />
      ) : (
      <AgeDialogBody
        lang={lang}
        age={age}
        dob={dob}
        max={max}
        confirming={confirming}
        saving={saving}
        failed={failed}
        contactEmail={CONTACT_EMAIL}
        places={places}
        onPlaces={setPlaces}
        onDob={setDob}
        onSubmit={submit}
        onChange={() => {
          setConfirming(false);
          setFailed(false);
        }}
        onSignOut={() => void signOut()}
      />
      )}
    </dialog>
  );
}
