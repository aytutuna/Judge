"use client";

import type { ReactNode } from "react";
import { registerLocale, type Dict, type Lang } from "@/lib/i18n";

/** For a page the server renders in a language other than English: hands
 * its strings to the browser before anything below renders, so hydration
 * reads the same text the server wrote instead of English. */
export function LocaleStrings({ lang, dict, children }: { lang: Lang; dict: Dict | null; children: ReactNode }) {
  if (dict) registerLocale(lang, dict);
  return children;
}
