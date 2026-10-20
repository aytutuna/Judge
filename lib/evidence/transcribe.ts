/**
 * One vision call per image: transcribe visible text verbatim (chat messages
 * with the speaker label shown and timestamps), describe non-text content
 * neutrally, never identify real people. The image is passed in memory only.
 */

import { claudeJson, type ClaudeImage } from "@/lib/claude";
import type { EvidenceKind } from "@/lib/types";
import { isUnreadable, RawTranscript, renderTranscript } from "./render";

/** Vision model; the live probe measured ~3.6 s and ~$0.0003 per screenshot. */
export function evidenceModel(env: Record<string, string | undefined> = process.env): string {
  return env.EVIDENCE_MODEL?.trim() || "claude-haiku-5-5";
}

export const TRANSCRIBE_TIMEOUT_MS = 45_000;

export const TRANSCRIBE_SYSTEM = `You transcribe one screenshot or photo submitted as evidence in a two-person dispute.
- Copy every visible message or line of text exactly as written, in its original language. Do not translate, summarize, fix spelling or add anything.
- For chat screenshots, give one entry per message in screen order. "side" is "sent" for messages sent from this phone (usually right-aligned or colored bubbles), "received" for the other bubbles, "unknown" if you cannot tell. "speaker" is the name shown on screen for that message (the chat title or a sender label in group chats); use "" when no name is shown. "time" is the timestamp shown next to it, else null.
- Put any other visible text (headers, documents, receipts, notes) in "other_text", verbatim.
- "description": at most two sentences describing non-text content neutrally (what kind of screen or object it is). Never identify, name or guess who a real person in a photo is; describe people only generically ("a person").
- If nothing is legible, set kind to "unreadable" and leave messages empty.`;

export const TRANSCRIBE_USER = "Transcribe this evidence image.";

/** Compact schema (lib/claude.ts toClaudeSchema), same as the live probe. */
export const TRANSCRIBE_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["chat", "document", "photo", "other", "unreadable"] },
    chat_title: { type: "string", nullable: true },
    messages: {
      type: "array",
      items: {
        type: "object",
        properties: {
          side: { type: "string", enum: ["sent", "received", "unknown"] },
          speaker: { type: "string" },
          time: { type: "string", nullable: true },
          text: { type: "string" },
        },
        required: ["side", "speaker", "time", "text"],
      },
    },
    other_text: { type: "string" },
    description: { type: "string" },
  },
  required: ["kind", "chat_title", "messages", "other_text", "description"],
} as const;

export type TranscribeResult =
  | { status: "ok"; kind: EvidenceKind; transcript: string }
  | { status: "unreadable" | "refused" | "failed" };

/** Never throws: errors, timeouts and odd output come back as "failed", a
 * model refusal as "refused". Logs counts only, never content. */
export async function transcribeImage(image: ClaudeImage): Promise<TranscribeResult> {
  let res;
  try {
    res = await claudeJson<unknown>({
      system: TRANSCRIBE_SYSTEM,
      user: TRANSCRIBE_USER,
      images: [image],
      schema: TRANSCRIBE_SCHEMA as unknown as Record<string, unknown>,
      effort: "low",
      model: evidenceModel(),
      timeoutMs: TRANSCRIBE_TIMEOUT_MS,
    });
  } catch (e) {
    console.error("[evidence] transcription threw:", e instanceof Error ? e.message.slice(0, 200) : String(e));
    return { status: "failed" };
  }
  if (!res.ok) {
    if (res.blocked) {
      console.warn(`[evidence] transcription refused (${res.reason})`);
      return { status: "refused" };
    }
    console.error("[evidence] transcription failed:", res.error.slice(0, 200));
    return { status: "failed" };
  }
  const parsed = RawTranscript.safeParse(res.data);
  if (!parsed.success) {
    console.error("[evidence] transcription schema mismatch");
    return { status: "failed" };
  }
  if (isUnreadable(parsed.data)) return { status: "unreadable" };
  const kind = parsed.data.kind as EvidenceKind;
  return { status: "ok", kind, transcript: renderTranscript(parsed.data) };
}
