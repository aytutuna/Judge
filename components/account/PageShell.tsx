"use client";

import type { ReactNode } from "react";
import { type Lang } from "@/lib/i18n";
import { noOrphan } from "@/lib/text";
import { SiteFooter, SiteHeader, SkipLink } from "../SiteChrome";
import { AppShell } from "../shell/AppShell";
import styles from "./AccountPages.module.css";

/** Chrome and intro shared by /signin, /account, /pricing and /verdicts:
 * the same type scale as the prose pages, one lang scope. All but sign-in
 * sit in the app shell; sign-in (`bare`) keeps the plain header and footer,
 * as a step on the way somewhere else. */
export function PageShell({
  lang,
  kicker,
  title,
  lead,
  wide = false,
  bare = false,
  children,
}: {
  lang: Lang;
  kicker: string;
  title: string;
  lead?: string;
  wide?: boolean;
  bare?: boolean;
  children: ReactNode;
}) {
  const main = (
    <main id="main" tabIndex={-1} className={styles.main}>
      <div className={`wrap ${wide ? styles.wide : styles.narrow}`}>
        <header className={styles.intro}>
          <p className="kicker">{kicker}</p>
          <h1 className={styles.h1}>{noOrphan(title)}</h1>
          {lead ? <p className={styles.lead}>{lead}</p> : null}
        </header>
        {children}
      </div>
    </main>
  );
  if (!bare) {
    return (
      <AppShell lang={lang} toggle>
        {main}
      </AppShell>
    );
  }
  return (
    <div lang={lang} className="contents">
      <SkipLink lang={lang} />
      <SiteHeader lang={lang} />
      {main}
      <SiteFooter lang={lang} toggle />
    </div>
  );
}
