"use client";

import Link from "next/link";
import type { MouseEvent } from "react";
import { saveDraftForSignIn } from "@/lib/draft";
import { t, type Key, type Lang } from "@/lib/i18n";
import styles from "./shell.module.css";

const NEW = "M12 5v14M5 12h14";
const LIST = "M8 6.5h11M8 12h11M8 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01";
const GEAR =
  "M8.25 12a3.75 3.75 0 1 0 7.5 0a3.75 3.75 0 1 0 -7.5 0M12 2.25v3M12 18.75v3M2.25 12h3M18.75 12h3M5.1 5.1l2.1 2.1M16.8 16.8l2.1 2.1M5.1 18.9l2.1-2.1M16.8 7.2l2.1-2.1";

/** The phone's tabs under the header, as in the native app: a new argument, My
 * verdicts, and Settings (where the account lives). `onHome` resets the home
 * page instead of navigating to itself. Hidden from 960px, where the header
 * carries the same links. */
export function TabBar({
  lang,
  pathname,
  onHome,
}: {
  lang: Lang;
  pathname: string | null;
  onHome?: () => void;
}) {
  type Tab = { href: string; label: Key; icon: string; on: boolean; onClick?: (e: MouseEvent) => void };
  const tabs: Tab[] = [
    {
      href: "/",
      label: "nav.new",
      icon: NEW,
      on: pathname === "/",
      onClick: onHome
        ? (e) => {
            e.preventDefault();
            onHome();
          }
        : undefined,
    },
    { href: "/verdicts", label: "nav.verdicts", icon: LIST, on: pathname === "/verdicts" },
    {
      href: "/settings",
      label: "nav.settings",
      icon: GEAR,
      on: pathname === "/settings",
      onClick: saveDraftForSignIn,
    },
  ];
  return (
    <nav aria-label={t(lang, "nav.tabs")} className={styles.tabs}>
      <ul>
        {tabs.map((tab) => (
          <li key={tab.label}>
            <Link href={tab.href} aria-current={tab.on ? "page" : undefined} onClick={tab.onClick}>
              <svg viewBox="0 0 24 24" aria-hidden>
                <path
                  d={tab.icon}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {t(lang, tab.label)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
