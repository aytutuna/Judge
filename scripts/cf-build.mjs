// Builds the Workers bundle. proxy.ts is a Node middleware that OpenNext
// bundles with a second copy of Next (10 MB); on Workers cloudflare/worker.ts
// does its job, so the file is set aside for the build and put back however
// the build ends.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, renameSync } from "node:fs";

const PROXY = "proxy.ts";
const ASIDE = "proxy.ts.off";

function restore() {
  if (existsSync(ASIDE) && !existsSync(PROXY)) renameSync(ASIDE, PROXY);
}

// A leftover from an interrupted run comes back first.
restore();
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    restore();
    process.exit(1);
  });
}
process.on("exit", restore);

renameSync(PROXY, ASIDE);
const status =
  spawnSync("npx", ["opennextjs-cloudflare", "build"], {
    stdio: "inherit",
    shell: true,
    env: { ...process.env, JUDGE_WORKERS_BUILD: "1" },
  }).status ?? 1;
restore();

// Link-preview cards read their fonts and mark from the static assets on Workers.
if (status === 0) cpSync("assets", ".open-next/assets/_og", { recursive: true });
process.exit(status);
