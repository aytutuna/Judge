"use client";

import Link from "next/link";
import { BalanceFallback } from "@/components/scene/BalanceFallback";
import { SiteFooter, SiteHeader, SkipLink } from "@/components/SiteChrome";
import { t } from "@/lib/i18n";
import { useLang } from "@/lib/lang";
import styles from "./not-found.module.css";

export default function NotFound() {
  const lang = useLang();
  return (
    <div lang={lang} className="contents">
      <SkipLink lang={lang} />
      <SiteHeader lang={lang} />
      <main id="main" tabIndex={-1} className={styles.main}>
        <div className={`wrap ${styles.inner}`}>
          <BalanceFallback empty className={styles.art} />
          <h1 className={styles.title}>{t(lang, "notFound.title")}</h1>
          <p className={styles.body}>{t(lang, "notFound.body")}</p>
          <Link href="/" className={styles.cta}>
            {t(lang, "shared.cta")}
          </Link>
        </div>
      </main>
      <SiteFooter lang={lang} toggle />
    </div>
  );
}
