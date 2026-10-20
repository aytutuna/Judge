import Link from "next/link";
import { t, type Lang } from "@/lib/i18n";
import account from "./account/AccountPages.module.css";

/** What a removed verdict's link shows: a title, one line and (unless the
 * page has its own, `cta={false}`) a way home. `headingId` makes the heading
 * focusable from script (tabIndex -1), for a removal that just happened.
 * Server-renderable (no hooks). */
export function RemovedVerdict({
  lang,
  headingLevel = 2,
  headingId,
  cta = true,
}: {
  lang: Lang;
  headingLevel?: 1 | 2;
  headingId?: string;
  cta?: boolean;
}) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  return (
    <section className={`${account.card} flex flex-col items-start gap-3`} role="status">
      <Heading id={headingId} tabIndex={headingId ? -1 : undefined} className={account.sectionTitle}>
        {t(lang, "removed.title")}
      </Heading>
      <p className={account.muted}>{t(lang, "removed.body")}</p>
      {cta ? (
        <Link href="/" className={`${account.btn} ${account.primary}`}>
          {t(lang, "shared.cta")}
        </Link>
      ) : null}
    </section>
  );
}
