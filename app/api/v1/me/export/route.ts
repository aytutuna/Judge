import { exportGetHandler } from "@/lib/account-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/me/export: everything Judge holds about the signed-in person, as a JSON download. */
export const GET = exportGetHandler;
