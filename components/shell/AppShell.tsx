"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { t, type Lang } from "@/lib/i18n";
import { langDir } from "@/lib/langs";
import { useViewer } from "@/lib/use-viewer";
import { accountEntry } from "../AccountMenu";
import { SiteFooter, SiteHeader, SkipLink } from "../SiteChrome";
import { TabBar } from "./TabBar";
import styles from "./shell.module.css";

/**
 * Page frame for the app's own pages: the header (with "My verdicts" from
 * the desktop breakpoint), the page, the footer unless `footer` is off,
 * and below 960px the bottom tabs. `toggle` shows the language picker
 * (pages whose chrome reads the client language store). The home page
 * hides the tabs while its composer is docked (`tabs`), and `onHome` lets
 * it reset itself from the first tab.
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
  const { config, me } = useViewer();
  return (
    <div lang={lang} dir={langDir(lang)} className={styles.shell} data-tabs={tabs ? "" : undefined}>
      <SkipLink lang={lang} />
      <SiteHeader lang={lang} toggle={toggle}>
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
      {tabs ? (
        <TabBar lang={lang} pathname={pathname} account={accountEntry(config, me)} onHome={onHome} />
      ) : null}
    </div>
  );
}
