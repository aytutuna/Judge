"use client";

import Link from "next/link";
import type { Entitlement, PricingInfo } from "@/lib/account-types";
import { t, tWithDate, type Key, type Lang } from "@/lib/i18n";
import { useLang } from "@/lib/lang";
import { PRICING, formatPrice } from "@/lib/pricing";
import { signInOffered, useViewer } from "@/lib/use-viewer";
import { PremiumSpark } from "../PremiumBadge";
import styles from "./AccountPages.module.css";
import { PageShell } from "./PageShell";

const FEATURES: Key[] = ["pricing.premium.f1", "pricing.premium.f2", "pricing.premium.f3", "pricing.premium.f4"];

/** What every verdict gets, plus the extras this deployment offers. */
export function featureKeys(features?: { cases: boolean; evidence: boolean } | null): Key[] {
  const keys = [...FEATURES];
  if (features?.evidence) keys.push("pricing.premium.f5");
  if (features?.cases) keys.push("pricing.premium.f7", "pricing.premium.f6");
  return keys;
}

function Features({ lang, keys }: { lang: Lang; keys: Key[] }) {
  return (
    <ul className={styles.features}>
      {keys.map((k) => (
        <li key={k}>
          <span className={styles.tick} aria-hidden>
            <svg viewBox="0 0 10 10">
              <path
                d="M2 5.3 4.1 7.3 8 2.9"
                fill="none"
                stroke="var(--paper)"
                strokeWidth={1.6}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span>{t(lang, k)}</span>
        </li>
      ))}
    </ul>
  );
}

export type PricingTableProps = {
  lang: Lang;
  pricing: PricingInfo;
  /** null while /config is loading: neither the preview notice nor the
   * sign-in call to action shows until it is known. */
  premiumEnabled: boolean | null;
  signedIn: boolean;
  /** At least one sign-in method is set up; without one the sign-in call
   * to action would lead to a page where nothing works. */
  signInOffered: boolean;
  /** The signed-in viewer's balance and plan, shown above the plans. */
  entitlement?: Entitlement | null;
  /** Premium extras on offer (two-sided cases, screenshot evidence). */
  features?: { cases: boolean; evidence: boolean } | null;
};

/** What a verdict includes beside the packs and the monthly plan. Buy
 * buttons stay disabled ("Coming soon") until a payment provider exists.
 * Stateless for tests. */
export function PricingTable({
  lang,
  pricing,
  premiumEnabled,
  signedIn,
  signInOffered,
  entitlement,
  features = null,
}: PricingTableProps) {
  const buy = (label: string) => (
    // TODO: wire buy_tapped when purchases open.
    <button type="button" className={`${styles.btn} ${styles.secondary}`} disabled>
      {pricing.purchasesEnabled ? label : t(lang, "pricing.comingSoon")}
    </button>
  );

  const sub = entitlement?.subscription ?? null;

  return (
    <>
      {signedIn && entitlement ? (
        <p className={styles.status} data-testid="pricing-status">
          <strong>
            {t(lang, "account.credits")}: {entitlement.credits}
          </strong>
          {sub ? (
            <span>
              {tWithDate(lang, sub.willRenew ? "account.subscriptionRenews" : "account.subscriptionUntil", sub.periodEnd)}
            </span>
          ) : null}
        </p>
      ) : null}
      {premiumEnabled === false ? <p className={styles.notice}>{t(lang, "pricing.preview")}</p> : null}
      <div className={styles.plans}>
        <section className={`${styles.plan} ${styles.planHighlight}`} aria-labelledby="plan-buy">
          <h2 id="plan-buy" className={styles.planTitle}>
            {t(lang, "pricing.buy.title")}
          </h2>

          <h3 className={styles.groupTitle}>{t(lang, "pricing.packsTitle")}</h3>
          <p className={styles.small}>{t(lang, "pricing.packsLead")}</p>
          <ul className={styles.offers}>
            {pricing.packs.map((p) => (
              <li key={p.id} className={styles.offer}>
                <p className={styles.offerName}>{p.credits === 1 ? t(lang, "pricing.pack.one") : t(lang, "pricing.pack", { n: p.credits })}</p>
                <p className={styles.offerMeta}>
                  {t(lang, "pricing.perVerdict", { price: formatPrice(p.priceUsd / p.credits, lang) })}
                </p>
                <span className={styles.offerPrice}>{formatPrice(p.priceUsd, lang)}</span>
                {buy(formatPrice(p.priceUsd, lang))}
              </li>
            ))}
          </ul>

          <h3 className={styles.groupTitle}>{t(lang, "pricing.monthly.title")}</h3>
          <ul className={styles.offers}>
            <li className={styles.offer}>
              <p className={styles.offerName}>
                {t(lang, "pricing.monthly.cap", { n: pricing.monthly.fairUseCap })}
              </p>
              <p className={styles.offerMeta}>{t(lang, "pricing.monthly.renews")}</p>
              <span className={styles.offerPrice}>{formatPrice(pricing.monthly.priceUsd, lang)}</span>
              {buy(formatPrice(pricing.monthly.priceUsd, lang))}
            </li>
          </ul>
          {premiumEnabled && !signedIn && signInOffered ? (
            <Link href="/signin?next=%2Fpricing" className={`${styles.btn} ${styles.primary}`}>
              {t(lang, "pricing.signIn")}
            </Link>
          ) : null}
        </section>

        <section className={styles.plan} aria-labelledby="plan-included">
          <h2 id="plan-included" className={styles.planTitle}>
            <PremiumSpark />
            {t(lang, "pricing.included.title")}
          </h2>
          <Features lang={lang} keys={featureKeys(premiumEnabled ? features : null)} />
        </section>
      </div>
      <p className={styles.small}>{t(lang, "pricing.note")}</p>
      <p className={styles.small}>
        <Link href="/terms" className={styles.link}>
          {t(lang, "footer.terms")}
        </Link>
        {" · "}
        <Link href="/privacy" className={styles.link}>
          {t(lang, "footer.privacy")}
        </Link>
      </p>
    </>
  );
}

/** /pricing: prices from /api/v1/config, falling back to lib/pricing.ts
 * (the same source the server uses) until it answers. */
export function PricingView() {
  const lang = useLang();
  const { config, me, status } = useViewer();
  const known = status === "ready" || status === "error";
  const signedIn = Boolean(me?.user);
  // Only promise the free first verdict once we know nobody is signed in.
  const member = signedIn || !known;
  return (
    <PageShell
      lang={lang}
      kicker={t(lang, "nav.pricing")}
      title={t(lang, member ? "pricing.titleMember" : "pricing.title")}
      lead={t(lang, member ? "pricing.leadMember" : "pricing.lead")}
      wide
    >
      <PricingTable
        lang={lang}
        pricing={config?.pricing ?? PRICING}
        premiumEnabled={known ? config?.premiumEnabled === true : null}
        signedIn={signedIn}
        signInOffered={signInOffered(config)}
        entitlement={me?.entitlement ?? null}
        features={config?.features ?? null}
      />
    </PageShell>
  );
}
