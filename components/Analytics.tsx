"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { setAnalytics, signInCompleted, track } from "@/lib/analytics/client";
import { useViewer } from "@/lib/use-viewer";

const SCREENS: [RegExp, string][] = [
  [/^\/$/, "home"],
  [/^\/(c|r)(\/|$)/, "case_detail"],
  [/^\/verdicts$/, "verdicts"],
  [/^\/account$/, "settings"],
  [/^\/pricing$/, "pricing"],
  [/^\/signin$/, "sign_in"],
  [/^\/about$/, "about"],
];

/** Reports app_open and screen_view for the whole site once the config says
 * usage events are on. Renders nothing. */
export function Analytics() {
  const pathname = usePathname();
  const { status, config, me } = useViewer();
  const signedIn = Boolean(me?.user);
  const on = config?.features?.analytics === true;

  useEffect(() => {
    if (status === "ready" || status === "error") setAnalytics(on);
  }, [status, on]);

  useEffect(() => {
    if (signedIn) signInCompleted();
  }, [signedIn]);

  useEffect(() => {
    // One flag per tab session, not an identifier.
    try {
      if (sessionStorage.getItem("app_open")) return;
      sessionStorage.setItem("app_open", "1");
    } catch {
      return;
    }
    track("app_open");
  }, []);

  useEffect(() => {
    const screen = SCREENS.find(([re]) => re.test(pathname))?.[1];
    if (screen) track("screen_view", { screen });
  }, [pathname]);

  return null;
}
