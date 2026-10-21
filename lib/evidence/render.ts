/**
 * The transcription model's structured output, and its rendering into the
 * plain text that goes into evidence tokens, previews, the anonymizer and
 * (after anonymization) the database. Pure.
 */

import { z } from "zod";
import type { EvidenceKind } from "@/lib/types";

export const RawTranscript = z.object({
  kind: z.enum(["chat", "document", "photo", "other", "unreadable"]),
  chat_title: z.string().nullable(),
  messages: z.array(
    z.object({
      side: z.enum(["sent", "received", "unknown"]),
      speaker: z.string(),
      time: z.string().nullable(),
      text: z.string(),
    }),
  ),
  other_text: z.string(),
  description: z.string(),
});
export type RawTranscript = z.infer<typeof RawTranscript>;

export const MAX_MESSAGES = 120;
export const MAX_MESSAGE_CHARS = 1000;
export const MAX_TRANSCRIPT_CHARS = 4000;
export const MORE_NOT_SHOWN = "[... more not shown]";

/** Stored, English headings (stored data; judges localize in prose). */
export const KIND_HEADING: Record<EvidenceKind, string> = {
  chat: "Chat screenshot",
  document: "Document",
  photo: "Photo",
  other: "Image",
};

/** Speaker for messages sent from the uploader's phone. Replaced with the
 * narrator's label during anonymization. */
export const SELF_SPEAKER = "ME";

/** Control characters out, line breaks normalized, ends trimmed. */
function clean(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f\u2028\u2029]/g, " ")
    .trim();
}

/** One line: inner line breaks become " / ", spaces collapse. */
function oneLine(s: string): string {
  return clean(s).replace(/\s*\n\s*/g, " / ").replace(/[ \t]+/g, " ");
}

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** Whether the model read nothing usable (no messages, text or description). */
export function isUnreadable(raw: RawTranscript): boolean {
  if (raw.kind === "unreadable") return true;
  const hasMessage = raw.messages.some((m) => clean(m.text) !== "");
  return !hasMessage && clean(raw.other_text) === "" && clean(raw.description) === "";
}

function speakerOf(m: RawTranscript["messages"][number], title: string): string {
  const named = oneLine(m.speaker);
  if (named) return clip(named, 80);
  if (m.side === "sent") return SELF_SPEAKER;
  if (m.side === "received") return title || "OTHER";
  return "UNKNOWN";
}

/**
 * The transcript as text (section 7.5 of the design):
 *
 *   [Chat screenshot · "Deniz"]
 *   21:02 ME: Did you pay the electricity bill?
 *   21:05 Deniz: No, it was your turn this month
 *   Other text: ...
 *   Description: ...
 *
 * Caps: 120 messages, 1000 characters per message, 4000 characters in all
 * (then "[... more not shown]"). The kind must not be "unreadable".
 */
export function renderTranscript(raw: RawTranscript): string {
  const kind: EvidenceKind = raw.kind === "unreadable" ? "other" : raw.kind;
  // No double quotes inside the title: the heading line quotes it.
  const title = clip(oneLine(raw.chat_title ?? "").replace(/"/g, "'"), 80);
  const lines = [title ? `[${KIND_HEADING[kind]} · "${title}"]` : `[${KIND_HEADING[kind]}]`];
  const messages = raw.messages.filter((m) => clean(m.text) !== "");
  for (const m of messages.slice(0, MAX_MESSAGES)) {
    const time = clip(oneLine(m.time ?? ""), 24);
    lines.push(`${time ? `${time} ` : ""}${speakerOf(m, title)}: ${clip(oneLine(m.text), MAX_MESSAGE_CHARS)}`);
  }
  const other = clean(raw.other_text);
  if (other) lines.push(`Other text: ${other}`);
  const description = oneLine(raw.description);
  if (description) lines.push(`Description: ${clip(description, 500)}`);
  const truncated = messages.length > MAX_MESSAGES;

  let out = lines.join("\n");
  if (out.length > MAX_TRANSCRIPT_CHARS || truncated) {
    const room = MAX_TRANSCRIPT_CHARS - MORE_NOT_SHOWN.length - 1;
    if (out.length > room) out = out.slice(0, room).replace(/\n[^\n]*$/, "") || out.slice(0, room);
    out = `${out}\n${MORE_NOT_SHOWN}`;
  }
  return out;
}

/** The heading line of a rendered transcript: `[Chat screenshot · "Deniz"]`. */
export const HEADING_LINE = /^\[(Chat screenshot|Document|Photo|Image)(?: · "([^"\n]*)")?\]$/;
