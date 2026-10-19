/**
 * Sign-in emails (magic links) through Resend's HTTP API, with plain fetch.
 * Configured by RESEND_API_KEY and EMAIL_FROM; without both, email sign-in is
 * reported unavailable. Never logs addresses or links.
 */

import type { Lang } from "./i18n";
import { PALETTE as P } from "./palette";

const RESEND_URL = "https://api.resend.com/emails";
const SEND_TIMEOUT_MS = 10_000;

export function emailConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.RESEND_API_KEY?.trim() && env.EMAIL_FROM?.trim());
}

/** Email copy per language. Turkish speaks to the reader as "sen". */
export const SIGNIN_EMAIL: Record<
  Lang,
  { subject: string; intro: string; button: string; expiry: string; ignore: string }
> = {
  en: {
    subject: "Your Verdict sign-in link",
    intro: "Tap the button below to sign in to Verdict.",
    button: "Sign in to Verdict",
    expiry: "The link works once and expires in 10 minutes.",
    ignore: "If you didn't ask for this, you can ignore this email.",
  },
  tr: {
    subject: "Verdict giriş bağlantın",
    intro: "Verdict'e giriş yapmak için aşağıdaki düğmeye dokun.",
    button: "Verdict'e giriş yap",
    expiry: "Bağlantı tek kullanımlık ve 10 dakika geçerli.",
    ignore: "Bu isteği sen yapmadıysan bu e-postayı yok sayabilirsin.",
  },
};

/** The email language: the `lang` query param of the magic link's
 * callbackURL (the website sends `/account?lang=tr`), default English. */
export function langFromMagicLink(url: string): Lang {
  try {
    const callback = new URL(url).searchParams.get("callbackURL");
    if (!callback) return "en";
    const lang = new URL(callback, "http://localhost").searchParams.get("lang");
    return lang === "tr" ? "tr" : "en";
  } catch {
    return "en";
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function signInEmailContent(url: string, lang: Lang): { subject: string; text: string; html: string } {
  const c = SIGNIN_EMAIL[lang];
  const text = `${c.intro}\n\n${url}\n\n${c.expiry}\n${c.ignore}\n`;
  // Ivory & Terracotta, inline styles only (email clients drop <style>).
  const html = `<!doctype html><html lang="${lang}"><body style="margin:0;padding:32px 16px;background:${P.ivory};font-family:Georgia,'Times New Roman',serif;color:${P.ink}">
<div style="max-width:480px;margin:0 auto;background:${P.paper};border:1px solid ${P.strata};border-radius:12px;padding:32px">
<p style="font-size:22px;margin:0 0 16px">Verdict</p>
<p style="font-size:16px;line-height:1.5;margin:0 0 24px">${escapeHtml(c.intro)}</p>
<p style="margin:0 0 24px"><a href="${escapeHtml(url)}" style="display:inline-block;background:${P.terraInk};color:${P.paper};text-decoration:none;padding:12px 20px;border-radius:8px;font-family:Arial,sans-serif;font-size:15px">${escapeHtml(c.button)}</a></p>
<p style="font-size:13px;line-height:1.5;color:${P.muted};margin:0">${escapeHtml(c.expiry)}<br>${escapeHtml(c.ignore)}</p>
</div></body></html>`;
  return { subject: c.subject, text, html };
}

/** Sends the sign-in link. Throws on failure (Better Auth then answers the
 * request with an error); the message never contains the address or link. */
export async function sendSignInEmail({ to, url, lang }: { to: string; url: string; lang: Lang }): Promise<void> {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  if (!key || !from) throw new Error("email sign-in is not configured");
  const { subject, text, html } = signInEmailContent(url, lang);
  let res: Response;
  try {
    res = await fetch(RESEND_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, text, html }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch (e) {
    throw new Error(`sign-in email request failed: ${e instanceof Error ? e.name : "error"}`);
  }
  if (!res.ok) throw new Error(`sign-in email rejected: HTTP ${res.status}`);
}
