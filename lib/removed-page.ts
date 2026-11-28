import type { NextRequest } from "next/server";
import { loadLocale, t } from "@/lib/i18n";
import { acceptLanguageTags, langDir, matchLang } from "@/lib/langs";

const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch] ?? ch);

/** In the visitor's language, picked the way the share page picks it. */
export async function removedHtml(req: Pick<NextRequest, "headers">, state: "removed" | "unavailable" = "removed"): Promise<Response> {
  const lang = matchLang(acceptLanguageTags(req.headers.get("accept-language") ?? ""));
  await loadLocale(lang);
  const c = {
    title: escapeHtml(t(lang, `${state}.title`)),
    body: escapeHtml(t(lang, `${state}.body`)),
    cta: escapeHtml(t(lang, `${state}.cta`)),
  };
  const html = `<!doctype html>
<html lang="${lang}" dir="${langDir(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${c.title} · Judge</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f6f1e7; color: #1f1b16;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 440px; padding: 32px 24px; text-align: center; }
  h1 { font-size: 28px; line-height: 1.15; margin: 0 0 12px; letter-spacing: -0.02em; }
  p { margin: 0 0 24px; color: #5b5248; font-size: 17px; }
  a { display: inline-block; padding: 14px 24px; border-radius: 999px; background: #1f1b16; color: #f6f1e7;
    text-decoration: none; font-weight: 600; }
  a:focus-visible { outline: 3px solid #c8553d; outline-offset: 3px; }
</style>
</head>
<body>
<main>
<h1>${c.title}</h1>
<p>${c.body}</p>
<a href="/">${c.cta}</a>
</main>
</body>
</html>`;
  return new Response(html, {
    status: state === "removed" ? 410 : 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
