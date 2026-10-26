"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { t, type Lang } from "@/lib/i18n";
import { SiteFooter, SiteHeader, SkipLink } from "../SiteChrome";
import styles from "./shell.module.css";

/**
 * Page frame for the app's own pages: the header (its "+" for a new
 * argument, and "My verdicts"), the page, and the footer unless `footer` is
 * off. `toggle` shows the footer's TR | EN switch (pages whose chrome reads
 * the client language store). `onNew` lets the home page reset itself from
 * the header's "+".
 */
export function AppShell({
  lang,
  toggle = false,
  footer = true,
  onNew,
  children,
}: {
  lang: Lang;
  toggle?: boolean;
  footer?: boolean;
  onNew?: () => void;
  children: ReactNode;
}) {
  const pathname = usePathname();
  return (
    <div lang={lang} className={styles.shell}>
      <SkipLink lang={lang} />
      <SiteHeader lang={lang} onNew={onNew}>
        <Link
          href="/verdicts"
          className={styles.headerLink}
          aria-current={pathname === "/verdicts" ? "page" : undefined}
        >
          {t(lang, "nav.verdicts")}
        </Link>
      </SiteHeader>
      {children}
      {footer ? <SiteFooter lang={lang} toggle={toggle} /> : null}
    </div>
  );
}
