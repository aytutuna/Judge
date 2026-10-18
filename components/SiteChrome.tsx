import Link from "next/link";
import { t, type Lang } from "@/lib/i18n";
import { LangToggle } from "./LangToggle";

/** Shared page chrome. No hooks: usable from server pages (share page, which
 * passes its Accept-Language lang and no toggle) and client pages alike. */

export function SkipLink({ lang }: { lang: Lang }) {
  return (
    <a href="#main" className="skip-link">
      {t(lang, "nav.skip")}
    </a>
  );
}

export function SiteHeader({
  lang,
  toggle = false,
  howLink = false,
}: {
  lang: Lang;
  toggle?: boolean;
  howLink?: boolean;
}) {
  return (
    <header className="w-full max-w-3xl mx-auto px-4 pt-4 flex items-center justify-between gap-3">
      <Link
        href="/"
        aria-label={t(lang, "nav.home")}
        className="rounded-lg text-lg font-black tracking-tight"
        style={{ color: "var(--ink)" }}
      >
        <span aria-hidden>⚖️</span> Verdict
      </Link>
      <div className="flex items-center gap-3">
        {howLink ? (
          <a
            href="#how"
            className="hidden sm:inline rounded-md text-xs font-medium underline-offset-4 hover:underline"
            style={{ color: "var(--ink-2)" }}
          >
            {t(lang, "nav.how")}
          </a>
        ) : null}
        {toggle ? <LangToggle lang={lang} /> : null}
      </div>
    </header>
  );
}

export function SiteFooter({ lang, toggle = false }: { lang: Lang; toggle?: boolean }) {
  const link = "rounded-md underline-offset-4 hover:underline";
  return (
    <footer
      className="w-full mt-16"
      style={{ borderTop: "1px solid var(--line)" }}
    >
      <div className="max-w-3xl mx-auto px-4 py-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <Link href="/" className="self-start rounded-md font-black tracking-tight" style={{ color: "var(--ink)" }}>
            <span aria-hidden>⚖️</span> Verdict
          </Link>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            {t(lang, "footer.note")}
          </p>
        </div>
        <nav
          aria-label={t(lang, "footer.nav")}
          className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm"
          style={{ color: "var(--ink-2)" }}
        >
          <Link href="/" className={link}>
            {t(lang, "footer.home")}
          </Link>
          <Link href="/about" className={link}>
            {t(lang, "footer.about")}
          </Link>
          <Link href="/privacy" className={link}>
            {t(lang, "footer.privacy")}
          </Link>
          {toggle ? <LangToggle lang={lang} /> : null}
        </nav>
      </div>
    </footer>
  );
}
