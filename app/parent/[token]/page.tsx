import type { Metadata } from "next";
import { headers } from "next/headers";
import { ParentLinkScreen } from "@/components/ParentLinkScreen";
import { loadLocale, t } from "@/lib/i18n";
import { acceptLanguageTags, matchLang } from "@/lib/langs";

/** The page behind a parent's link. The token in the URL is the only key,
 * so the page is never indexed and sends no Referer anywhere. */
export async function generateMetadata(): Promise<Metadata> {
  const lang = matchLang(acceptLanguageTags((await headers()).get("accept-language") ?? ""));
  await loadLocale(lang);
  return { title: t(lang, "parent.pageTitle"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

export default async function ParentPage({ params, searchParams }: PageProps<"/parent/[token]">) {
  const { token } = await params;
  const query = await searchParams;
  return <ParentLinkScreen token={token} declineFirst={query.decline === "1"} />;
}
