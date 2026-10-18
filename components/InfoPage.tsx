"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { t, type Key, type Lang } from "@/lib/i18n";
import { useLang } from "@/lib/lang";
import { HOW_STEPS } from "./HomeSections";
import { SiteFooter, SiteHeader, SkipLink } from "./SiteChrome";

/** Prose pages (/about, /privacy). Client-rendered chrome so the TR|EN
 * toggle works the same as on the homepage. */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-bold tracking-tight" style={{ color: "var(--ink)" }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function P({ children }: { children: ReactNode }) {
  return (
    <p className="text-[15px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
      {children}
    </p>
  );
}

function About({ lang }: { lang: Lang }) {
  const limits: Key[] = ["about.limit1", "about.limit2", "about.limit3", "about.limit4"];
  return (
    <>
      <Section title={t(lang, "about.methodTitle")}>
        <ol className="flex flex-col gap-2">
          {HOW_STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-3">
              <span
                aria-hidden
                className="mt-0.5 flex shrink-0 items-center justify-center rounded-full text-xs font-bold"
                style={{ width: 22, height: 22, background: "var(--ink)", color: "var(--plane)" }}
              >
                {i + 1}
              </span>
              <span className="text-[15px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
                <strong style={{ color: "var(--ink)" }}>{t(lang, s.title)}.</strong>{" "}
                {t(lang, s.body)}
              </span>
            </li>
          ))}
        </ol>
      </Section>
      <Section title={t(lang, "about.honestTitle")}>
        <P>{t(lang, "about.honest")}</P>
      </Section>
      <Section title={t(lang, "about.limitsTitle")}>
        <ul className="flex flex-col gap-1.5 list-disc pl-5">
          {limits.map((k) => (
            <li key={k} className="text-[15px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
              {t(lang, k)}
            </li>
          ))}
        </ul>
      </Section>
      <Section title={t(lang, "about.builtTitle")}>
        <P>{t(lang, "about.built")}</P>
      </Section>
    </>
  );
}

function Privacy({ lang, contactEmail }: { lang: Lang; contactEmail: string | null }) {
  const sections: [Key, Key][] = [
    ["privacy.storedTitle", "privacy.stored"],
    ["privacy.notStoredTitle", "privacy.notStored"],
    ["privacy.ipTitle", "privacy.ip"],
    ["privacy.processorsTitle", "privacy.processors"],
    ["privacy.shareTitle", "privacy.share"],
  ];
  // Split around the {email} slot so the address can be a real link while
  // the sentence stays one whole dictionary string.
  const [before, after = ""] = t(lang, "privacy.contact").split("{email}");
  return (
    <>
      {sections.map(([title, body]) => (
        <Section key={title} title={t(lang, title)}>
          <P>{t(lang, body)}</P>
        </Section>
      ))}
      {contactEmail ? (
        <Section title={t(lang, "privacy.contactTitle")}>
          <P>
            {before}
            <a
              href={`mailto:${contactEmail}`}
              className="underline underline-offset-2 rounded-sm"
              style={{ color: "var(--ink)" }}
            >
              {contactEmail}
            </a>
            {after}
          </P>
        </Section>
      ) : null}
    </>
  );
}

/** `contactEmail` is null when no real address is configured; the privacy
 * page then omits its contact section. */
export function InfoPage({
  page,
  contactEmail = null,
}: {
  page: "about" | "privacy";
  contactEmail?: string | null;
}) {
  const lang = useLang();
  return (
    // One lang scope for skip link, header, main and footer, so screen
    // readers voice all of the chrome in the page language.
    <div lang={lang} className="contents">
      <SkipLink lang={lang} />
      <SiteHeader lang={lang} toggle />
      <main
        id="main"
        tabIndex={-1}
        className="flex-1 w-full max-w-2xl mx-auto px-4 pt-10 sm:pt-16 flex flex-col gap-8 outline-none"
      >
        <div className="flex flex-col gap-3">
          <h1 className="text-4xl font-black tracking-tight" style={{ color: "var(--ink)" }}>
            {t(lang, page === "about" ? "about.title" : "privacy.title")}
          </h1>
          <p className="text-lg leading-relaxed" style={{ color: "var(--ink-2)" }}>
            {t(lang, page === "about" ? "about.lead" : "privacy.lead")}
          </p>
        </div>
        {page === "about" ? <About lang={lang} /> : <Privacy lang={lang} contactEmail={contactEmail} />}
        <Link
          href="/"
          className="self-start rounded-full px-6 py-3.5 text-base font-bold"
          style={{ background: "var(--ink)", color: "var(--plane)" }}
        >
          {t(lang, "shared.cta")}
        </Link>
      </main>
      <SiteFooter lang={lang} toggle />
    </div>
  );
}
