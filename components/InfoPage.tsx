"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { t, type Key, type Lang } from "@/lib/i18n";
import { useLang } from "@/lib/lang";
import { noOrphan } from "@/lib/text";
import { useViewer } from "@/lib/use-viewer";
import { Faq } from "./home/Faq";
import { SampleVerdict } from "./home/SampleVerdict";
import { ScrollStory } from "./home/ScrollStory";
import styles from "./InfoPage.module.css";
import { SceneStage } from "./scene/SceneStage";
import { AppShell } from "./shell/AppShell";

/** Prose pages (/about, /privacy). Client-rendered chrome so the TR|EN
 * toggle works the same as on the homepage. */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.h2}>{noOrphan(title)}</h2>
      {children}
    </section>
  );
}

/** Extras this deployment offers (GET /api/v1/config `features`). */
export type InfoFeatures = { cases: boolean; evidence: boolean };

/** About's bullets on two-sided cases, which every account gets. */
export function caseAboutKeys(features: InfoFeatures | null | undefined): Key[] {
  return features?.cases ? ["about.cases1", "about.cases2"] : [];
}

/** About's Premium bullets for the features that are switched on. Pass
 * null while Premium is off. */
export function premiumAboutKeys(features: InfoFeatures | null | undefined): Key[] {
  if (!features) return [];
  const keys: Key[] = [];
  if (features.evidence) keys.push("about.premium2");
  if (features.cases) keys.push("about.premium3", "about.premium4");
  return keys;
}

function About({ lang, features, premiumOn }: { lang: Lang; features: InfoFeatures | null; premiumOn: boolean }) {
  const limits: Key[] = ["about.limit1", "about.limit2", "about.limit3", "about.limit4"];
  const cases = caseAboutKeys(features);
  const premium = premiumAboutKeys(premiumOn ? features : null);
  // The method itself is the scroll story above the prose.
  return (
    <>
      <Section title={t(lang, "about.honestTitle")}>
        <p>{t(lang, "about.honest")}</p>
      </Section>
      {cases.length > 0 ? (
        <Section title={t(lang, "about.casesTitle")}>
          <ul className={styles.bullets}>
            {cases.map((k) => (
              <li key={k}>{t(lang, k)}</li>
            ))}
          </ul>
        </Section>
      ) : null}
      {premium.length > 0 ? (
        <Section title={t(lang, "about.premiumTitle")}>
          <ul className={styles.bullets}>
            {premium.map((k) => (
              <li key={k}>{t(lang, k)}</li>
            ))}
          </ul>
        </Section>
      ) : null}
      <Section title={t(lang, "about.limitsTitle")}>
        <ul className={styles.bullets}>
          {limits.map((k) => (
            <li key={k}>{t(lang, k)}</li>
          ))}
        </ul>
      </Section>
      <Section title={t(lang, "about.builtTitle")}>
        <p>{t(lang, "about.built")}</p>
      </Section>
    </>
  );
}

function Privacy({ lang, contactEmail }: { lang: Lang; contactEmail: string | null }) {
  const sections: [Key, Key][] = [
    ["privacy.storedTitle", "privacy.stored"],
    ["privacy.accessTitle", "privacy.access"],
    ["privacy.removalTitle", "privacy.removal"],
    ["privacy.retentionTitle", "privacy.retention"],
    ["privacy.locationTitle", "privacy.location"],
    ["privacy.notStoredTitle", "privacy.notStored"],
    ["privacy.accountsTitle", "privacy.accounts"],
    ["privacy.webSearchTitle", "privacy.webSearch"],
    // Disclosed whether or not this deployment has switched them on: what
    // happens to the data when they are used never depends on a flag.
    ["privacy.casesTitle", "privacy.cases"],
    ["privacy.evidenceTitle", "privacy.evidence"],
    ["privacy.ipTitle", "privacy.ip"],
    ["privacy.processorsTitle", "privacy.processors"],
    ["privacy.shareTitle", "privacy.share"],
    ["privacy.rightsTitle", "privacy.rights"],
  ];
  // Split around the {email} slot so the address can be a real link while
  // the sentence stays one whole dictionary string.
  const [before, after = ""] = t(lang, "privacy.contact").split("{email}");
  return (
    <>
      {sections.map(([title, body]) => (
        <Section key={title} title={t(lang, title)}>
          <p>{t(lang, body)}</p>
        </Section>
      ))}
      {contactEmail ? (
        <Section title={t(lang, "privacy.contactTitle")}>
          <p>
            {before}
            <a href={`mailto:${contactEmail}`} className={styles.link}>
              {contactEmail}
            </a>
            {after}
          </p>
        </Section>
      ) : null}
    </>
  );
}

/** `contactEmail` is null when no real address is configured; the privacy
 * page then omits its contact section. */
export function InfoPage({
  page,
  contactEmail = null,
}: {
  page: "about" | "privacy";
  contactEmail?: string | null;
}) {
  const lang = useLang();
  const { config } = useViewer();
  const about = page === "about";
  const cta = (
    <Link href="/" className={styles.cta}>
      {t(lang, "shared.cta")}
    </Link>
  );
  return (
    <AppShell lang={lang} toggle>
      <main id="main" tabIndex={-1} className={styles.main}>
        <div className={`wrap ${styles.column}`}>
          <header className={styles.intro}>
            <p className="kicker">{t(lang, about ? "about.kicker" : "privacy.kicker")}</p>
            <h1 className={styles.h1}>{noOrphan(t(lang, about ? "about.title" : "privacy.title"))}</h1>
            <p className={styles.lead}>{t(lang, about ? "about.lead" : "privacy.lead")}</p>
          </header>
          {about ? null : (
            <>
              <div className={styles.prose}>
                <Privacy lang={lang} contactEmail={contactEmail} />
              </div>
              {cta}
            </>
          )}
        </div>
        {about ? (
          <>
            <SceneStage lang={lang}>
              <ScrollStory lang={lang} />
            </SceneStage>
            <SampleVerdict lang={lang} />
            <div className={`wrap ${styles.column}`}>
              <div className={styles.prose}>
                <About lang={lang} features={config?.features ?? null} premiumOn={config?.premiumEnabled === true} />
              </div>
            </div>
            <Faq lang={lang} features={config?.features ?? null} premium={config?.premiumEnabled === true} />
            <div className={`wrap ${styles.column}`}>{cta}</div>
          </>
        ) : null}
      </main>
    </AppShell>
  );
}
