import { agreementPostHandler } from "@/lib/feedback/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/me/agreement: the one-time private-details agreement. */
export const POST = agreementPostHandler;
