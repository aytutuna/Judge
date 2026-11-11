"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { CASE_POLL_MS, type CaseLiveSide, type LiveCasesResponse } from "@/lib/case-types";
import { refreshHistory } from "./useHistory";

/** Who has opened, is typing in and has answered each of the account's
 * waiting cases, refreshed every few seconds while `on` (the menu is open and
 * some link still waits). The list is refetched when a case drops out of it
 * or gains an answer, since its row's state changed. */
export function useLive(on: boolean): Map<string, CaseLiveSide[]> {
  const [live, setLive] = useState<Map<string, CaseLiveSide[]>>(new Map());
  const last = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!on) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (document.visibilityState === "visible") {
        try {
          const res = await apiFetch("/api/v1/cases/live", { cache: "no-store" });
          const json = (await res.json().catch(() => null)) as LiveCasesResponse | null;
          if (!stopped && res.ok && json) {
            const answered = new Map(json.cases.map((c) => [c.id, c.sides.filter((s) => s.state === "answered").length]));
            const changed =
              [...last.current].some(([id, n]) => !answered.has(id) || (answered.get(id) ?? 0) > n) && last.current.size > 0;
            last.current = answered;
            setLive(new Map(json.cases.map((c) => [c.id, c.sides])));
            if (changed) void refreshHistory();
          }
        } catch {
          // Offline: the next tick tries again.
        }
      }
      if (!stopped) timer = setTimeout(tick, CASE_POLL_MS);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [on]);

  return on ? live : new Map();
}
