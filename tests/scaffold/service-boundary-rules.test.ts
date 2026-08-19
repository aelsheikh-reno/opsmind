// Assertions (backlog node `gate-service-boundary-rules`):
//
//   1. lib/services/<service>/repository.ts is the one file in that service
//      permitted to reach the database, and every other file in it is refused
//   2. A service repository with no '// owns:' declaration fails the boundary
//      check, in the same words a module repository does
//   3. A service repository touching a table it does not declare is reported by
//      name
//   4. An import of lib/services/<service>/ past its index.ts fails, as it
//      already does for a module
//   5. eslint.config.mjs and templates/eslint.config.mjs still carry identical
//      boundary blocks
//   6. No module or kernel repository changes verdict
//
// A SECOND SET OF ASSERTIONS FOLLOWS AT THE FOOT OF THIS FILE, for backlog node
// `gate-boundaries-blind-to-a-transaction`. Same subject — check-boundaries.sh
// reading a repository's declaration — and the same fixture machinery, so it
// lives here rather than in a file that would have to copy all of it. That block
// carries its own header, and says which of its cases are discriminators and
// which are regression guards.
//
// WHY THIS FILE IS SEPARATE FROM eslint-boundaries.test.ts.
//
// That file has one subject — eslint.config.mjs still says what
// templates/eslint.config.mjs says — and one method: load both as modules and
// compare the resolved rule objects. This file has two subjects, because the
// enforcement layer is two tools. Half of what follows drives
// scripts/check-boundaries.sh, which is not an eslint question and does not
// belong in a file named for eslint. The pattern is borrowed rather than the
// code: a throwaway directory, real tooling run against it, and a `finally` that
// clears up on the failure path as well as the success path.
//
// THE TRAP THIS FILE EXISTS TO CATCH, WHICH IS THE POINT OF IT.
//
// Nothing under lib/services/ has ever existed, so neither tool has been asked
// about it, and today they answer wrongly in opposite directions at once:
//
//   - eslint block 2 exempts lib/db.ts, lib/modules/*/repository.ts,
//     lib/kernel/*/repository.ts and prisma/** — so the FIRST service repository
//     is refused the database it is the designated importer of.
//   - check-boundaries.sh reads '// owns:' only for modules and kernel, and its
//     "nothing outside a repository may reach the database" grep drops every
//     path ending repository.ts by name.
//
// So the obvious fix — widen the eslint exemption — is on its own STRICTLY WORSE
// than the bug it removes. It produces a file that may import the client and is
// checked by nothing at all, and it does that silently, where the present state
// at least fails loudly. A suite that only asked "can a service repository
// import the client?" would certify that half-done state as correct.
//
// Every case below is therefore paired. The eslint half says the repository is
// permitted; the check-boundaries half says it is then held to the same
// declaration, the same undeclared-table report and the same refusal of
// obfuscated access that a module repository has always been held to. Widening
// eslint without extending check-boundaries.sh leaves this file red.
//
// AND NO SERVICE IS CREATED TO TEST IT WITH. lib/services/ stays empty — this
// node builds enforcement, not a service — so every case runs the real eslint
// config and the real shell script against a fixture tree in a temporary
// directory, and reads the verdict back.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PROJECT_CONFIG = path.join(repoRoot, "eslint.config.mjs");
const TEMPLATE_CONFIG = path.join(repoRoot, "templates", "eslint.config.mjs");
const BOUNDARY_SCRIPT = path.join(repoRoot, "scripts", "check-boundaries.sh");

const BOUNDARY_RULE = "no-restricted-imports";
const FINDING_PREFIX = "BOUNDARY: ";

// The budget is eslint-boundaries.test.ts's, for its reason and on its
// measurement — the first ESLint instance in a worker evaluates
// eslint-config-next and the whole typescript-eslint graph, about 1.2 s on an
// idle machine, and every later instance in the same worker costs tens of
// milliseconds because Node has the graph cached. A timeout here is for an
// import that is stuck, never for a machine that is busy (ADR-033). Do not lower
// it toward the observed cost; that is the defect that file records fixing.
const LINT_BUDGET_MS = 120_000;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type Fixture = Record<string, string>;

/**
 * Writes `files` into a fresh temporary directory, runs `work` against it and
 * removes the directory again.
 *
 * The directory is created by mkdtemp OUTSIDE the repository, and that is a
 * deliberate difference from the coverage probe in eslint-boundaries.test.ts.
 * That probe has to write inside the repository, because the ignore it tests is
 * a repository-relative path, and it consequently carries bookkeeping to avoid
 * deleting a `coverage/` parent it did not create — a defect found and fixed in
 * that file one node ago. Nothing here needs to be inside the tree: eslint
 * resolves a flat config's `files` globs against its `cwd`, and
 * check-boundaries.sh addresses `lib`, `app` and `prisma` relatively, so both
 * tools can be pointed at a sandbox instead. mkdtemp owns its root exclusively,
 * so removing it can never take something that was already there, and no empty
 * parent survives it.
 *
 * The removal is in `finally`, which is the path that matters: a case tidying up
 * only when it passes leaves its litter exactly when somebody is already
 * debugging.
 */
async function inSandbox<T>(files: Fixture, work: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opsmind-service-boundary-"));
  try {
    for (const [relative, source] of Object.entries(files)) {
      const target = path.join(dir, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, source);
    }
    return await work(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** A file whose only content is one import — the smallest thing a rule can judge. */
function importsFrom(specifier: string): string {
  return `import { thing } from "${specifier}";\nexport const used = thing;\n`;
}

/**
 * A repository as data-ownership.md describes one: a `// owns:` declaration, the
 * shared client imported from lib/db.ts rather than constructed, and queries.
 *
 * One builder serves the module fixtures and the service fixtures both, so the
 * two differ only in their path and their table names. That is what lets the
 * "same words" comparisons below derive the expected sentence from the module
 * finding by substitution instead of restating it — a restated message is a
 * message somebody can soften and then quietly update the test to match.
 */
function repositorySource(
  owns: string | null,
  tables: readonly string[],
  trailer: string = "",
): string {
  return (
    (owns === null ? "" : `// owns: ${owns}\n`) +
    'import { db } from "@/lib/db";\n' +
    tables.map((table, index) => `export const query${index} = db.${table}.findMany;\n`).join("") +
    trailer
  );
}

// Casting the client past its type, so a query no static reader can see reaches
// a table the declaration does not name. Identical in every fixture that uses
// it, so it lands on the same line number in the module file and the service
// file and the two findings differ only in their path.
const OBFUSCATED_ACCESS = "export const escaped = (db as any).undeclared;\n";

/** A schema with nothing in it for the gate's other checks to find. */
const CLEAN_SCHEMA = "model Alert {\n  id String @id\n}\n";

// ---------------------------------------------------------------------------
// The two tools, run for real
// ---------------------------------------------------------------------------

interface BoundaryVerdict {
  status: number;
  findings: string[];
  output: string;
}

/** scripts/check-boundaries.sh, run with the sandbox as its working directory. */
function runBoundaryCheck(dir: string): BoundaryVerdict {
  const run = spawnSync("bash", [BOUNDARY_SCRIPT], { cwd: dir, encoding: "utf8" });
  const stdout = run.stdout ?? "";
  return {
    status: run.status ?? -1,
    findings: stdout
      .split("\n")
      .filter((line) => line.startsWith(FINDING_PREFIX))
      .map((line) => line.slice(FINDING_PREFIX.length)),
    output: `${stdout}${run.stderr ?? ""}`,
  };
}

type LintVerdict = Record<string, string[]>;

/**
 * Every boundary-rule message the given eslint config produces for the sandbox,
 * keyed by path relative to it.
 *
 * Filtered to `no-restricted-imports` on purpose. The subject is the boundary
 * layer, and a fixture that happens to trip an unused-variable or explicit-any
 * rule would otherwise turn the incidental style of a two-line file into a red
 * gate about something else entirely.
 */
async function lintSandbox(dir: string, configFile: string): Promise<LintVerdict> {
  const eslint = new ESLint({
    cwd: dir,
    overrideConfigFile: configFile,
    errorOnUnmatchedPattern: false,
  });
  const verdicts: LintVerdict = {};
  for (const result of await eslint.lintFiles(["lib"])) {
    verdicts[path.relative(dir, result.filePath)] = result.messages
      .filter((message) => message.ruleId === BOUNDARY_RULE)
      .map((message) => message.message);
  }
  return verdicts;
}

/**
 * "refused" or "allowed" for one fixture file, and a throw if eslint never
 * looked at it.
 *
 * The throw is the vacuity guard, and it is not hypothetical: a file eslint
 * matches no config entry against is reported as ignored and simply absent from
 * the results, which would read here as "no boundary message" — that is, as a
 * pass — for a fixture that was never linted at all.
 */
function verdictFor(verdicts: LintVerdict, file: string): "refused" | "allowed" {
  const messages = verdicts[file];
  if (messages === undefined) {
    throw new Error(
      `${file} does not appear in the lint results at all, so no verdict can be read from it. ` +
        "eslint omits a path it considers ignored, and an absent file would otherwise look " +
        "exactly like a permitted one.",
    );
  }
  return messages.length > 0 ? "refused" : "allowed";
}

// ---------------------------------------------------------------------------
// One fixture tree, four different questions asked of it
// ---------------------------------------------------------------------------

// Written once and shared, so that the new service rows and the untouched
// module and kernel rows are decided by the same run of the same config. A
// widened glob that reaches lib/modules/* while it reaches lib/services/* is the
// failure assertion 6 exists to catch, and it is caught here rather than in a
// separate run that could differ.
const ENFORCEMENT_MATRIX: Fixture = {
  // the single client every repository imports, and the one file outside a
  // repository permitted to name the client package (data-ownership.md)
  "lib/db.ts":
    'import { PrismaClient } from "@prisma/client";\nexport const db = new PrismaClient();\n',

  "lib/modules/payroll/repository.ts": importsFrom("@/lib/db"),
  "lib/modules/payroll/index.ts": importsFrom("@/lib/db"),
  "lib/modules/payroll/calculate.ts": importsFrom("@/lib/db"),
  "lib/modules/payroll/internal/repository.ts": importsFrom("@/lib/db"),
  "lib/kernel/person/repository.ts": importsFrom("@/lib/db"),
  "lib/kernel/person/index.ts": importsFrom("@/lib/db"),

  "lib/services/alerts/repository.ts": importsFrom("@/lib/db"),
  "lib/services/alerts/index.ts": importsFrom("@/lib/db"),
  "lib/services/alerts/engine.ts": importsFrom("@/lib/db"),
  "lib/services/alerts/internal/store.ts": importsFrom("@/lib/db"),
  "lib/services/alerts/internal/repository.ts": importsFrom("@/lib/db"),

  // the deep-import rule is global (`**/*.ts`), so where a consumer sits does
  // not matter; lib/ is where the real ones live
  "lib/consumers/module-surface.ts": importsFrom("@/lib/modules/payroll"),
  "lib/consumers/module-index.ts": importsFrom("@/lib/modules/payroll/index"),
  "lib/consumers/module-deep.ts": importsFrom("@/lib/modules/payroll/calculate"),
  "lib/consumers/module-deep-nested.ts": importsFrom("@/lib/modules/payroll/internal/calc"),
  "lib/consumers/service-surface.ts": importsFrom("@/lib/services/alerts"),
  "lib/consumers/service-index.ts": importsFrom("@/lib/services/alerts/index"),
  "lib/consumers/service-deep.ts": importsFrom("@/lib/services/alerts/engine"),
  "lib/consumers/service-deep-nested.ts": importsFrom("@/lib/services/alerts/internal/store"),
};

// ASSERTION 6, the regression half. Every one of these is the verdict the
// enforcement layer gives today, and none of them may move. A glob written as
// `lib/*/*/repository.ts` or `lib/**/repository.ts` to take services in also
// takes in lib/modules/payroll/internal/repository.ts; one written as
// `lib/services/**` would be the same mistake one directory over. Each row here
// is a way that could happen and not be noticed.
const MODULE_AND_KERNEL_VERDICTS: Record<string, "refused" | "allowed"> = {
  "lib/db.ts": "allowed",
  "lib/modules/payroll/repository.ts": "allowed",
  "lib/kernel/person/repository.ts": "allowed",
  "lib/modules/payroll/index.ts": "refused",
  "lib/modules/payroll/calculate.ts": "refused",
  "lib/modules/payroll/internal/repository.ts": "refused",
  "lib/kernel/person/index.ts": "refused",
  "lib/consumers/module-surface.ts": "allowed",
  "lib/consumers/module-index.ts": "allowed",
  "lib/consumers/module-deep-nested.ts": "refused",

  // MEASURED, NOT ASSUMED, AND IT IS NOT WHAT THE CONFIG LOOKS LIKE IT SAYS.
  //
  // `@/lib/modules/payroll/calculate` — a deep import ONE segment past the
  // module directory, the commonest shape there is — is not reported by eslint
  // today. `no-restricted-imports` matches a `group` with gitignore syntax, not
  // extglob, so `@/lib/modules/*/!(index)` is not "anything but index": it
  // matches nothing whatsoever, and the only pattern in block 1 that ever fires
  // is `@/lib/modules/*/*/**`, which needs two segments. Confirmed by running
  // the two patterns separately against the four specifier shapes.
  //
  // check-boundaries.sh does catch it, which is why rule 4 has held in practice
  // and why the hole has gone unnoticed — the boundaries gate goes red even
  // though the lint gate does not. It is recorded here rather than fixed
  // because assertion 6 forbids this node from changing a module verdict at all,
  // and turning this row red is exactly that. If a later change makes it
  // "refused", this case is the one that will say so, and that change wants its
  // own node and its own argument.
  "lib/consumers/module-deep.ts": "allowed",
};

// ASSERTION 1. One file in the service may reach the database and the rest may
// not — stated absolutely, because the module rows above show the enforcement
// layer already gets this exactly right for a module and there is nothing to
// inherit but the correct answer.
const SERVICE_VERDICTS: Record<string, "refused" | "allowed"> = {
  "lib/services/alerts/repository.ts": "allowed",
  "lib/services/alerts/index.ts": "refused",
  "lib/services/alerts/engine.ts": "refused",
  "lib/services/alerts/internal/store.ts": "refused",
  // a nested file merely NAMED repository.ts is not "the" repository — the
  // assertion says one file, and the identical module row above shows this is
  // already how a module behaves rather than a rule invented for services
  "lib/services/alerts/internal/repository.ts": "refused",
};

// ASSERTION 4, in eslint, and stated as PARITY rather than as a verdict — "as
// it already does for a module" is what the assertion says, and after the
// finding recorded above that is not the same thing as "refused". A specifier
// shape and its module twin must be answered identically, so a service is
// neither more nor less reachable around than a module is. The nested pair is
// what discriminates: `@/lib/modules/payroll/internal/calc` is refused today and
// `@/lib/services/alerts/internal/store` is not.
//
// It also means the eslint half of assertion 4 can be satisfied for the
// one-segment pair by a pattern that matches nothing, because the module twin
// matches nothing either. That case is not lost — check-boundaries.sh's
// deep-import grep does catch the one-segment shape, and the case below holds
// services to it.
const DEEP_IMPORT_PARITY: [service: string, moduleTwin: string][] = [
  ["lib/consumers/service-surface.ts", "lib/consumers/module-surface.ts"],
  ["lib/consumers/service-index.ts", "lib/consumers/module-index.ts"],
  ["lib/consumers/service-deep.ts", "lib/consumers/module-deep.ts"],
  ["lib/consumers/service-deep-nested.ts", "lib/consumers/module-deep-nested.ts"],
];

describe("eslint: a service repository reaches the database and nothing else in the service does", () => {
  it("permits lib/services/<service>/repository.ts and refuses every other file in it", async () => {
    // ASSERTION 1. Both directions in one run, which is what stops the case
    // being satisfied by an exemption that is simply too wide: if
    // `lib/services/**` were exempted, the repository row would pass and the
    // four rows under it would fail here.
    await inSandbox(ENFORCEMENT_MATRIX, async (dir) => {
      const verdicts = await lintSandbox(dir, PROJECT_CONFIG);
      for (const [file, expected] of Object.entries(SERVICE_VERDICTS)) {
        expect(
          verdictFor(verdicts, file),
          expected === "allowed"
            ? `eslint refuses ${file} the database client. A capability service brings its own ` +
                "tables and owns them exclusively (ADR-039), so its repository is the designated " +
                "importer of the client exactly as a module's is — and today the FIRST service " +
                "repository written fails lint for doing the one thing it exists to do."
            : `eslint permits ${file} to reach the database. Only the service's repository.ts ` +
                "may; an exemption wide enough to cover this one has removed the boundary from " +
                "the whole service rather than opened one door in it.",
        ).toBe(expected);
      }
    });
  }, LINT_BUDGET_MS);

  it("answers a deep import of a service exactly as it answers the same shape for a module", async () => {
    // ASSERTION 4, eslint half. Parity rather than an absolute verdict, for the
    // reason recorded at DEEP_IMPORT_PARITY: ADR-021's claim is that the seam is
    // the same call whether a capability is a folder or a container, and a seam
    // anyone can reach around is not a seam. So what has to hold is that the two
    // are treated alike — the service must not be the easier one to reach around.
    await inSandbox(ENFORCEMENT_MATRIX, async (dir) => {
      const verdicts = await lintSandbox(dir, PROJECT_CONFIG);
      for (const [service, moduleTwin] of DEEP_IMPORT_PARITY) {
        expect(
          verdictFor(verdicts, service),
          `eslint answers ${service} differently from ${moduleTwin}, which imports the same shape ` +
            "of path from a module. CLAUDE.md rule 4 makes index.ts the public surface of a " +
            "folder under lib/, and it is unenforced for services while the deep-import group " +
            "names @/lib/modules only.",
        ).toBe(verdictFor(verdicts, moduleTwin));
      }
    });
  }, LINT_BUDGET_MS);

  it("still gives every module and kernel path the verdict it gives today", async () => {
    // ASSERTION 6, in eslint. This case is not a discriminator and is not meant
    // to be one: it passes before the change and must pass after it. A widened
    // glob that also loosens lib/modules/* would satisfy every other assertion
    // in this file and be caught only here.
    await inSandbox(ENFORCEMENT_MATRIX, async (dir) => {
      const verdicts = await lintSandbox(dir, PROJECT_CONFIG);
      for (const [file, expected] of Object.entries(MODULE_AND_KERNEL_VERDICTS)) {
        expect(
          verdictFor(verdicts, file),
          `the boundary verdict for ${file} moved from ${expected}. Nothing about services may ` +
            "change what the enforcement layer says about a module or the kernel — a glob loose " +
            "enough to do that has bought the new rule by giving up the old one.",
        ).toBe(expected);
      }
    });
  }, LINT_BUDGET_MS);

  it("gives the same verdict from templates/eslint.config.mjs as from eslint.config.mjs", async () => {
    // ASSERTION 5, asked as behaviour rather than as text. eslint-boundaries.test.ts
    // already compares the two configs block by block, and that comparison walks
    // the TEMPLATE's blocks looking for a project match — so a boundary block
    // ADDED to eslint.config.mjs alone, which is precisely the shape of a
    // service exemption granted to this project and not to the scaffold, has
    // nothing on the template side to be compared against and passes. Comparing
    // the verdicts closes that: the project cannot enforce anything the template
    // does not, in either direction, whatever shape the config change took.
    await inSandbox(ENFORCEMENT_MATRIX, async (dir) => {
      const fromProject = await lintSandbox(dir, PROJECT_CONFIG);
      const fromTemplate = await lintSandbox(dir, TEMPLATE_CONFIG);
      expect(
        Object.keys(fromProject).length,
        "the sandbox produced no lint results at all, so comparing the two configs compares nothing",
      ).toBeGreaterThan(0);
      expect(
        fromTemplate,
        "eslint.config.mjs and templates/eslint.config.mjs disagree about the fixture tree. " +
          "templates/ is the source of truth copied verbatim into every scaffolded project, so a " +
          "boundary rule that exists in only one of them is a rule the next project will not have.",
      ).toEqual(fromProject);
    });
  }, LINT_BUDGET_MS);
});

describe("check-boundaries.sh: a service repository is a repository, and is checked as one", () => {
  it("names a service repository with no '// owns:' declaration, in the module's words", async () => {
    // ASSERTION 2, and the other half of the trap. eslint alone cannot get here:
    // once its exemption is widened, lib/services/alerts/repository.ts may
    // import the client, and the '// owns:' loop in check-boundaries.sh reads
    // only lib/modules/*/repository.ts and lib/kernel/*/repository.ts while the
    // "nothing outside a repository" grep drops every path ending
    // repository.ts by name. So the file is permitted by one tool and inspected
    // by neither. That is worse than the red lint it replaces, because it is
    // silent.
    //
    // The expected sentence is DERIVED from the module finding in the same run
    // rather than written out here. "In the same words" is then literally what
    // is checked, and a change to the wording moves both sides together instead
    // of leaving a copy of the old message in a test file.
    const fixture: Fixture = {
      "lib/modules/payroll/repository.ts": repositorySource(null, ["payrollRun"]),
      "lib/services/alerts/repository.ts": repositorySource(null, ["alert"]),
      "prisma/schema.prisma": CLEAN_SCHEMA,
    };
    await inSandbox(fixture, (dir) => {
      const { status, findings, output } = runBoundaryCheck(dir);
      const modulePath = "lib/modules/payroll/repository.ts";
      const servicePath = "lib/services/alerts/repository.ts";
      const moduleFinding = findings.find((finding) => finding.startsWith(modulePath));
      expect(
        moduleFinding,
        "the module control produced no finding, so this case proves nothing about services. " +
          `check-boundaries.sh said:\n${output}`,
      ).toBeDefined();
      expect(
        findings,
        `check-boundaries.sh does not report ${servicePath} for having no '// owns:' ` +
          "declaration, though it reports the byte-identical module repository beside it. A " +
          "capability service owns its tables exclusively (ADR-039) and the declaration is how " +
          "that ownership is stated and checked; a repository nothing reads the declaration of " +
          "is a repository nothing checks.",
      ).toContain((moduleFinding ?? "").replace(modulePath, servicePath));
      expect(status, "a missing '// owns:' declaration must fail the check").not.toBe(0);
    });
  });

  it("reports a table a service repository touches and does not declare, by name", async () => {
    // ASSERTION 3. The module repository beside it is the control: it declares
    // PayrollRun, touches SalaryTerm as well, and must still be reported — so a
    // green here cannot come from the loop having stopped working generally.
    //
    // Checked by name rather than by exact sentence because "reported by name"
    // is what the assertion says: an operator reading the gate output has to
    // learn WHICH table, since the fix is either to declare it or to stop
    // touching it and those are different fixes.
    const fixture: Fixture = {
      "lib/modules/payroll/repository.ts": repositorySource("PayrollRun", [
        "payrollRun",
        "salaryTerm",
      ]),
      "lib/services/alerts/repository.ts": repositorySource("Alert", ["alert", "alertEvent"]),
      "prisma/schema.prisma": CLEAN_SCHEMA,
    };
    await inSandbox(fixture, (dir) => {
      const { status, findings, output } = runBoundaryCheck(dir);
      expect(
        findings.filter((finding) => finding.includes("salaryTerm")),
        "the module control produced no undeclared-table finding, so this case proves nothing " +
          `about services. check-boundaries.sh said:\n${output}`,
      ).not.toHaveLength(0);

      const reported = findings.filter((finding) => finding.includes("alertEvent"));
      expect(
        reported,
        "check-boundaries.sh does not name alertEvent, which lib/services/alerts/repository.ts " +
          "queries and does not declare owning. Exclusive table ownership is the whole of the " +
          "boundary for a packaged capability service (ADR-039), so a table it touches outside " +
          "its declaration is the violation the check exists for.",
      ).not.toHaveLength(0);
      expect(
        reported.some((finding) => finding.includes("alerts")),
        `the undeclared table is named but the service that touched it is not: ${reported.join("; ")}`,
      ).toBe(true);
      expect(
        findings.filter((finding) => finding.includes("'alert'")),
        "check-boundaries.sh reports the alert table, which the repository DOES declare owning. " +
          "A check that reports a declared table reports every repository and is ignored by " +
          "everyone within a week.",
      ).toHaveLength(0);
      expect(status, "an undeclared table must fail the check").not.toBe(0);
    });
  });

  it("refuses obfuscated database access inside a service repository, in the module's words", async () => {
    // NOT ONE OF THE SIX, and here deliberately: it is what makes assertion 3
    // hold rather than merely pass. The undeclared-table check reads `db.<table>.`
    // out of the source, so `(db as any).undeclared` reaches a table while
    // naming none — the declaration check sees nothing and reports nothing. The
    // second loop in check-boundaries.sh exists for exactly that evasion and
    // reads the same two path lists as the first, so a fix that extends one
    // loop and not the other leaves assertion 3 defeatable by a cast.
    //
    // The two fixture files are identical from the client import down, so the
    // quoted line and its line number match and the expected finding is again
    // derived from the module one by substituting the path.
    const fixture: Fixture = {
      "lib/modules/payroll/repository.ts": repositorySource(
        "PayrollRun",
        ["payrollRun"],
        OBFUSCATED_ACCESS,
      ),
      "lib/services/alerts/repository.ts": repositorySource("Alert", ["alert"], OBFUSCATED_ACCESS),
      "prisma/schema.prisma": CLEAN_SCHEMA,
    };
    await inSandbox(fixture, (dir) => {
      const { status, findings, output } = runBoundaryCheck(dir);
      const modulePath = "lib/modules/payroll/repository.ts";
      const servicePath = "lib/services/alerts/repository.ts";
      const moduleFinding = findings.find(
        (finding) => finding.includes(modulePath) && finding.includes("undeclared"),
      );
      expect(
        moduleFinding,
        "the module control produced no obfuscation finding, so this case proves nothing about " +
          `services. check-boundaries.sh said:\n${output}`,
      ).toBeDefined();
      expect(
        findings,
        `check-boundaries.sh does not flag the cast in ${servicePath}. Casting the client past ` +
          "its type is how the declaration check is evaded, so the evasion is what has to be " +
          "flagged — otherwise the table a service does not declare is one cast away from being " +
          "invisible.",
      ).toContain((moduleFinding ?? "").replace(modulePath, servicePath));
      expect(status, "obfuscated database access must fail the check").not.toBe(0);
    });
  });

  it("still refuses every other file in the service the database", async () => {
    // ASSERTION 1, the shell half. This one passes today — the "nothing outside
    // a repository" grep walks all of lib/ — and its job is to keep passing. The
    // cheapest way to make the checks above go green is to stop treating
    // lib/services as ordinary source, and any exclusion broad enough to do that
    // takes this with it.
    const fixture: Fixture = {
      "lib/modules/payroll/calculate.ts": repositorySource(null, ["payrollRun"]),
      "lib/services/alerts/engine.ts": repositorySource(null, ["alert"]),
      "lib/services/alerts/index.ts": repositorySource(null, ["alert"]),
      "prisma/schema.prisma": CLEAN_SCHEMA,
    };
    await inSandbox(fixture, (dir) => {
      const { status, findings, output } = runBoundaryCheck(dir);
      const modulePath = "lib/modules/payroll/calculate.ts";
      const moduleFinding = findings.find((finding) => finding.startsWith(modulePath));
      expect(
        moduleFinding,
        "the module control produced no finding, so this case proves nothing. " +
          `check-boundaries.sh said:\n${output}`,
      ).toBeDefined();
      for (const servicePath of ["lib/services/alerts/engine.ts", "lib/services/alerts/index.ts"]) {
        expect(
          findings,
          `check-boundaries.sh no longer reports ${servicePath} for importing the database. Only ` +
            "the service's repository.ts may reach it — the index is its public surface and the " +
            "engine is domain logic, and neither is a repository.",
        ).toContain((moduleFinding ?? "").replace(modulePath, servicePath));
      }
      expect(status, "a non-repository file importing the database must fail the check").not.toBe(
        0,
      );
    });
  });

  it("leaves a correctly declared service repository alone", async () => {
    // The counterweight to the four cases above, and the reason they cannot be
    // satisfied by refusing lib/services wholesale. A service repository that
    // declares its tables and touches only those is the state the whole rule
    // exists to make reachable — the Alert Manager's store is the next thing
    // written under lib/services/ — and it has to come out clean.
    const fixture: Fixture = {
      "lib/modules/payroll/repository.ts": repositorySource("PayrollRun · SalaryTerm", [
        "payrollRun",
        "salaryTerm",
      ]),
      "lib/kernel/person/repository.ts": repositorySource("Person · PersonEnrolment", [
        "person",
        "personEnrolment",
      ]),
      "lib/services/alerts/repository.ts": repositorySource("Alert · AlertEvent", [
        "alert",
        "alertEvent",
      ]),
      // `./repository`, not `@/lib/services/alerts/repository`, because that is
      // what every real index.ts under lib/ does — kernel/person, kernel/regime
      // and the rest all re-export from "./repository". The distinction is
      // load-bearing and was measured here: the deep-import check is a text scan
      // over the whole of lib/, so it does not know that a folder's own index is
      // inside the folder, and the aliased spelling of a self-import is reported
      // for a MODULE at HEAD exactly as it is for a service. Writing the fixture
      // the other way made this case fail against a correct implementation.
      "lib/services/alerts/index.ts": 'export { query0 } from "./repository";\n',
      "prisma/schema.prisma": CLEAN_SCHEMA,
    };
    await inSandbox(fixture, (dir) => {
      const { status, findings, output } = runBoundaryCheck(dir);
      expect(
        findings,
        "check-boundaries.sh objects to a service repository that declares every table it " +
          `touches. Full output:\n${output}`,
      ).toEqual([]);
      expect(status, `expected a clean exit; check-boundaries.sh said:\n${output}`).toBe(0);
    });
  });

  it("refuses an import of a service past its index, and leaves the index itself alone", async () => {
    // ASSERTION 4, in the shell script. eslint carries the same rule and is
    // checked for it in the matrix above; BOTH are asserted because CLAUDE.md
    // rule 3 forbids reaching around the lint with an inline suppression
    // comment, and that is only a rule anybody can enforce because
    // check-boundaries.sh reads the source rather than the lint's verdict. For a
    // module, both tools refuse a deep import today, and "as it already does for
    // a module" is what the assertion says. ADR-021 makes this the same seam
    // either way — the call is identical whether the capability is a folder or a
    // container — so a folder anyone may reach around is not a seam, and
    // interface bypass inside the monolith is the exact risk that record names
    // to police.
    const fixture: Fixture = {
      "lib/consumers/module-deep.ts": importsFrom("@/lib/modules/payroll/calculate"),
      "lib/consumers/service-deep.ts": importsFrom("@/lib/services/alerts/engine"),
      "lib/consumers/service-deep-nested.ts": importsFrom("@/lib/services/alerts/internal/store"),
      "lib/consumers/service-surface.ts": importsFrom("@/lib/services/alerts"),
      "lib/consumers/service-index.ts": importsFrom("@/lib/services/alerts/index"),
      "prisma/schema.prisma": CLEAN_SCHEMA,
    };
    await inSandbox(fixture, (dir) => {
      const { status, findings, output } = runBoundaryCheck(dir);
      const deepFindings = findings.filter((finding) => finding.startsWith("deep import:"));
      expect(
        deepFindings.filter((finding) => finding.includes("module-deep.ts")),
        "the module control produced no deep-import finding, so this case proves nothing about " +
          `services. check-boundaries.sh said:\n${output}`,
      ).not.toHaveLength(0);

      for (const consumer of ["service-deep.ts", "service-deep-nested.ts"]) {
        expect(
          deepFindings.filter((finding) => finding.includes(consumer)),
          `check-boundaries.sh does not report lib/consumers/${consumer}, which imports past a ` +
            "service's index.ts. CLAUDE.md rule 4 makes index.ts the public surface of a folder " +
            "under lib/, and it is unenforced for services while the deep-import pattern names " +
            "@/lib/modules only.",
        ).not.toHaveLength(0);
      }
      for (const permitted of ["service-surface.ts", "service-index.ts"]) {
        expect(
          deepFindings.filter((finding) => finding.includes(permitted)),
          `check-boundaries.sh reports lib/consumers/${permitted}, which imports the service ` +
            "through its public surface. That is the supported call — refusing it would leave no " +
            "way to use a service at all.",
        ).toHaveLength(0);
      }
      expect(status, "a deep import must fail the check").not.toBe(0);
    });
  });

  it("still gives every module and kernel fixture the verdict it gives today", async () => {
    // ASSERTION 6, in the shell script, and the same not-a-discriminator: it
    // passes before the change and must pass after it. Every module and kernel
    // violation the script knows about is present at once, so a path list
    // widened for services that drops or duplicates one of them shows up here
    // rather than in a later node.
    const fixture: Fixture = {
      "lib/modules/payroll/repository.ts": repositorySource(null, ["payrollRun"]),
      "lib/kernel/person/repository.ts": repositorySource(
        "Person",
        ["person", "auditEntry"],
        OBFUSCATED_ACCESS,
      ),
      "lib/modules/payroll/calculate.ts": repositorySource(null, ["payrollRun"]),
      "lib/consumers/module-deep.ts": importsFrom("@/lib/modules/payroll/calculate"),
      "lib/consumers/module-surface.ts": importsFrom("@/lib/modules/payroll"),
      "prisma/schema.prisma": CLEAN_SCHEMA,
    };
    const mustReport: [string, string][] = [
      ["lib/modules/payroll/repository.ts", "a module repository with no '// owns:' declaration"],
      ["auditEntry", "a table a kernel repository touches and does not declare owning"],
      ["lib/kernel/person/repository.ts", "a cast past the client's type in a kernel repository"],
      [
        "lib/modules/payroll/calculate.ts",
        "a module file that is not a repository reaching the database",
      ],
      ["module-deep.ts", "an import past a module's index.ts"],
    ];
    const mustNotReport: [string, string][] = [
      ["module-surface.ts", "an import of a module through its index, which is the supported call"],
      ["'person'", "a table the kernel repository does declare owning"],
    ];
    await inSandbox(fixture, (dir) => {
      const { status, findings, output } = runBoundaryCheck(dir);
      for (const [needle, what] of mustReport) {
        expect(
          findings.filter((finding) => finding.includes(needle)),
          `check-boundaries.sh no longer reports ${what} (nothing mentions "${needle}"). Full ` +
            `output:\n${output}`,
        ).not.toHaveLength(0);
      }
      for (const [needle, what] of mustNotReport) {
        expect(
          findings.filter((finding) => finding.includes(needle)),
          `check-boundaries.sh has started reporting ${what} (something mentions "${needle}"). ` +
            `A rule widened to cover services has widened past them. Full output:\n${output}`,
        ).toHaveLength(0);
      }
      expect(status, "a tree holding five violations must fail the check").not.toBe(0);
    });
  });

  it("still finds this repository's own module and kernel repositories clean", async () => {
    // ASSERTION 6 against the real thing rather than a fixture. Every case above
    // reasons about repositories nobody wrote; this one runs the gate over the
    // ones people did. If a path list widened for lib/services turns a real
    // repository red, the fixtures cannot say so, because none of them is shaped
    // quite like a repository somebody actually maintains.
    const { status, output } = runBoundaryCheck(repoRoot);
    expect(status, `check-boundaries.sh is not clean on this repository:\n${output}`).toBe(0);
  });
});

// ===========================================================================
// Backlog node `gate-boundaries-blind-to-a-transaction`
//
// Assertions:
//
//   1. A repository touching an undeclared table inside db.$transaction is
//      reported by name, exactly as the direct form is
//   2. A repository whose transaction touches only declared tables stays clean
//   3. Declaring AlertEvent does not license touching Alert: the comparison is
//      against whole names, never a substring
//   4. A repository declaring every table it touches stays clean, and no
//      existing repository changes verdict
//
// WHICH CASES BELOW ARE DISCRIMINATORS AND WHICH ARE REGRESSION GUARDS, because
// the next person will otherwise assume every case here should be red at HEAD.
// Each `it` states its own direction in its first comment line; the summary is:
//
//   RED at HEAD, green after — these are the fix:
//     "reports a table reached through db.$transaction by name..."      (1)
//     "reads the transaction handle the author chose..."                (1)
//     "sees a transactional table in every repository this build has"   (1)
//     "refuses to let a declared AlertEvent license an undeclared Alert" (3)
//
//   GREEN at HEAD, green after — these are proof the fix broke nothing:
//     "leaves a transaction that touches only declared tables alone"    (2)
//     "leaves a repository that declares everything it touches alone"   (4)
//     "still finds every repository in this build clean"                (4)
//
// A too-eager fix — one that reads any `<identifier>.<table>.` it can find, or
// that stops matching a declaration written `A, B, C` — satisfies 1 and 3 and is
// wrong. The three green-at-HEAD cases are the only thing that says so, and two
// of them run against the repositories people actually maintain rather than
// against fixtures shaped to suit the check.
//
// WHY THIS MATTERS MORE THAN A SHELL SCRIPT USUALLY DOES. eslint block 2 exempts
// a repository.ts from the import rule entirely, so once that file holds the
// client nothing in the lint layer has an opinion about what it does with it.
// check-boundaries.sh is the whole of CLAUDE.md rule 1 for that one file, and
// data-ownership.md now says exactly that for a packaged capability service.
//
// THE TWO BLIND SPOTS, BOTH MEASURED AT HEAD (b40ff55) AGAINST
// `git show HEAD:scripts/check-boundaries.sh`:
//
//   - the table list is read with `grep -oE 'db\.[a-zA-Z]+\.'`, and inside
//     `db.$transaction(async (tx) => ...)` every table is reached as `tx.alert`.
//     `$` is not in `[a-zA-Z]`, so `db.$transaction` matches nothing either: a
//     repository whose entire body is one transaction is read as touching NO
//     tables at all, and comes out clean whatever it wrote to.
//   - the ownership comparison is `echo "$owned" | grep -qi "$model"`, a
//     SUBSTRING test. `alert` occurs inside `alertevent`, so a declaration of
//     AlertEvent licenses touching Alert.
//
// This schema is built from such pairs throughout — Alert/AlertArea/AlertEvent/
// AlertSource, Person/PersonRole, Deadline/DeadlineRegistration — so a case
// using two unrelated names would pass even under the broken comparison and
// prove nothing. Every pair below is a genuine prefix pair for that reason.
// ===========================================================================

/**
 * A repository that does its work inside an interactive transaction.
 *
 * `handle` is a parameter, not a constant, because the name of the transaction
 * client is chosen by whoever writes the callback. `tx` is a convention that
 * appears in the Prisma documentation; nothing enforces it, and `trx` and `t`
 * are both in common use. See the handle case below for why that is pinned.
 *
 * `annotation` carries the type annotation the typed form of the callback
 * takes — `async (tx: Prisma.TransactionClient) => ...` is what an author gets
 * from an editor completing the signature, and it changes the text around the
 * handle without changing anything about what the code reaches.
 */
function transactionalWrites(
  handle: string,
  tables: readonly string[],
  annotation: string = "",
): string {
  return (
    "export async function writeAll() {\n" +
    `  return db.$transaction(async (${handle}${annotation}) => {\n` +
    tables.map((table) => `    await ${handle}.${table}.create({ data: {} });\n`).join("") +
    "  });\n" +
    "}\n"
  );
}

/** A table name no declaration in this build contains, as a whole word or otherwise. */
const PROBE_TABLE = "probeUndeclaredTable";

/**
 * One transaction reaching one certainly-undeclared table, appended to a copy of
 * a real repository.
 *
 * Appended rather than substituted so the case does not depend on which tables
 * that repository happens to touch today: whatever it owns, it does not own
 * this, and the finding is expected regardless of how the file is later
 * rewritten.
 */
const TRANSACTIONAL_PROBE = `\n${transactionalWrites("tx", [PROBE_TABLE])}`;

/** Every repository.ts this build actually has, found the way the gate finds them. */
function realRepositories(): string[] {
  return ["lib/modules", "lib/kernel", "lib/services"].flatMap((parent) => {
    const absolute = path.join(repoRoot, parent);
    if (!fs.existsSync(absolute)) return [];
    return fs
      .readdirSync(absolute)
      .map((name) => path.posix.join(parent, name, "repository.ts"))
      .filter((relative) => fs.existsSync(path.join(repoRoot, relative)));
  });
}

/**
 * The real source tree, copied into a sandbox so a case may modify one file in
 * it without touching the working copy.
 *
 * lib/, app/ and the schema together are everything check-boundaries.sh reads,
 * so a run against this copy answers the same question a run at the repository
 * root answers — and CLAUDE.md's rule that lib/services and lib/modules are left
 * exactly as found is kept by construction, because nothing is written outside
 * the mkdtemp directory.
 */
function copyRealTree(dir: string): void {
  for (const entry of ["lib", "app"]) {
    const from = path.join(repoRoot, entry);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(dir, entry), { recursive: true });
  }
  fs.mkdirSync(path.join(dir, "prisma"), { recursive: true });
  fs.copyFileSync(
    path.join(repoRoot, "prisma", "schema.prisma"),
    path.join(dir, "prisma", "schema.prisma"),
  );
}

describe("check-boundaries.sh: a transaction is not a hiding place", () => {
  it("reports a table reached through db.$transaction by name, exactly as the direct form is", async () => {
    // ASSERTION 1. RED AT HEAD — this is the fix.
    //
    // The two repositories are the same repository written twice. Both declare
    // Alert alone; both reach alert and alertEvent; one does it directly and one
    // does it inside a transaction. The direct one is the control, so a green
    // here cannot come from the ownership loop having stopped working, and the
    // expected sentence for the transactional one is DERIVED from the control's
    // in the same run rather than restated — "exactly as the direct form is" is
    // then literally what is compared, and a change to the wording moves both
    // sides together instead of leaving a stale copy in a test file.
    const fixture: Fixture = {
      "lib/modules/payroll/repository.ts": repositorySource("Alert", ["alert", "alertEvent"]),
      "lib/services/alerts/repository.ts": repositorySource(
        "Alert",
        [],
        transactionalWrites("tx", ["alert", "alertEvent"]),
      ),
      "prisma/schema.prisma": CLEAN_SCHEMA,
    };
    await inSandbox(fixture, (dir) => {
      const { status, findings, output } = runBoundaryCheck(dir);

      const directFinding = findings.find(
        (finding) => finding.startsWith("payroll") && finding.includes("alertEvent"),
      );
      expect(
        directFinding,
        "the direct control produced no undeclared-table finding, so this case proves nothing " +
          `about transactions. check-boundaries.sh said:\n${output}`,
      ).toBeDefined();

      expect(
        findings,
        "check-boundaries.sh does not report alertEvent for lib/services/alerts/repository.ts, " +
          "which writes it inside db.$transaction while declaring Alert alone. The table list is " +
          "read as `db.<table>.`, and inside a transaction every table is reached through the " +
          "transaction client instead — so a repository whose body is one transaction is read as " +
          "touching nothing and comes out clean whatever it wrote to. eslint exempts a " +
          "repository.ts from the import rule entirely, so this check is the whole of CLAUDE.md " +
          `rule 1 for that file. Full output:\n${output}`,
      ).toContain((directFinding ?? "").replace("payroll", "alerts"));

      expect(
        findings.filter((finding) => finding.includes("'alert'")),
        "check-boundaries.sh reports the alert table, which both repositories DO declare owning. " +
          "A check that reports a declared table reports every repository and is ignored by " +
          `everyone within a week. Full output:\n${output}`,
      ).toHaveLength(0);

      expect(
        findings.filter((finding) => finding.includes("transaction")),
        "check-boundaries.sh has taken $transaction itself for a table name. It is a method on " +
          "the client, not a model; reporting it would put a finding on every repository that " +
          `uses one, which is the opposite of the fix. Full output:\n${output}`,
      ).toHaveLength(0);

      expect(status, "an undeclared table reached through a transaction must fail the check").not.toBe(0);
    });
  });

  it("reads the transaction handle the author chose, not the name `tx`", async () => {
    // ASSERTION 1, and RED AT HEAD for the same reason as the case above.
    //
    // PINNED DELIBERATELY, AND HERE IS THE ARGUMENT. `tx` is what the Prisma
    // documentation writes and nothing more: the handle is a callback parameter
    // and its name is the author's to choose. A fix that matches `tx.` literally
    // closes the hole for the spelling one document happens to use and leaves it
    // open for `trx`, for `t`, and for the typed form an editor generates. The
    // defect being fixed is that the check cannot see a table; swapping one
    // invisible spelling for another is the same defect with a smaller
    // catchment, and the next repository is not obliged to know which spelling
    // the gate can see. The assertion says "inside db.$transaction", and both
    // repositories below are inside db.$transaction.
    //
    // Kept as its own case, and with two independent shapes, so that a fix which
    // does hardcode `tx` fails HERE and nowhere else — which names the defect
    // instead of merely reporting that something about transactions is wrong.
    const fixture: Fixture = {
      "lib/modules/payroll/repository.ts": repositorySource(
        "PayrollRun",
        [],
        transactionalWrites("trx", ["payrollRun", "salaryTerm"]),
      ),
      "lib/kernel/person/repository.ts":
        'import type { Prisma } from "@prisma/client";\n' +
        repositorySource(
          "Person",
          [],
          transactionalWrites("t", ["person", "personEnrolment"], ": Prisma.TransactionClient"),
        ),
      "prisma/schema.prisma": CLEAN_SCHEMA,
    };
    const expected: [owner: string, table: string, shape: string][] = [
      ["payroll", "salaryTerm", "a handle named `trx`"],
      ["person", "personEnrolment", "a handle named `t`, with the callback's type annotation"],
    ];
    await inSandbox(fixture, (dir) => {
      const { status, findings, output } = runBoundaryCheck(dir);
      for (const [owner, table, shape] of expected) {
        expect(
          findings.filter((finding) => finding.includes(owner) && finding.includes(table)),
          `check-boundaries.sh does not report ${table}, which ${owner} writes inside ` +
            `db.$transaction through ${shape} while not declaring it. The transaction client is a ` +
            "callback parameter and its name is the author's choice, so a check that recognises " +
            "one spelling of it is evaded by renaming a lambda argument — which costs nothing and " +
            `looks like tidying. Full output:\n${output}`,
        ).not.toHaveLength(0);
      }
      expect(
        findings.filter(
          (finding) => finding.includes("'payrollRun'") || finding.includes("'person'"),
        ),
        "check-boundaries.sh reports a table the repository declares owning. Reading the handle " +
          `must not mean reporting everything reached through it. Full output:\n${output}`,
      ).toHaveLength(0);
      expect(status, "an undeclared table must fail the check whatever the handle is called").not.toBe(0);
    });
  });

  it("sees a transactional table in every repository this build actually has", async () => {
    // ASSERTION 1 against the repositories people maintain rather than against
    // fixtures. RED AT HEAD.
    //
    // Every case above reasons about repositories nobody wrote. This one takes
    // each real one, appends a transaction reaching one certainly-undeclared
    // table, and requires the gate to say so — for all of them, so that a fix
    // which extends the ownership loop for one path glob and not another (the
    // way the two loops in this script have drifted apart before) is caught
    // here. The clean copy is checked first: if the untouched tree is not clean
    // the probe proves nothing.
    //
    // The probe is APPENDED rather than substituted so the case survives those
    // repositories being rewritten: whatever tables they own tomorrow, they will
    // not own this one.
    await inSandbox({}, (dir) => {
      copyRealTree(dir);
      const repositories = realRepositories();
      expect(
        repositories.length,
        "no repository.ts was found under lib/modules, lib/kernel or lib/services, so this case " +
          "probes nothing at all",
      ).toBeGreaterThan(0);

      const baseline = runBoundaryCheck(dir);
      expect(
        baseline.findings,
        "the untouched copy of this build's own source is not clean, so nothing can be concluded " +
          `from modifying it. check-boundaries.sh said:\n${baseline.output}`,
      ).toEqual([]);

      for (const relative of repositories) {
        const target = path.join(dir, relative);
        const original = fs.readFileSync(target, "utf8");
        const owner = path.posix.basename(path.posix.dirname(relative));
        try {
          fs.writeFileSync(target, original + TRANSACTIONAL_PROBE);
          const { status, findings, output } = runBoundaryCheck(dir);
          expect(
            findings.filter(
              (finding) => finding.includes(owner) && finding.includes(PROBE_TABLE),
            ),
            `check-boundaries.sh does not report ${relative} for writing ${PROBE_TABLE} inside ` +
              "db.$transaction. It is the one file eslint permits to hold the client, so this " +
              "check is the only thing standing between it and another owner's tables " +
              `(CLAUDE.md rule 1). Full output:\n${output}`,
          ).not.toHaveLength(0);
          expect(
            status,
            `a real repository reaching an undeclared table must fail the check:\n${output}`,
          ).not.toBe(0);
        } finally {
          // restored on the failure path too, so a red case does not change what
          // every later iteration is measuring
          fs.writeFileSync(target, original);
        }
      }
    });
  });

  it("leaves a transaction that touches only declared tables alone", async () => {
    // ASSERTION 2. GREEN AT HEAD AND GREEN AFTER — a regression guard, not a fix.
    //
    // It passes at HEAD for the wrong reason: the tables are invisible, so there
    // is nothing to report. Its job is to still pass once they are visible. The
    // cheapest way to make the cases above go green is to report every
    // `<something>.<name>.` in the file, and that turns the correct, expected use
    // of an interactive transaction — writing an alert and its event log
    // atomically, which is why this node blocks service-alerts-raise — into a
    // permanent red gate. A gate that is red for correct code gets switched off.
    const fixture: Fixture = {
      "lib/services/alerts/repository.ts": repositorySource(
        "Alert, AlertEvent",
        [],
        transactionalWrites("tx", ["alert", "alertEvent"]),
      ),
      "prisma/schema.prisma": CLEAN_SCHEMA,
    };
    await inSandbox(fixture, (dir) => {
      const { status, findings, output } = runBoundaryCheck(dir);
      expect(
        findings,
        "check-boundaries.sh objects to a repository whose transaction touches only tables it " +
          `declares owning. Full output:\n${output}`,
      ).toEqual([]);
      expect(status, `expected a clean exit; check-boundaries.sh said:\n${output}`).toBe(0);
      expect(
        output,
        "check-boundaries.sh exited 0 without reaching its verdict line, so the run says nothing",
      ).toContain("boundaries clean");
    });
  });

  it("refuses to let a declared AlertEvent license an undeclared Alert, in either direction", async () => {
    // ASSERTION 3. RED AT HEAD — this is the fix.
    //
    // Three genuine prefix pairs, because a pair of unrelated names would pass
    // even under a substring comparison and prove nothing.
    //
    // BOTH DIRECTIONS ARE PINNED, and they are red and green at HEAD
    // respectively:
    //
    //   - alerts declares AlertEvent and touches alert; person declares
    //     PersonRole and touches person. `alert` occurs inside `alertevent`, so
    //     at HEAD the longer declaration licenses the shorter table and neither
    //     is reported. These two are the discriminators.
    //   - deadlines declares Deadline and touches deadlineRegistration. The
    //     substring test fails in that direction, so this one IS reported at
    //     HEAD, and it must stay reported. A fix that compared the other way
    //     round — asking whether a declared name occurs inside the touched one —
    //     would turn the first two green and this one silently green as well,
    //     which is the same hole facing the other way.
    const fixture: Fixture = {
      "lib/services/alerts/repository.ts": repositorySource("AlertEvent", ["alert", "alertEvent"]),
      "lib/kernel/person/repository.ts": repositorySource("PersonRole", ["person", "personRole"]),
      "lib/modules/deadlines/repository.ts": repositorySource("Deadline", [
        "deadline",
        "deadlineRegistration",
      ]),
      "prisma/schema.prisma": CLEAN_SCHEMA,
    };
    const mustReport: [owner: string, table: string, why: string][] = [
      [
        "alerts",
        "'alert'",
        "declares AlertEvent alone, and `alert` occurs inside `alertevent`, so a substring " +
          "comparison licenses it",
      ],
      [
        "person",
        "'person'",
        "declares PersonRole alone, and `person` occurs inside `personrole`",
      ],
      [
        "deadlines",
        "'deadlineRegistration'",
        "declares Deadline alone — the direction a substring comparison already catches, and " +
          "which must not be lost when the other direction is fixed",
      ],
    ];
    const mustNotReport: [table: string, why: string][] = [
      ["'alertEvent'", "alerts declares AlertEvent"],
      ["'personRole'", "person declares PersonRole"],
      ["'deadline'", "deadlines declares Deadline"],
    ];
    await inSandbox(fixture, (dir) => {
      const { status, findings, output } = runBoundaryCheck(dir);
      for (const [owner, table, why] of mustReport) {
        expect(
          findings.filter((finding) => finding.includes(owner) && finding.includes(table)),
          `check-boundaries.sh does not report ${owner} touching ${table}, which it ${why}. The ` +
            "ownership comparison must be against whole names: this schema is built from prefix " +
            "pairs throughout — Alert/AlertArea/AlertEvent/AlertSource, Person/PersonRole, " +
            "Deadline/DeadlineRegistration — so a substring test hands out a licence for a " +
            `neighbouring owner's tables almost everywhere. Full output:\n${output}`,
        ).not.toHaveLength(0);
      }
      for (const [table, why] of mustNotReport) {
        expect(
          findings.filter((finding) => finding.includes(table)),
          `check-boundaries.sh reports ${table}, though ${why}. Comparing whole names must not ` +
            `become comparing nothing. Full output:\n${output}`,
        ).toHaveLength(0);
      }
      expect(status, "an undeclared table must fail the check").not.toBe(0);
    });
  });

  it("leaves a repository that declares everything it touches alone, however the declaration is punctuated", async () => {
    // ASSERTION 4, the fixture half. GREEN AT HEAD AND GREEN AFTER — a
    // regression guard, not a fix.
    //
    // Whole-name comparison means splitting the declaration into names, and how
    // it is split is where a too-eager fix goes wrong. Every separator in use is
    // present here: every real declaration in this build is comma-separated
    // (`// owns: Jurisdiction, BusinessCalendar, BusinessHoliday`), while
    // data-ownership.md's map and the service fixture above spell the same list
    // with `·`. A split on whitespace alone leaves the token `Jurisdiction,`
    // with its comma attached, which then matches no table and turns three
    // kernel repositories red at once.
    //
    // Over-declaration is pinned too: BusinessHoliday is declared and not
    // touched. The check is one-directional by design — it asks whether every
    // table touched is declared, never whether every table declared is touched —
    // and a repository that owns a table it has not needed to query yet is
    // correct, not suspicious.
    const fixture: Fixture = {
      "lib/kernel/jurisdiction/repository.ts": repositorySource(
        "Jurisdiction, BusinessCalendar, BusinessHoliday",
        ["jurisdiction", "businessCalendar"],
      ),
      "lib/modules/payroll/repository.ts": repositorySource("PayrollRun · SalaryTerm", [
        "payrollRun",
        "salaryTerm",
      ]),
      "lib/services/alerts/repository.ts": repositorySource(
        "Alert, AlertArea, AlertEvent, AlertSource",
        ["alertArea", "alertSource"],
        transactionalWrites("tx", ["alert", "alertEvent"]),
      ),
      "prisma/schema.prisma": CLEAN_SCHEMA,
    };
    await inSandbox(fixture, (dir) => {
      const { status, findings, output } = runBoundaryCheck(dir);
      expect(
        findings,
        "check-boundaries.sh objects to a repository that declares every table it touches. " +
          "Reading a transaction and comparing whole names must not cost the correct case: this " +
          `is what a repository is supposed to look like. Full output:\n${output}`,
      ).toEqual([]);
      expect(status, `expected a clean exit; check-boundaries.sh said:\n${output}`).toBe(0);
    });
  });

  it("still finds every repository in this build clean", async () => {
    // ASSERTION 4, against the real thing. GREEN AT HEAD AND GREEN AFTER.
    //
    // Stated separately from the identical-looking case in the block above,
    // because the way it can now break is new: a fix that reads transaction
    // handles too liberally, or that splits a comma-separated declaration
    // wrongly, turns a legitimate repository red — and a fix that did that would
    // satisfy assertions 1 and 3 and still be wrong. There are eight repositories
    // in this build (six kernel, one module, one service); none of them may
    // change verdict, and the findings are asserted rather than only the exit
    // code so the failure names which one moved.
    const { status, findings, output } = runBoundaryCheck(repoRoot);
    expect(
      findings,
      "check-boundaries.sh has started reporting a repository in this build that it found clean " +
        `before. Full output:\n${output}`,
    ).toEqual([]);
    expect(status, `check-boundaries.sh is not clean on this repository:\n${output}`).toBe(0);
  });
});
