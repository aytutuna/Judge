"use client";

import Link from "next/link";
import { t } from "@/lib/i18n";
import { useLang } from "@/lib/lang";
import { SiteFooter, SiteHeader, SkipLink } from "@/components/SiteChrome";

export default function NotFound() {
  const lang = useLang();
  return (
    <div lang={lang} className="contents">
      <SkipLink lang={lang} />
      <SiteHeader lang={lang} toggle />
      <main
        id="main"
        tabIndex={-1}
        className="flex-1 w-full max-w-xl mx-auto px-4 pt-16 flex flex-col items-center gap-5 text-center outline-none"
      >
        <span aria-hidden className="text-5xl">
          🪑
        </span>
        <h1 className="text-3xl font-black tracking-tight" style={{ color: "var(--ink)" }}>
          {t(lang, "notFound.title")}
        </h1>
        <p className="text-base" style={{ color: "var(--ink-2)" }}>
          {t(lang, "notFound.body")}
        </p>
        <Link
          href="/"
          className="rounded-full px-6 py-3.5 text-base font-bold"
          style={{ background: "var(--ink)", color: "var(--plane)" }}
        >
          {t(lang, "shared.cta")}
        </Link>
      </main>
      <SiteFooter lang={lang} toggle />
    </div>
  );
}
