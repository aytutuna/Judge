import { afterAll, describe, expect, it } from "vitest";
import type { WorkerEnv } from "../cloudflare/env";
import { fakeD1 } from "./helpers/fake-d1";

// Lists of ids go through a fake D1 that refuses more than 100 bound
// parameters, as the real one does; every list here is longer than that.
const { setWorkerEnv } = await import("../lib/worker-env");
setWorkerEnv({ DB: await fakeD1({ schema: true }) } as unknown as WorkerEnv);
const { getDb } = await import("../lib/db");
const { blankRoundsStatement, eraseVerdictStatements } = await import("../lib/erasure");
const { ratingsFor } = await import("../lib/feedback/db");

afterAll(() => setWorkerEnv(undefined as unknown as WorkerEnv));

const IDS = Array.from({ length: 150 }, (_, i) => `v${String(i).padStart(3, "0")}`);
const RESULT = JSON.stringify({ headline: "text to erase" });

describe("long lists of ids on D1", () => {
  it("erases 150 verdicts and their rounds in one batch", async () => {
    const db = await getDb();
    await db.batch(
      IDS.flatMap((id) => [
        { sql: "INSERT INTO verdicts (id, input, framework, result) VALUES (?, 'words', '{}', ?)", args: [id, RESULT] },
        { sql: "INSERT INTO verdict_translations (id, lang, result_json) VALUES (?, 'tr', ?)", args: [id, RESULT] },
        {
          sql: "INSERT INTO verdict_appeals (id, verdict_id, text, evidence, base_id, created_at, updated_at) VALUES (?, ?, 'more words', '[1]', 'b', 't', 't')",
          args: [`r-${id}`, id],
        },
      ]),
      "write",
    );
    const now = new Date().toISOString();
    await db.batch([...(await eraseVerdictStatements(IDS, now)), blankRoundsStatement(IDS, now)], "write");
    const left = await db.execute("SELECT COUNT(*) AS n FROM verdicts WHERE input <> '' OR erased_at IS NULL");
    expect(Number(left.rows[0].n)).toBe(0);
    const rounds = await db.execute("SELECT COUNT(*) AS n FROM verdict_appeals WHERE text <> ''");
    expect(Number(rounds.rows[0].n)).toBe(0);
  });

  it("reads one account's ratings for 150 verdicts", async () => {
    const db = await getDb();
    await db.batch(
      IDS.map((id) => ({
        sql: "INSERT INTO verdict_ratings (verdict_id, user_id, rating, created_at, updated_at) VALUES (?, 'u1', 'up', 't', 't')",
        args: [id],
      })),
      "write",
    );
    expect(Object.keys(await ratingsFor("u1", IDS))).toHaveLength(150);
  });
});
