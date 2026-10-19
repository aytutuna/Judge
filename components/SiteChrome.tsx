import Link from "next/link";
import { t, type Lang } from "@/lib/i18n";
import { BrandMark } from "./BrandMark";
import { LangToggle } from "./LangToggle";
import styles from "./SiteChrome.module.css";

/** Shared page chrome. No hooks: usable from server pages (share page, which
 * passes its Accept-Language lang and no toggle) and client pages alike. */

export function SkipLink({ lang }: { lang: Lang }) {
  return (
    <a href="#main" className="skip-link">
      {t(lang, "nav.skip")}
    </a>
  );
}

/**
 * Fixed, blurred 56px nav. By default it also renders a spacer of the same
 * height so the page starts below it; `overlay` drops the spacer for pages
 * whose first section deliberately runs under the nav (the homepage hero).
 */
export function SiteHeader({
  lang,
  toggle = false,
  howLink = false,
  overlay = false,
}: {
  lang: Lang;
  toggle?: boolean;
  howLink?: boolean;
  overlay?: boolean;
}) {
  return (
    <>
      <header className={styles.nav}>
        <div className={`wrap ${styles.navInner}`}>
          <Link href="/" aria-label={t(lang, "nav.home")} className={styles.brand}>
            <BrandMark size={28} />
            Verdict
          </Link>
          <div className={styles.navRight}>
            {howLink ? (
              <nav aria-label={t(lang, "nav.primary")} className={styles.primary}>
                <a href="#how" className={styles.navLink}>
                  {t(lang, "nav.how")}
                </a>
              </nav>
            ) : null}
            {toggle ? <LangToggle lang={lang} /> : null}
          </div>
        </div>
      </header>
      {overlay ? null : <div aria-hidden className={styles.spacer} />}
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
            Verdict
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
                <Link href="/privacy">{t(lang, "footer.privacy")}</Link>
              </li>
            </ul>
          </nav>
          {toggle ? <LangToggle lang={lang} /> : null}
        </div>
      </div>
    </footer>
  );
}
