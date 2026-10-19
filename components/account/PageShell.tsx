"use client";

import type { ReactNode } from "react";
import { type Lang } from "@/lib/i18n";
import { noOrphan } from "@/lib/text";
import { SiteFooter, SiteHeader, SkipLink } from "../SiteChrome";
import styles from "./AccountPages.module.css";

/** Chrome and intro shared by /signin, /account and /pricing: the same
 * header, footer and type scale as the prose pages, one lang scope. */
export function PageShell({
  lang,
  kicker,
  title,
  lead,
  wide = false,
  children,
}: {
  lang: Lang;
  kicker: string;
  title: string;
  lead?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div lang={lang} className="contents">
      <SkipLink lang={lang} />
      <SiteHeader lang={lang} toggle />
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
      <SiteFooter lang={lang} toggle />
    </div>
  );
}
