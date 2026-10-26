import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirror the tsconfig "@/*" path so route code imports resolve in tests.
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    // Only this repo's tests: not dependency tests or local tool worktrees,
    // which hold stale copies of test/.
    include: ["test/**/*.test.{ts,tsx}"],
    exclude: [...configDefaults.exclude, "node_modules/**", ".paperclip/**"],
  },
});
