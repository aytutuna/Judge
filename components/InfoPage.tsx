"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { legalLang, legalNotice, t, type Key, type Lang } from "@/lib/i18n";
import { useLang } from "@/lib/lang";
import { langDir, langTag } from "@/lib/langs";
import { OWNER_ADDRESS, POLICY_VERSION } from "@/lib/policy";
import { PRICING } from "@/lib/pricing";
import { noOrphan } from "@/lib/text";
import { useViewer } from "@/lib/use-viewer";
import { Faq } from "./home/Faq";
import { SampleVerdict } from "./home/SampleVerdict";
import { ScrollStory } from "./home/ScrollStory";
import styles from "./InfoPage.module.css";
import { SceneStage } from "./scene/SceneStage";
import { AppShell } from "./shell/AppShell";

/** Prose pages (/about, /privacy, /terms). Client-rendered chrome so the
 * language picker works the same as on the homepage. */

export const TERMS_UPDATED = "2026-10-30";

function Section({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <section className={styles.section} id={id}>
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
        <ArtCredit text={t(lang, "about.art")} />
      </Section>
    </>
  );
}

/** The court art credit: the packs and the author as links. */
const ART_PACKS: [string, string][] = [
  ["Modern Exteriors", "https://limezu.itch.io/modernexteriors"],
  ["Modern Interiors", "https://limezu.itch.io/moderninteriors"],
  ["Modern Farm", "https://limezu.itch.io/modernfarm"],
];

function ArtCredit({ text }: { text: string }) {
  const link = (label: string, href: string) => (
    <a href={href} className={styles.link} target="_blank" rel="noreferrer">
      {label}
    </a>
  );
  return (
    <p>
      {text.split(/({pack}|{author})/).map((part, i) => {
        if (part === "{author}") return <span key={i}>{link("LimeZu", "https://limezu.itch.io/")}</span>;
        if (part !== "{pack}") return part;
        return (
          <span key={i}>
            {ART_PACKS.map(([label, href], k) => (
              <span key={href}>
                {k ? ", " : ""}
                {link(label, href)}
              </span>
            ))}
          </span>
        );
      })}
    </p>
  );
}

/** A sentence with {email} slots, each one a real link. */
function ContactLine({ text, email }: { text: string; email: string }) {
  return (
    <>
      {text.split("{email}").map((part, i) => (
        <span key={i}>
          {i > 0 ? (
            <a href={`mailto:${email}`} className={styles.link}>
              {email}
            </a>
          ) : null}
          {part}
        </span>
      ))}
    </>
  );
}

/** A policy body: one paragraph per line, runs of "- " lines as a list. The
 * {address} line is dropped when there is no address. */
function PolicyBody({ text, email }: { text: string; email: string | null }) {
  const lines = text.split("\n").filter((l) => OWNER_ADDRESS || !l.includes("{address}"));
  const blocks: (string | string[])[] = [];
  for (const line of lines) {
    const item = line.startsWith("- ") ? line.slice(2) : null;
    const last = blocks[blocks.length - 1];
    if (item === null) blocks.push(line);
    else if (Array.isArray(last)) last.push(item);
    else blocks.push([item]);
  }
  const fill = (s: string) => {
    const filled = s.replace("{address}", OWNER_ADDRESS);
    return email ? <ContactLine text={filled} email={email} /> : filled.replace("{email}", "");
  };
  return (
    <>
      {blocks.map((b, i) =>
        Array.isArray(b) ? (
          <ul key={i} className={styles.bullets}>
            {b.map((item, k) => (
              <li key={k}>{fill(item)}</li>
            ))}
          </ul>
        ) : (
          <p key={i}>{fill(b)}</p>
        ),
      )}
    </>
  );
}

const PRIVACY_SECTIONS = [
  "who",
  "stored",
  "help",
  "purposes",
  "sensitive",
  "others",
  "automated",
  "access",
  "cases",
  "webSearch",
  "evidence",
  "accounts",
  "removal",
  "afterRemoval",
  "retention",
  "ip",
  "processors",
  "share",
  "location",
  "storage",
  "notStored",
  "security",
  "children",
  "rights",
  "regionEu",
  "regionUs",
  "regionCa",
  "regionBr",
  "changes",
] as const;

function Privacy({ lang, contactEmail }: { lang: Lang; contactEmail: string | null }) {
  return (
    <>
      {PRIVACY_SECTIONS.map((name) => (
        <Section key={name} title={t(lang, `privacy.${name}Title`)} id={name === "help" ? "help-improve" : undefined}>
          <PolicyBody text={t(lang, `privacy.${name}`)} email={contactEmail} />
        </Section>
      ))}
      {contactEmail ? (
        <Section title={t(lang, "privacy.contactTitle")}>
          <p>
            <ContactLine text={t(lang, "privacy.contact")} email={contactEmail} />
          </p>
        </Section>
      ) : null}
      <p>
        <Link href="/delete-account" className={styles.link}>
          {t(lang, "deletePage.title")}
        </Link>
      </p>
    </>
  );
}

function Terms({ lang, contactEmail, cap }: { lang: Lang; contactEmail: string | null; cap: number }) {
  const sections: [Key, string][] = [
    ["terms.whoTitle", t(lang, "terms.who")],
    ["terms.whatTitle", t(lang, "terms.what")],
    ["terms.contentTitle", t(lang, "terms.content")],
    ["terms.purchasesTitle", t(lang, "terms.purchases")],
    ["terms.fairUseTitle", t(lang, "terms.fairUse", { cap })],
    ["terms.asIsTitle", t(lang, "terms.asIs")],
    ["terms.changesTitle", t(lang, "terms.changes")],
  ];
  return (
    <>
      {sections.map(([title, body]) => (
        <Section key={title} title={t(lang, title)}>
          <p>{body}</p>
        </Section>
      ))}
      {contactEmail ? (
        <Section title={t(lang, "terms.contactTitle")}>
          <p>
            <ContactLine text={t(lang, "terms.contact")} email={contactEmail} />
          </p>
        </Section>
      ) : null}
    </>
  );
}

function updatedOn(lang: Lang, iso: string): string {
  const date = new Intl.DateTimeFormat(langTag(lang), { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  return t(lang, "terms.updated", { date: date.format(new Date(`${iso}T00:00:00Z`)) });
}

/** `contactEmail` is null when no real address is configured; the privacy
 * and terms pages then omit their contact section. */
export function InfoPage({
  page,
  contactEmail = null,
}: {
  page: "about" | "privacy" | "terms";
  contactEmail?: string | null;
}) {
  const lang = useLang();
  const { config } = useViewer();
  const about = page === "about";
  // A language without its own legal page shows the English one, marked as such.
  const prose = about ? lang : legalLang(lang, page);
  const notice = about ? null : legalNotice(lang, page);
  const cta = (
    <Link href="/" className={styles.cta} lang={prose === lang ? undefined : lang}>
      {t(lang, "shared.cta")}
    </Link>
  );
  return (
    <AppShell lang={lang} toggle>
      <main id="main" tabIndex={-1} className={styles.main}>
        <div
          className={`wrap ${styles.column}`}
          lang={prose === lang ? undefined : prose}
          dir={prose === lang ? undefined : langDir(prose)}
        >
          <header className={styles.intro}>
            <p className="kicker">{t(prose, `${page}.kicker`)}</p>
            <h1 className={styles.h1}>{noOrphan(t(prose, `${page}.title`))}</h1>
            <p className={styles.lead}>{t(prose, `${page}.lead`)}</p>
            {page === "terms" ? <p className={styles.notice}>{updatedOn(prose, TERMS_UPDATED)}</p> : null}
            {page === "privacy" ? <p className={styles.notice}>{updatedOn(prose, POLICY_VERSION)}</p> : null}
            {notice ? <p className={styles.notice}>{notice}</p> : null}
          </header>
          {about ? null : (
            <>
              <div className={styles.prose}>
                {page === "terms" ? (
                  <Terms
                    lang={prose}
                    contactEmail={contactEmail}
                    cap={(config?.pricing ?? PRICING).monthly.fairUseCap}
                  />
                ) : (
                  <Privacy lang={prose} contactEmail={contactEmail} />
                )}
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
