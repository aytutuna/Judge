import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getVerdict } from "@/lib/db";
import { VerdictView } from "@/components/VerdictView";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: PageProps<"/v/[id]">): Promise<Metadata> {
  const { id } = await params;
  const stored = getVerdict(id);
  if (!stored) return { title: "Verdict" };
  return {
    title: `Verdict: ${stored.result.headline}`,
    description: stored.result.crux,
  };
}

export default async function SharedVerdictPage({ params }: PageProps<"/v/[id]">) {
  const { id } = await params;
  const stored = getVerdict(id);
  if (!stored) notFound();

  return (
    <main className="flex-1 w-full max-w-md mx-auto px-4 py-8 flex flex-col gap-6">
      <header className="text-center">
        <Link href="/" className="inline-block">
          <h1 className="text-2xl font-black tracking-tight" style={{ color: "var(--ink)" }}>
            ⚖️ Verdict
          </h1>
        </Link>
        <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
          A shared ruling · parties anonymized
        </p>
      </header>

      <VerdictView result={stored.result} />

      <Link
        href="/"
        className="rounded-full px-5 py-3 text-sm font-semibold self-center text-center"
        style={{ background: "var(--ink)", color: "var(--plane)" }}
      >
        Settle your own argument →
      </Link>
    </main>
  );
}
