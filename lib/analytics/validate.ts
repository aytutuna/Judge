/**
 * What an event may carry. Names come from fixed lists; props are a flat
 * object holding only the keys listed for that event (EVENT_PROPS), each a
 * short token without spaces, a bounded integer or a boolean. Nothing anyone
 * wrote or is called fits in that. Keys that would invite user text (text,
 * body, content, message, email, name, also inside a snake_case key) are
 * refused as well, in case one is ever added to the lists.
 */

import { z } from "zod";

export const MAX_BATCH = 50;
export const MAX_PROPS_BYTES = 512;
const MAX_PROP_NUMBER = 1_000_000;

/** What the apps and the website send (documented in ./track.ts). */
export const CLIENT_EVENTS = [
  "app_open",
  "screen_view",
  "case_started",
  "case_submitted",
  "evidence_added",
  "question_answered",
  "verdict_viewed",
  "share_tapped",
  "buy_tapped",
  "purchase_completed",
  "sign_in_started",
  "sign_in_completed",
  "settings_changed",
  "error_shown",
] as const;
export type ClientEvent = (typeof CLIENT_EVENTS)[number];

/** Recorded by the server only (./track.ts). */
export const SERVER_EVENTS = [
  "case_created",
  "verdict_ready",
  "verdict_failed",
  "case_claimed",
  "purchase_granted",
  "sign_in",
] as const;
export type ServerEvent = (typeof SERVER_EVENTS)[number];

/** The prop keys each event may carry; an event not listed carries none. */
const EVENT_PROPS: Partial<Record<ClientEvent | ServerEvent, readonly string[]>> = {
  screen_view: ["screen"],
  buy_tapped: ["product"],
  sign_in_started: ["provider"],
  settings_changed: ["key"],
  error_shown: ["code"],
  case_created: ["mode"],
  verdict_ready: ["kind", "mode"],
  verdict_failed: ["kind", "mode", "code"],
  purchase_granted: ["product", "source"],
};

const FORBIDDEN_KEY_PARTS = new Set(["text", "body", "content", "message", "email", "name"]);
const TOKEN = /^[A-Za-z0-9_.:/-]{1,64}$/;
const VERSION = /^[0-9A-Za-z.+_-]{1,32}$/;
const DEVICE_ID = /^[0-9A-Za-z_-]{8,64}$/;
const LOCALE = /^[A-Za-z]{2,3}([_-][0-9A-Za-z]{2,8}){0,3}$/;

export const PLATFORMS = ["ios", "android", "web"] as const;
export type ClientPlatform = (typeof PLATFORMS)[number];

export const isDeviceId = (id: string) => DEVICE_ID.test(id);
export const isClientPlatform = (p: string): p is ClientPlatform => (PLATFORMS as readonly string[]).includes(p);

export type Props = Record<string, string | number | boolean>;

/** Why `name` cannot be stored with these props, or null when it can. */
export function propsProblem(name: ClientEvent | ServerEvent, props: Props): string | null {
  const allowed = EVENT_PROPS[name] ?? [];
  for (const [key, value] of Object.entries(props)) {
    if (!allowed.includes(key)) return `${name} takes no "${key.slice(0, 40)}"`;
    if (key.split("_").some((part) => FORBIDDEN_KEY_PARTS.has(part))) return `key "${key}" is not allowed`;
    const ok =
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isInteger(value) && Math.abs(value) <= MAX_PROP_NUMBER) ||
      (typeof value === "string" && TOKEN.test(value));
    if (!ok) return `value of "${key}" is not allowed`;
  }
  if (Buffer.byteLength(JSON.stringify(props)) > MAX_PROPS_BYTES) return "props too large";
  return null;
}

const ClientEventSchema = z
  .strictObject({
    name: z.enum(CLIENT_EVENTS),
    at: z.number().int().nullish(),
    props: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).nullish(),
  })
  .superRefine((e, ctx) => {
    const problem = e.props ? propsProblem(e.name, e.props) : null;
    if (problem) ctx.addIssue({ code: "custom", path: ["props"], message: problem });
  });

const ClientContext = z.strictObject({
  platform: z.enum(PLATFORMS),
  app_version: z.string().regex(VERSION),
  anon_id: z.uuid().nullish(),
  device_id: z.string().regex(DEVICE_ID).nullish(),
  os_version: z.string().regex(VERSION).nullish(),
  device_model: z.string().regex(TOKEN).nullish(),
  locale: z.string().regex(LOCALE).nullish(),
});

export const EventBatch = z.strictObject({
  context: ClientContext,
  events: z.array(ClientEventSchema).min(1).max(MAX_BATCH),
});
export type EventBatch = z.infer<typeof EventBatch>;

/** The visitor's country from Cloudflare (CF-IPCountry), only while the site
 * is behind its proxy (CLOUDFLARE_PROXY=1); else null. XX and T1 (unknown,
 * Tor) are null too. */
export function countryOf(headers: Headers, env: Record<string, string | undefined> = process.env): string | null {
  if (env.CLOUDFLARE_PROXY?.trim() !== "1") return null;
  const code = headers.get("cf-ipcountry")?.trim().toUpperCase() ?? "";
  return /^[A-Z]{2}$/.test(code) && code !== "XX" ? code : null;
}
