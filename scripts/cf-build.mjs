// Builds the Workers bundle. proxy.ts is a Node middleware that OpenNext
// bundles with a second copy of Next (10 MB); on Workers cloudflare/worker.ts
// does its job, so the file is set aside for the build.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, renameSync } from "node:fs";

const PROXY = "proxy.ts";
const ASIDE = "proxy.ts.off";

if (existsSync(ASIDE)) renameSync(ASIDE, PROXY);
renameSync(PROXY, ASIDE);
let status = 1;
try {
  status = spawnSync("npx", ["opennextjs-cloudflare", "build"], { stdio: "inherit", shell: true, env: { ...process.env, JUDGE_WORKERS_BUILD: "1" } }).status ?? 1;
} finally {
  renameSync(ASIDE, PROXY);
}
// Link-preview cards read their fonts and mark from the static assets on Workers.
if (status === 0) cpSync("assets", ".open-next/assets/_og", { recursive: true });
process.exit(status);
