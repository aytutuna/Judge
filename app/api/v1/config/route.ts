import { NextResponse } from "next/server";
import type { AppConfig } from "@/lib/account-types";
import { authProviders, premiumEnabled } from "@/lib/auth";
import { casesEnabled, evidenceEnabled, purchasesEnabled } from "@/lib/features";
import { PRICING } from "@/lib/pricing";

export const runtime = "nodejs";
// Per request: `signIn.dev` depends on the request's host.
export const dynamic = "force-dynamic";

/** GET /api/v1/config: one startup call for the website and the app. */
export function GET(req: Request): NextResponse<AppConfig> {
  const body: AppConfig = {
    signIn: authProviders(req),
    premiumEnabled: premiumEnabled(),
    pricing: {
      ...PRICING,
      purchasesEnabled: purchasesEnabled(),
      packs: PRICING.packs.map((p) => ({ ...p })),
      monthly: { ...PRICING.monthly },
    },
    features: { cases: casesEnabled(), evidence: evidenceEnabled() },
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
