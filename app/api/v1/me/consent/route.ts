import { consentGetHandler, consentPostHandler } from "@/lib/feedback/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/me/consent: the account's current training choice. */
export const GET = consentGetHandler;

/** POST /api/v1/me/consent: record a choice from the card or the switch. */
export const POST = consentPostHandler;
