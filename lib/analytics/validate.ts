/**
 * What an event may carry. Names are snake_case; props are a flat object of
 * short strings, numbers and booleans. Keys that would invite user text
 * (text, body, content, message, email, name, also as a part of a snake_case
 * key such as user_email) are refused, and so are strings that look like an
 * email address, so nothing anyone wrote or is called can be stored.
 */

import { z } from "zod";

export const MAX_BATCH = 50;
export const MAX_PROPS_BYTES = 2048;
const MAX_PROP_STRING = 100;

/** Sent by the server only (lib/analytics/track.ts); refused from clients so
 * the funnel counts cannot be inflated from outside. */
export const SERVER_EVENTS = [
  "case_created",
  "verdict_ready",
  "verdict_failed",
  "case_claimed",
  "purchase_granted",
  "sign_in",
] as const;
export type ServerEvent = (typeof SERVER_EVENTS)[number];

const FORBIDDEN_KEY_PARTS = new Set(["text", "body", "content", "message", "email", "name"]);
const EVENT_NAME = /^[a-z][a-z0-9_]{0,63}$/;
const PROP_KEY = /^[a-z][a-z0-9_]{0,39}$/;
const EMAIL_LIKE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const VERSION = /^[0-9A-Za-z.+_-]{1,32}$/;
const DEVICE_ID = /^[0-9A-Za-z_-]{8,64}$/;
const DEVICE_MODEL = /^[0-9A-Za-z ,.()_+-]{1,64}$/;
const LOCALE = /^[A-Za-z]{2,3}([_-][0-9A-Za-z]{2,8}){0,3}$/;

export const PLATFORMS = ["ios", "android", "web"] as const;
export type ClientPlatform = (typeof PLATFORMS)[number];

export const isDeviceId = (id: string) => DEVICE_ID.test(id);
export const isClientPlatform = (p: string): p is ClientPlatform => (PLATFORMS as readonly string[]).includes(p);

export type Props = Record<string, string | number | boolean>;

/** Why these props cannot be stored, or null when they can. */
export function propsProblem(props: Props): string | null {
  for (const [key, value] of Object.entries(props)) {
    if (!PROP_KEY.test(key)) return `bad key ${JSON.stringify(key.slice(0, 40))}`;
    if (key.split("_").some((part) => FORBIDDEN_KEY_PARTS.has(part))) return `key "${key}" is not allowed`;
    if (typeof value === "string" && (value.length > MAX_PROP_STRING || EMAIL_LIKE.test(value))) {
      return `value of "${key}" is not allowed`;
    }
  }
  if (Buffer.byteLength(JSON.stringify(props)) > MAX_PROPS_BYTES) return "props too large";
  return null;
}

const PropsSchema = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
  .superRefine((props, ctx) => {
    const problem = propsProblem(props);
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  });

const ClientEvent = z.strictObject({
  name: z
    .string()
    .regex(EVENT_NAME)
    .refine((n) => !(SERVER_EVENTS as readonly string[]).includes(n), "reserved for the server"),
  at: z.number().int().nullish(),
  props: PropsSchema.nullish(),
});

const ClientContext = z.strictObject({
  platform: z.enum(PLATFORMS),
  app_version: z.string().regex(VERSION),
  anon_id: z.uuid().nullish(),
  device_id: z.string().regex(DEVICE_ID).nullish(),
  os_version: z.string().regex(VERSION).nullish(),
  device_model: z.string().regex(DEVICE_MODEL).nullish(),
  locale: z.string().regex(LOCALE).nullish(),
});

export const EventBatch = z.strictObject({
  context: ClientContext,
  events: z.array(ClientEvent).min(1).max(MAX_BATCH),
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
