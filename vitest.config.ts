import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { coverageConfigDefaults, defineConfig } from "vitest/config";

// The repository root, without a trailing slash, so that "@/lib/x" resolves to
// "<root>/lib/x" — identical to the "@/*" path alias in tsconfig.json.
const rootDir = fileURLToPath(new URL(".", import.meta.url)).replace(/\/$/, "");
const legacyRoot = `${rootDir}/reference/legacy`;

// The oracle must never resolve into the code it is judging.
//
// Legacy modules carry their own "@/..." imports (reference/legacy/lib/fx.ts
// opens with `import { prisma } from "@/lib/prisma"`), and the alias below
// points "@" at the NEW repo root. Without this plugin a legacy module loaded
// through the differential harness binds to new-build code, and the differential
// test then compares the candidate against itself — a green gate that proves
// nothing, which is precisely the failure PIPELINE.md says the harness exists to
// prevent. Only importers inside reference/legacy/ are rewritten; everything in
// the new build keeps "@" = repo root.
//
// An import from legacy with no counterpart in the legacy tree throws rather
// than falling through to the alias — falling through is how the contamination
// would come back silently.
//
// Measured, not assumed: vite:alias runs BEFORE user `enforce: "pre"` plugins,
// so this hook usually sees "@/lib/prisma" already rewritten to
// "<rootDir>/lib/prisma". Both forms are handled, so the guard holds whichever
// side of the alias it is called on. node_modules is left alone: third-party
// packages are shared by both sides and are not the code under test.
function legacyCounterpart(source: string): string | null {
  if (source.startsWith("@/")) return `${legacyRoot}/${source.slice(2)}`;
  if (!source.startsWith(`${rootDir}/`)) return null;
  const rest = source.slice(rootDir.length + 1);
  if (rest.startsWith("reference/") || rest.startsWith("node_modules/")) return null;
  return `${legacyRoot}/${rest}`;
}

function legacySelfAlias(): Plugin {
  return {
    name: "opsmind:legacy-self-alias",
    enforce: "pre",
    async resolveId(source, importer) {
      if (importer === undefined || !importer.startsWith(`${legacyRoot}/`)) return null;
      const target = legacyCounterpart(source);
      if (target === null) return null;
      const resolved = await this.resolve(target, importer, { skipSelf: true });
      if (resolved === null) {
        throw new Error(
          `${importer} imports "${source}", which has no counterpart at ${target}. ` +
            "Refusing to resolve a legacy import against the new build — that would " +
            "make the differential oracle compare the candidate against itself.",
        );
      }
      return resolved;
    },
  };
}

export default defineConfig({
  plugins: [legacySelfAlias()],
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
      // The differential harness lives under tests/ because it is test
      // infrastructure, but it is implementation — the highest-value
      // implementation in the repository, and the oracle every money task is
      // judged against. Left out of coverage.include it would never be
      // measured, so the gate would keep reporting a vacuous 0/0 even once
      // lib/ fills up. Its own *.test.ts files are excluded below: test code
      // grading itself is not a coverage signal.
      include: ["lib/**/*.ts", "tests/differential/**/*.ts"],
      // coverage.include is matched with picomatch `contains: true`, so
      // "lib/**/*.ts" also matches reference/legacy/lib/*.ts — the harness loads
      // those on purpose and they were dragging the measured percentage down.
      // Legacy code is a read-only oracle, not code this build is judged on.
      // vitest 4's coverageConfigDefaults.exclude is empty and coverage.exclude
      // replaces rather than merges, so it is spread here to stay correct if a
      // future version ships defaults.
      exclude: [
        ...coverageConfigDefaults.exclude,
        "**/reference/**",
        "**/node_modules/**",
        "**/.next/**",
        "**/coverage/**",
        // vitest already appends test.include to coverage.exclude internally,
        // but that is an implementation detail of the version in the lockfile.
        // State it here so the guarantee survives a vitest upgrade.
        "**/*.{test,spec}.{ts,tsx}",
      ],
    },
  },
});
