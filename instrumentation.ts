/**
 * Runs once when a server instance starts. Async verdicts left judging by a
 * previous process (killed or restarted mid-run) are failed and refunded
 * here once they pass the 10-minute mark, then every few minutes.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { startVerdictJobSweeper } = await import("./lib/verdict-jobs");
    startVerdictJobSweeper();
  }
}
