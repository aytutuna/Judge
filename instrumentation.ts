/**
 * Runs once when a server instance starts. Async verdicts left judging by a
 * previous process (killed or restarted mid-run) are failed and refunded
 * here once they pass the 10-minute mark, then every few minutes. Usage
 * events past their retention are deleted now and once a day.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    // systemd sets JOURNAL_STREAM when stderr goes to the journal.
    if (process.env.JOURNAL_STREAM) {
      const { tagJournalLevels } = await import("./lib/journal");
      tagJournalLevels();
    }
    const { startVerdictJobSweeper } = await import("./lib/verdict-jobs");
    startVerdictJobSweeper();
    const { startEventPruner } = await import("./lib/analytics/db");
    startEventPruner();
  }
}
