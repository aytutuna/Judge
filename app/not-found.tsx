"use client";

import Link from "next/link";
import { useEffect } from "react";
import JudgingScene from "@/components/scene/JudgingScene";
import { SiteFooter, SiteHeader, SkipLink } from "@/components/SiteChrome";
import { t } from "@/lib/i18n";
import { langDir } from "@/lib/langs";
import { useLang } from "@/lib/lang";
import { resetScene } from "@/lib/scene-bridge";
import styles from "./not-found.module.css";

export default function NotFound() {
  const lang = useLang();
  // A verdict left published by a case page would freeze the scale in its pose.
  useEffect(() => {
    resetScene();
  }, []);
  return (
    <div lang={lang} dir={langDir(lang)} className="contents">
      <SkipLink lang={lang} />
      <SiteHeader lang={lang} toggle />
      <main id="main" tabIndex={-1} className={styles.main}>
        <div className={`wrap ${styles.inner}`}>
          <JudgingScene play className={styles.art} />
          <h1 className={styles.title}>{t(lang, "notFound.title")}</h1>
          <Link href="/" className={styles.cta}>
            {t(lang, "shared.cta")}
          </Link>
        </div>
      </main>
      <SiteFooter lang={lang} toggle />
    </div>
  );
}
