// The enforcement layer. Copied verbatim into the project by scaffold-project.
// These three blocks are what make the architecture real rather than advisory.
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // Flat config does NOT read .gitignore, so every ignore has to be stated here
  // or it does not exist. That is why .claude/worktrees/** is in this list even
  // though git already ignores it: an agent worktree is a full second checkout,
  // reference/legacy and all, and eslint walked into one and reported 935 errors
  // against the OUTER repository — files no PR had touched, in a tree that is
  // not the subject of the run. Ignoring it in git fixed the diff and left the
  // lint gate reading two checkouts as one.
  //
  // It belongs in the template rather than only in the project because every
  // project this scaffolds is built by the same agent harness and grows the same
  // directory on its first parallel task. reference/** is here for the same
  // shape of reason: a second tree of code the project does not own.
  //
  // coverage/** is the same argument and one step stronger: the cov-report gate
  // has every scaffolded project write coverage/lcov.info on each run, so
  // istanbul's own report JavaScript is regenerated in-tree before eslint walks.
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
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
          // A capability service is reached exactly as a module is. ADR-021's
          // claim is that the seam is the same call whether the capability is a
          // folder or a container, and the risk it names to police is interface
          // bypass inside the monolith — a seam anyone can reach around is not
          // a seam, so it is refused here before there is a service to argue
          // about.
          {
            group: ["@/lib/services/*/!(index)", "@/lib/services/*/*/**"],
            message: "Import a service through its index.ts. Deep imports break the boundary."
          },
          {
            group: ["@/lib/db", "@prisma/client"],
            message: "Only a repository.ts may touch the database."
          }
        ]
      }]
    }
  },

  // 2 · repositories, lib/db.ts and prisma tooling are the one exception.
  // lib/db.ts constructs the single client those repositories import, so one
  // pool exists instead of one per module (data-ownership.md).
  //
  // A capability service's repository is named here for the same reason a
  // module's is: ADR-039 makes its reuse target an importable package on the
  // host's storage, so exclusive table ownership — not the network — is the
  // whole of its boundary. Exempting it is only half the change: what makes the
  // exemption safe is that scripts/check-boundaries.sh now reads the '// owns:'
  // declaration of these three globs, not two. Widen one without the other and
  // the file may import the client and is checked by nothing.
  {
    files: ["lib/db.ts", "lib/modules/*/repository.ts", "lib/kernel/*/repository.ts", "lib/services/*/repository.ts", "prisma/**"],
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
