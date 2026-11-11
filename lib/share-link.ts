import { track } from "@/lib/analytics/client";
import { t, type Lang } from "@/lib/i18n";

/** Opens the system share sheet with the case's link and a one-line message;
 * without one (or when the browser refuses it, as after a slow request), the
 * link is copied instead. Returns "copied" when the caller should say so. */
export async function shareLink(lang: Lang, url: string): Promise<"shared" | "copied" | "cancelled"> {
  track("share_tapped");
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ text: t(lang, "case.invite.shareText"), url });
      return "shared";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
    }
  }
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    window.prompt(t(lang, "copyPrompt"), url);
    return "cancelled";
  }
  return "copied";
}
