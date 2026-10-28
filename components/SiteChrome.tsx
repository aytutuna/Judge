import Link from "next/link";
import type { ReactNode } from "react";
import { t, type Lang } from "@/lib/i18n";
import { AccountMenu } from "./AccountMenu";
import { BrandMark } from "./BrandMark";
import { LangPicker } from "./LangPicker";
import styles from "./SiteChrome.module.css";

/** Shared page chrome. No hooks: usable from server pages (share page, which
 * passes its Accept-Language lang and no toggle) and client pages alike. The
 * account entry is its own client component and renders nothing until the
 * viewer store has answered, so server HTML is unchanged. */

export function SkipLink({ lang }: { lang: Lang }) {
  return (
    <a href="#main" className="skip-link">
      {t(lang, "nav.skip")}
    </a>
  );
}

/** Fixed, blurred 56px nav, with a spacer of the same height so the page
 * starts below it. `children` go before the account entry (the app shell's
 * "Verdicts" link). */
export function SiteHeader({ lang, toggle = false, children }: { lang: Lang; toggle?: boolean; children?: ReactNode }) {
  return (
    <>
      <header className={styles.nav}>
        <div className={`wrap ${styles.navInner}`}>
          <Link href="/" aria-label={t(lang, "nav.home")} className={styles.brand}>
            <BrandMark size={28} />
            Judge
          </Link>
          <div className={styles.navRight}>
            {toggle ? <LangPicker lang={lang} /> : null}
            {children}
            <span className={styles.account}>
              <AccountMenu lang={lang} />
            </span>
          </div>
        </div>
      </header>
      <div aria-hidden className={styles.spacer} />
    </>
  );
}

export function SiteFooter({ lang, toggle = false }: { lang: Lang; toggle?: boolean }) {
  return (
    <footer className={styles.footer}>
      <div className={`wrap ${styles.foot}`}>
        <div className={styles.footBrand}>
          <Link href="/" className={styles.brand}>
            <BrandMark size={28} />
            Judge
          </Link>
          <p className={styles.note}>{t(lang, "footer.note")}</p>
        </div>
        <div className={styles.footRight}>
          <nav aria-label={t(lang, "footer.nav")}>
            <ul className={styles.links}>
              <li>
                <Link href="/">{t(lang, "footer.home")}</Link>
              </li>
              <li>
                <Link href="/about">{t(lang, "footer.about")}</Link>
              </li>
              <li>
                <Link href="/pricing">{t(lang, "footer.pricing")}</Link>
              </li>
              <li>
                <Link href="/privacy">{t(lang, "footer.privacy")}</Link>
              </li>
            </ul>
          </nav>
          {toggle ? <LangPicker lang={lang} /> : null}
        </div>
      </div>
    </footer>
  );
}
