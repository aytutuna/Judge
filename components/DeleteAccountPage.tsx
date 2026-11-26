"use client";

import Link from "next/link";
import { t, type Key } from "@/lib/i18n";
import { useLang } from "@/lib/lang";
import { noOrphan } from "@/lib/text";
import styles from "./InfoPage.module.css";
import { AppShell } from "./shell/AppShell";

const SECTIONS: [Key, Key][] = [
  ["deletePage.appTitle", "deletePage.app"],
  ["deletePage.webTitle", "deletePage.web"],
  ["deletePage.billingTitle", "deletePage.billing"],
  ["deletePage.removedTitle", "deletePage.removed"],
  ["deletePage.keptTitle", "deletePage.kept"],
];

/** /delete-account: public, signed out, for the Play Store's data deletion link. */
export function DeleteAccountPage({ contactEmail }: { contactEmail: string | null }) {
  const lang = useLang();
  const [before, after = ""] = t(lang, "deletePage.mail").split("{email}");
  return (
    <AppShell lang={lang} toggle>
      <main id="main" tabIndex={-1} className={styles.main}>
        <div className={`wrap ${styles.column}`}>
          <header className={styles.intro}>
            <h1 className={styles.h1}>{noOrphan(t(lang, "deletePage.title"))}</h1>
            <p className={styles.lead}>{t(lang, "deletePage.lead")}</p>
          </header>
          <div className={styles.prose}>
            {SECTIONS.map(([title, body]) => (
              <section key={title} className={styles.section}>
                <h2 className={styles.h2}>{noOrphan(t(lang, title))}</h2>
                <p>{t(lang, body)}</p>
              </section>
            ))}
            {contactEmail ? (
              <section className={styles.section}>
                <h2 className={styles.h2}>{noOrphan(t(lang, "deletePage.mailTitle"))}</h2>
                <p>
                  {before}
                  <a href={`mailto:${contactEmail}`} className={styles.link}>
                    {contactEmail}
                  </a>
                  {after}
                </p>
              </section>
            ) : null}
          </div>
          <Link href="/" className={styles.cta}>
            {t(lang, "shared.cta")}
          </Link>
        </div>
      </main>
    </AppShell>
  );
}
