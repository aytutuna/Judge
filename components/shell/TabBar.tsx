"use client";

import Link from "next/link";
import type { MouseEvent } from "react";
import { saveDraftForSignIn } from "@/lib/draft";
import { t, type Key, type Lang } from "@/lib/i18n";
import styles from "./shell.module.css";

const NEW = "M12 5v14M5 12h14";
const LIST = "M8 6.5h11M8 12h11M8 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01";
const PERSON = "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.5 20c.9-3.3 3.8-5 7.5-5s6.6 1.7 7.5 5";

/** The phone's bottom tabs, as in the native app: a new argument, My
 * verdicts, and the account (sign-in while signed out). Like the header's
 * AccountMenu, the third tab is left out while `account` is "none". `onHome`
 * resets the home page instead of navigating to itself. Hidden from 960px,
 * where the header carries the same links. */
export function TabBar({
  lang,
  pathname,
  account,
  onHome,
}: {
  lang: Lang;
  pathname: string | null;
  account: "none" | "signin" | "menu";
  onHome?: () => void;
}) {
  const back = pathname && pathname.startsWith("/") ? pathname : "/";
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
  ];
  if (account === "signin") {
    tabs.push({
      href: `/signin?next=${encodeURIComponent(back)}`,
      label: "nav.signIn",
      icon: PERSON,
      on: false,
      onClick: saveDraftForSignIn,
    });
  } else if (account === "menu") {
    tabs.push({ href: "/account", label: "nav.account", icon: PERSON, on: pathname === "/account" });
  }
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
