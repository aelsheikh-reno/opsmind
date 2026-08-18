// The enforcement layer. Copied verbatim into the project by scaffold-project.
// These three blocks are what make the architecture real rather than advisory.
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // generated/** holds the Prisma client built from the legacy schema by
  // prisma/generate-legacy-client.mjs — generator output, never authored and
  // never committed, alongside .next/** and build/**.
  //
  // Flat config does NOT read .gitignore, so every ignore has to be stated here
  // or it does not exist. .claude/worktrees/** is the case that proved it: an
  // agent worktree is a full second checkout, reference/legacy and all, and
  // eslint walked into one and reported 935 errors against the OUTER repository
  // — files no PR had touched, in a tree that is not the subject of the run.
  // Adding it to .gitignore fixed the diff and left the lint gate reading two
  // checkouts as one, so it is stated here too and is in templates/ as well.
  //
  // coverage/** is the same hole one path over: `vitest run --coverage` rewrites
  // that HTML report on every gate run, and eslint was reporting a warning from
  // istanbul's block-navigation.js. In templates/ too — every project regrows it.
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "generated/**",
    "next-env.d.ts",
    "reference/**",
    ".claude/worktrees/**",
  ]),

  // 1 · modules are reached through their index; the database through repositories
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          {
            group: ["@/lib/modules/*/!(index)", "@/lib/modules/*/*/**"],
            message: "Import a module through its index.ts. Deep imports break the boundary."
          },
          {
            group: ["@/lib/db", "@prisma/client"],
            message: "Only a module's repository.ts may touch the database."
          }
        ]
      }]
    }
  },

  // 2 · repositories, lib/db.ts and prisma tooling are the one exception.
  // lib/db.ts constructs the single client those repositories import, so one
  // pool exists instead of one per module (data-ownership.md).
  {
    files: ["lib/db.ts", "lib/modules/*/repository.ts", "lib/kernel/*/repository.ts", "prisma/**"],
    rules: { "no-restricted-imports": "off" }
  },

  // 3 · pages and routes hold no domain logic — they call the API layer
  {
    files: ["app/**/*.tsx"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["@/lib/modules/**", "@/lib/adapters/**"],
          message: "Pages call the API, never a module directly. The previous build broke exactly this."
        }]
      }]
    }
  },
]);
