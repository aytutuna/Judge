import Link from "next/link";
import type { Entitlement } from "@/lib/account-types";
import { saveDraftForSignIn } from "@/lib/draft";
import { t, type Lang } from "@/lib/i18n";

/** What the signed-in writer has left, under the submit button. */
export function Balance({ lang, entitlement: e }: { lang: Lang; entitlement: Entitlement }) {
  const sub = e.subscription;
  if (sub && sub.used < sub.cap) return t(lang, "home.monthLeft", { n: sub.cap - sub.used, cap: sub.cap });
  if (e.credits > 0) return t(lang, e.credits === 1 ? "home.left.one" : "home.left.other", { n: e.credits });
  return (
    <>
      {t(lang, "home.out")}{" "}
      <Link href="/pricing" onClick={saveDraftForSignIn}>
        {t(lang, "home.pricing")}
      </Link>
    </>
  );
}
