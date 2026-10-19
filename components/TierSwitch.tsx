"use client";

import Link from "next/link";
import { useId, useState } from "react";
import type { Entitlement } from "@/lib/account-types";
import { saveDraftForSignIn } from "@/lib/draft";
import { t, tWithDate, type Lang } from "@/lib/i18n";
import { premiumRemaining, type TierAvailability } from "@/lib/tier";
import type { Tier } from "@/lib/types";
import { PremiumSpark } from "./PremiumBadge";
import styles from "./TierSwitch.module.css";

export type TierSwitchProps = {
  lang: Lang;
  /** "hidden" renders nothing (see lib/tier.ts). */
  availability: TierAvailability;
  /** The effective tier: always "free" unless availability is "available". */
  value: Tier;
  onChange: (tier: Tier) => void;
  entitlement: Entitlement | null;
  /** Where "Sign in to use Premium" returns to. */
  signInNext?: string;
  /** While a premium request is being prepared: the choice cannot change. */
  disabled?: boolean;
  /** A locked Premium was picked: remember the intent, so Premium is
   * already chosen once it can be used (the value itself stays Free). */
  onPremiumIntent?: () => void;
};

/** The line under the switch. Null = no line. `nudged` is true once a
 * signed-out viewer has reached for the locked Premium option. */
export function tierNote(
  lang: Lang,
  availability: TierAvailability,
  value: Tier,
  entitlement: Entitlement | null,
  nudged: boolean,
): { text: string; link?: { href: string; label: string } } | null {
  switch (availability) {
    case "hidden":
      return null;
    case "signed_out":
      return nudged ? { text: "", link: { href: "/signin", label: t(lang, "tier.signInToUse") } } : null;
    case "locked": {
      const link = { href: "/pricing", label: t(lang, "tier.getPremium") };
      if (entitlement?.blockedReason === "fair_use") {
        return { text: tWithDate(lang, "tier.fairUse", entitlement.resetsAt), link };
      }
      if (entitlement?.blockedReason === "no_credits") return { text: t(lang, "tier.outOfCredits"), link };
      return { text: t(lang, "tier.invite"), link };
    }
    case "available": {
      if (value === "free") return { text: t(lang, "tier.freeHint") };
      const left = premiumRemaining(entitlement);
      const count = !left
        ? ""
        : left.kind === "monthly"
          ? t(lang, "tier.monthlyLeft", { n: left.n })
          : t(lang, left.n === 1 ? "tier.creditsLeft.one" : "tier.creditsLeft.other", { n: left.n });
      return { text: [t(lang, "tier.premiumHint"), count].filter(Boolean).join(" ") };
    }
  }
}

/**
 * Free / Premium radio group beside "Get the verdict". Native radios in a
 * fieldset, so arrow keys and screen readers work as usual. While Premium
 * is locked (signed out, or nothing left to spend) choosing it never
 * changes the value: it reveals the sign-in or pricing link instead, in a
 * polite live region.
 *
 * The root is `display: contents`, so the fieldset sits next to the CTA in
 * the hero's button row and the note wraps onto its own full-width line.
 */
export function TierSwitch({
  lang,
  availability,
  value,
  onChange,
  entitlement,
  signInNext = "/",
  disabled = false,
  onPremiumIntent,
}: TierSwitchProps) {
  const name = useId();
  const noteId = useId();
  const [nudged, setNudged] = useState(false);
  if (availability === "hidden") return null;

  const locked = availability !== "available";
  const note = tierNote(lang, availability, value, entitlement, nudged);
  const href = (h: string) => (h === "/signin" ? `/signin?next=${encodeURIComponent(signInNext)}` : h);

  function pick(tier: Tier) {
    if (tier === "premium" && locked) {
      setNudged(true);
      onPremiumIntent?.();
      return;
    }
    onChange(tier);
  }

  return (
    <div className={styles.root}>
      <fieldset className={styles.group} aria-describedby={note ? noteId : undefined} disabled={disabled}>
        <legend className="sr-only">{t(lang, "tier.label")}</legend>
        <label className={styles.option}>
          <input
            type="radio"
            name={name}
            value="free"
            checked={value === "free"}
            onChange={() => pick("free")}
            className={styles.input}
          />
          <span className={styles.face}>{t(lang, "tier.free")}</span>
        </label>
        <label className={styles.option} data-locked={locked ? "" : undefined}>
          <input
            type="radio"
            name={name}
            value="premium"
            checked={value === "premium"}
            onChange={() => pick("premium")}
            onClick={() => {
              // A checked-and-reverted radio fires no second change event;
              // a click on the locked option still re-shows the note.
              if (locked) setNudged(true);
            }}
            className={styles.input}
          />
          <span className={styles.face}>
            <PremiumSpark className={styles.spark} />
            {t(lang, "tier.premium")}
            {locked ? (
              <>
                <svg className={styles.lock} viewBox="0 0 12 12" aria-hidden>
                  <rect x="2.5" y="5.3" width="7" height="5.2" rx="1.3" fill="currentColor" />
                  <path d="M4.2 5.3V4a1.8 1.8 0 0 1 3.6 0v1.3" fill="none" stroke="currentColor" strokeWidth="1.3" />
                </svg>
                {/* The lock is only drawn: say it too, before Premium is picked. */}
                <span className="sr-only">
                  {" "}
                  {t(lang, availability === "signed_out" ? "tier.lockedSignIn" : "tier.lockedNoAllowance")}
                </span>
              </>
            ) : null}
          </span>
        </label>
      </fieldset>
      <p id={noteId} className={note ? styles.note : "sr-only"} aria-live="polite">
        {note?.text}
        {note?.text && note.link ? " " : null}
        {note?.link ? (
          <Link
            href={href(note.link.href)}
            className={styles.link}
            onClick={note.link.href === "/signin" ? saveDraftForSignIn : undefined}
          >
            {note.link.label}
          </Link>
        ) : null}
      </p>
    </div>
  );
}
