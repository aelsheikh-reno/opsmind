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
//
// The generated database client is the one exception, and it is not
// third-party. It is generated FROM the schema under test, so the shared
// package name resolves to the new build's tables. Legacy oracles were written
// against the legacy tables — reference/legacy/lib/fx.ts reads `prisma.setting`
// and `prisma.payrollRun`, neither of which exists on the new client. Sharing it
// meant the oracle either threw at call time or answered about the wrong
// database, which is the same contamination this plugin exists to stop, arriving
// through node_modules instead of through "@/".
//
// It stayed invisible while the new schema had no models: with nothing to
// generate, `prisma generate` was skipped and the import failed outright, so the
// harness's own guard test passed for the wrong reason. kernel-schema-base added
// the first models and the guard fired.
//
// So legacy importers resolve the client to a second one generated from the
// legacy schema by prisma/generate-legacy-client.mjs. Same package name, decided
// by who is asking. A missing legacy client throws rather than falling back to
// the shared one — falling back is exactly how the contamination returns, and it
// would return silently.
function legacyCounterpart(source: string): string | null {
  if (source.startsWith("@/")) return `${legacyRoot}/${source.slice(2)}`;
  if (!source.startsWith(`${rootDir}/`)) return null;
  const rest = source.slice(rootDir.length + 1);
  if (rest.startsWith("reference/") || rest.startsWith("node_modules/")) return null;
  return `${legacyRoot}/${rest}`;
}

// The client generated from the LEGACY schema by prisma/generate-legacy-client.mjs.
const legacyPrismaClient = `${rootDir}/generated/legacy-prisma-client`;

// Both spellings a generated client is reached by. The inner ".prisma/client" is
// what the public package re-exports; a legacy module landing on it directly must
// not slip through to the shared copy either.
const clientPackages = new Set(["@prisma/client", ".prisma/client"]);

function legacySelfAlias(): Plugin {
  return {
    name: "opsmind:legacy-self-alias",
    enforce: "pre",
    async resolveId(source, importer) {
      if (importer === undefined || !importer.startsWith(`${legacyRoot}/`)) return null;

      if (clientPackages.has(source)) {
        const resolved = await this.resolve(legacyPrismaClient, importer, { skipSelf: true });
        if (resolved === null) {
          throw new Error(
            `${importer} imports "${source}", but the legacy client is not generated at ` +
              `${legacyPrismaClient}. Run \`node prisma/generate-legacy-client.mjs\`. ` +
              "Refusing to fall back to this build's client — the legacy oracle would then " +
              "answer about the new schema's tables instead of its own.",
          );
        }
        return resolved;
      }

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
    // A timeout is for a hang, never for contention (ADR-033). tests/integration
    // boots six in-process engines, under which a unit test costing 2.6-3.4 s
    // reached 7.3 s and overran the 5 s default; 60 s is ~8x that (ADR-038).
    testTimeout: 60_000,

    // BOUNDED SO THE SUITE FITS A DEVELOPER MACHINE, not only a CI runner
    // (ADR-033). The binding resource is not CPU. Seven integration files each
    // boot an in-process PostgreSQL and shell out to `prisma migrate deploy`,
    // so an unbounded pool — one fork per core, fourteen on the machine this
    // was measured on — put fourteen forks, seven database engines and seven
    // migrate subprocesses on it at once.
    //
    // Measured 2026-08-18 on an idle 14-core WSL2 box: peak load average 36,
    // with a file still timing out; started from an already-busy machine the
    // full gate produced NO VERDICT AT ALL, timing out after ten minutes at
    // load 151. Two consecutive unbounded runs of the same commit disagreed
    // about whether a file passed, which is the defect, not the duration.
    //
    // The number bounds CONCURRENT ENGINES, which is why it is small and flat
    // rather than derived from the core count: a 64-core machine does not make
    // seven simultaneous migrations cheaper, and a verdict that depends on how
    // busy the machine happened to be is not a verdict (ADR-031).
    //
    // It changes no assertion. The same files run, in the same isolation, and
    // report the same results — fewer of them at a time.
    maxWorkers: 4,
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
