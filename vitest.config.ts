import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The repository root, without a trailing slash, so that "@/lib/x" resolves to
// "<root>/lib/x" — identical to the "@/*" path alias in tsconfig.json.
const rootDir = fileURLToPath(new URL(".", import.meta.url)).replace(/\/$/, "");

export default defineConfig({
  resolve: {
    alias: {
      "@": rootDir,
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules/**", "reference/**", ".next/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage",
      include: ["lib/**/*.ts"],
    },
  },
});
