/* Applies pending schema migrations to the configured database.
   Run: npm run db:migrate
   Uses TURSO_DATABASE_URL / TURSO_AUTH_TOKEN when set, otherwise DATABASE_URL
   (default file:./dev.db). Values from .env.local and .env are loaded like
   Next.js does; variables already in the environment win. */
import { existsSync } from "node:fs";
import { createClient } from "@libsql/client";
import { dbConfig } from "../lib/db";
import { LATEST_VERSION, migrate } from "../lib/migrations";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

async function main() {
  const config = dbConfig();
  const target = config.url.startsWith("file:") ? config.url : new URL(config.url).host;
  const client = createClient(config);
  try {
    const ran = await migrate(client);
    console.log(
      ran.length
        ? `${target}: applied migration(s) ${ran.join(", ")}; schema at version ${LATEST_VERSION}`
        : `${target}: schema already at version ${LATEST_VERSION}`,
    );
  } finally {
    client.close();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
