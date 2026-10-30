"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { isTracking, setAnalytics, signInCompleted, track } from "@/lib/analytics/client";
import { useViewer } from "@/lib/use-viewer";

const SCREENS: [RegExp, string][] = [
  [/^\/$/, "home"],
  [/^\/(c|r)(\/|$)/, "case_detail"],
  [/^\/verdicts$/, "verdicts"],
  [/^\/v\//, "verdict"],
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
  const known = status === "ready" || status === "error";
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    if (known) setAnalytics(on);
  }, [known, on]);

  useEffect(() => {
    if (signedIn) signInCompleted();
  }, [signedIn]);

  useEffect(() => {
    if (!known || !isTracking()) return;
    // One flag per tab session, not an identifier.
    try {
      if (sessionStorage.getItem("app_open")) return;
      sessionStorage.setItem("app_open", "1");
    } catch {
      return;
    }
    track("app_open");
  }, [known]);

  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    const screen = SCREENS.find(([re]) => re.test(pathname))?.[1];
    if (screen) track("screen_view", { screen });
  }, [pathname]);

  return null;
}
