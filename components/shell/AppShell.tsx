"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { t, type Lang } from "@/lib/i18n";
import { langDir } from "@/lib/langs";
import { AgeGate } from "../AgeGate";
import { SiteFooter, SiteHeader, SkipLink } from "../SiteChrome";
import { SideMenu } from "./SideMenu";
import styles from "./shell.module.css";

/**
 * Page frame for the app's own pages: the header (with "Verdicts" and "Settings" from
 * the desktop breakpoint), the page, the footer unless `footer` is off,
 * and below 960px a menu button at the start of the header. `toggle` shows the
 * language picker (pages whose chrome reads the client language store). The
 * home page hides the menu on the judging screen (`tabs`), and `onHome` lets
 * it reset itself from the menu's first row.
 */
export function AppShell({
  lang,
  toggle = false,
  footer = true,
  tabs = true,
  onHome,
  children,
}: {
  lang: Lang;
  toggle?: boolean;
  footer?: boolean;
  tabs?: boolean;
  onHome?: () => void;
  children: ReactNode;
}) {
  const pathname = usePathname();
  return (
    <div lang={lang} dir={langDir(lang)} className={styles.shell}>
      <SkipLink lang={lang} />
      <SiteHeader
        lang={lang}
        toggle={toggle}
        lead={tabs ? <SideMenu lang={lang} pathname={pathname} onHome={onHome} /> : undefined}
      >
        <Link
          href="/verdicts"
          className={styles.headerLink}
          aria-current={pathname === "/verdicts" ? "page" : undefined}
        >
          {t(lang, "nav.verdicts")}
        </Link>
        <Link
          href="/settings"
          className={styles.headerLink}
          aria-current={pathname === "/settings" ? "page" : undefined}
        >
          {t(lang, "nav.settings")}
        </Link>
      </SiteHeader>
      {children}
      {footer ? <SiteFooter lang={lang} toggle={toggle} /> : null}
      <AgeGate lang={lang} />
    </div>
  );
}
