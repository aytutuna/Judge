"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { t, type Lang } from "@/lib/i18n";
import { langDir } from "@/lib/langs";
import { AgeGate } from "../AgeGate";
import { SiteFooter, SiteHeader, SkipLink } from "../SiteChrome";
import { GamifyButton } from "./GamifyButton";
import { SideMenu } from "./SideMenu";
import styles from "./shell.module.css";

const FIELD = "input, textarea, select, button, a, label, summary, [contenteditable], [role=button]";

/** On a touch screen a tap on plain page space puts the keyboard away. */
export function blurOnTapOutside(
  pointerType: string,
  active: Pick<HTMLElement, "matches" | "blur"> | null,
  target: Pick<Element, "closest"> | null,
) {
  if (pointerType !== "touch" || !active?.matches("input, textarea, [contenteditable]")) return;
  if (target?.closest(FIELD)) return;
  active.blur();
}

export function useBlurOnTapOutside(on = true) {
  useEffect(() => {
    if (!on) return;
    // pointerup, not pointerdown: a drag to scroll ends in pointercancel, so the keyboard stays until the tap.
    const onTap = (e: PointerEvent) => blurOnTapOutside(e.pointerType, document.activeElement as HTMLElement | null, e.target as Element | null);
    document.addEventListener("pointerup", onTap);
    return () => document.removeEventListener("pointerup", onTap);
  }, [on]);
}

/**
 * Page frame for the app's own pages: the header (with "Verdicts" from
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
  useBlurOnTapOutside();
  return (
    <div lang={lang} dir={langDir(lang)} className={styles.shell}>
      <SkipLink lang={lang} />
      <SiteHeader
        lang={lang}
        toggle={toggle}
        lead={tabs ? <SideMenu lang={lang} pathname={pathname} onHome={onHome} /> : undefined}
      >
        <GamifyButton lang={lang} />
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
      <AgeGate lang={lang} />
    </div>
  );
}
