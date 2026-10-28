/**
 * Sign-in emails (magic links and one-time codes) and "your case is ready"
 * notices through Resend's HTTP API, with plain fetch. Configured by
 * RESEND_API_KEY and EMAIL_FROM; without both, email sign-in is reported
 * unavailable and no notice is sent. Never logs addresses, links, codes or
 * case text.
 */

import { emailCopy, loadLocales, type EmailCopy, type Lang } from "./i18n";
import { isLang } from "./langs";
import { PALETTE as P } from "./palette";

const RESEND_URL = "https://api.resend.com/emails";
const SEND_TIMEOUT_MS = 10_000;

type EmailContent = { subject: string; text: string; html: string };

export function emailConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.RESEND_API_KEY?.trim() && env.EMAIL_FROM?.trim());
}

/** English email copy; other languages carry theirs in lib/locales. */
export const EMAIL_EN: EmailCopy = {
  signIn: {
    subject: "Your Judge sign-in link",
    intro: "Tap the button below to sign in to Judge.",
    button: "Sign in to Judge",
    expiry: "The link works once and expires in 10 minutes.",
    ignore: "If you didn't ask for this, you can ignore this email.",
  },
  signInCode: {
    subject: "Your Judge sign-in code",
    intro: "Enter this code in the Judge app to sign in:",
    expiry: "The code works once and expires in 10 minutes.",
    ignore: "If you didn't ask for this, you can ignore this email.",
  },
  caseReady: {
    subject: "They answered: your Judge verdict is ready",
    intro: "The other person told their side, and the judges have ruled on both accounts.",
    button: "See the verdict",
    note: "You're getting this because you started this case on Judge.",
  },
};

/** The copy for `lang` once its locale is loaded, else English. */
function copy(lang: Lang): EmailCopy {
  return emailCopy(lang) ?? EMAIL_EN;
}

/** The email language: the `lang` query param of the magic link's
 * callbackURL (the website sends `/account?lang=tr`), default English. */
export function langFromMagicLink(url: string): Lang {
  try {
    const callback = new URL(url).searchParams.get("callbackURL");
    if (!callback) return "en";
    const lang = new URL(callback, "http://localhost").searchParams.get("lang");
    return isLang(lang) ? lang : "en";
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

export function signInEmailContent(url: string, lang: Lang): EmailContent {
  const c = copy(lang).signIn;
  const text = `${c.intro}\n\n${url}\n\n${c.expiry}\n${c.ignore}\n`;
  // Ivory & Terracotta, inline styles only (email clients drop <style>).
  const html = `<!doctype html><html lang="${lang}"><body style="margin:0;padding:32px 16px;background:${P.ivory};font-family:Georgia,'Times New Roman',serif;color:${P.ink}">
<div style="max-width:480px;margin:0 auto;background:${P.paper};border:1px solid ${P.strata};border-radius:12px;padding:32px">
<p style="font-size:22px;margin:0 0 16px">Judge</p>
<p style="font-size:16px;line-height:1.5;margin:0 0 24px">${escapeHtml(c.intro)}</p>
<p style="margin:0 0 24px"><a href="${escapeHtml(url)}" style="display:inline-block;background:${P.terraInk};color:${P.paper};text-decoration:none;padding:12px 20px;border-radius:8px;font-family:Arial,sans-serif;font-size:15px">${escapeHtml(c.button)}</a></p>
<p style="font-size:13px;line-height:1.5;color:${P.muted};margin:0">${escapeHtml(c.expiry)}<br>${escapeHtml(c.ignore)}</p>
</div></body></html>`;
  return { subject: c.subject, text, html };
}

/** Posts one email to Resend. Throws on failure with `label` and the HTTP
 * status only: never the address, link, code or text. */
async function deliver(to: string, content: EmailContent, label: string, unconfigured: string): Promise<void> {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  if (!key || !from) throw new Error(unconfigured);
  let res: Response;
  try {
    res = await fetch(RESEND_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [to], ...content }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch (e) {
    throw new Error(`${label} request failed: ${e instanceof Error ? e.name : "error"}`);
  }
  if (!res.ok) throw new Error(`${label} rejected: HTTP ${res.status}`);
}

/** Sends the sign-in link. Throws on failure (Better Auth then answers the
 * request with an error); the message never contains the address or link. */
export async function sendSignInEmail({ to, url, lang }: { to: string; url: string; lang: Lang }): Promise<void> {
  await loadLocales();
  await deliver(to, signInEmailContent(url, lang), "sign-in email", "email sign-in is not configured");
}

/** The code email's language: `lang=tr` in the request URL's query (the apps
 * call `/api/auth/email-otp/send-verification-otp?lang=tr`), default English. */
export function langFromRequestUrl(url: string | undefined): Lang {
  if (!url) return "en";
  try {
    const lang = new URL(url, "http://localhost").searchParams.get("lang");
    return isLang(lang) ? lang : "en";
  } catch {
    return "en";
  }
}

export function signInCodeEmailContent(code: string, lang: Lang): EmailContent {
  const c = copy(lang).signInCode;
  const text = `${c.intro}

${code}

${c.expiry}
${c.ignore}
`;
  const html = `<!doctype html><html lang="${lang}"><body style="margin:0;padding:32px 16px;background:${P.ivory};font-family:Georgia,'Times New Roman',serif;color:${P.ink}">
<div style="max-width:480px;margin:0 auto;background:${P.paper};border:1px solid ${P.strata};border-radius:12px;padding:32px">
<p style="font-size:22px;margin:0 0 16px">Judge</p>
<p style="font-size:16px;line-height:1.5;margin:0 0 16px">${escapeHtml(c.intro)}</p>
<p style="font-family:'Courier New',monospace;font-size:32px;letter-spacing:8px;font-weight:bold;color:${P.terraInk};margin:0 0 24px">${escapeHtml(code)}</p>
<p style="font-size:13px;line-height:1.5;color:${P.muted};margin:0">${escapeHtml(c.expiry)}<br>${escapeHtml(c.ignore)}</p>
</div></body></html>`;
  return { subject: c.subject, text, html };
}

/** Sends a sign-in code. Throws on failure; the message never contains the
 * address or code. */
export async function sendSignInCodeEmail({ to, code, lang }: { to: string; code: string; lang: Lang }): Promise<void> {
  await loadLocales();
  await deliver(to, signInCodeEmailContent(code, lang), "sign-in code email", "email sign-in is not configured");
}

export function caseReadyEmailContent(url: string, lang: Lang): EmailContent {
  const c = copy(lang).caseReady;
  const text = `${c.intro}\n\n${url}\n\n${c.note}\n`;
  const html = `<!doctype html><html lang="${lang}"><body style="margin:0;padding:32px 16px;background:${P.ivory};font-family:Georgia,'Times New Roman',serif;color:${P.ink}">
<div style="max-width:480px;margin:0 auto;background:${P.paper};border:1px solid ${P.strata};border-radius:12px;padding:32px">
<p style="font-size:22px;margin:0 0 16px">Judge</p>
<p style="font-size:16px;line-height:1.5;margin:0 0 24px">${escapeHtml(c.intro)}</p>
<p style="margin:0 0 24px"><a href="${escapeHtml(url)}" style="display:inline-block;background:${P.terraInk};color:${P.paper};text-decoration:none;padding:12px 20px;border-radius:8px;font-family:Arial,sans-serif;font-size:15px">${escapeHtml(c.button)}</a></p>
<p style="font-size:13px;line-height:1.5;color:${P.muted};margin:0">${escapeHtml(c.note)}</p>
</div></body></html>`;
  return { subject: c.subject, text, html };
}

/** Sends the "your case is ready" notice. Throws on failure; the message
 * never contains the address or link. */
export async function sendCaseReadyEmail({ to, url, lang }: { to: string; url: string; lang: Lang }): Promise<void> {
  await loadLocales();
  await deliver(to, caseReadyEmailContent(url, lang), "case email", "email is not configured");
}
