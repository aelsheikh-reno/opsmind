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
  globalIgnores([".next/**", "out/**", "build/**", "generated/**", "next-env.d.ts", "reference/**"]),

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

  // 2 · repositories and prisma tooling are the one exception
  {
    files: ["lib/modules/*/repository.ts", "lib/kernel/*/repository.ts", "prisma/**"],
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
  }
]);
