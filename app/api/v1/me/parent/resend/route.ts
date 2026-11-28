import { parentPost } from "@/lib/parent-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = (req: Request) => parentPost(req, "resend");
