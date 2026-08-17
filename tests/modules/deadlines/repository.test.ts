// Assertion 1 of tasks/backlog.yaml#module-deadlines-repository:
//   "repository.ts imports db from lib/db.ts and declares both tables with
//    // owns:"
//
// Traced to:
//   CLAUDE.md, Structure — "`repository.ts`  the ONLY file importing @/lib/db;
//     its first line is `// owns: TableA, TableB` naming every table it may
//     touch — the boundary check reads this declaration".
//   CLAUDE.md rule 1 — "A module owns its tables exclusively."
//   CLAUDE.md rule 3 — "Never import the database client outside a module's
//     `repository.ts`."
//   docs/architecture/data-ownership.md:3 — "Every table has exactly one
//     writing owner."
//   docs/architecture/data-ownership.md:30 — the Deadline monitor's row:
//     "DeadlineRegistration · ThresholdTable".
//   docs/architecture/data-ownership.md:17 — "Repositories import the client;
//     they never construct one."
//
// HOW THIS FILE READS THE IMPLEMENTATION. The author of these tests read no file
// under lib/modules/deadlines/. Every assertion below is a static claim about
// source text that the TEST PROCESS reads at run time, using the same reader
// tests/kernel/kernel-repositories.test.ts uses for the kernel's repositories.
// The expected values come from the documents above.
//
// SCOPED TO ONE FILE ON PURPOSE. The kernel's version of this sweeps a whole
// directory, which is right there and wrong here: a sweep over lib/modules/*
// would be satisfied by any other module's repository the moment one exists,
// and this assertion is about the deadline monitor's. Every finder below names
// lib/modules/deadlines/repository.ts and fails if it is not there.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  REPO_ROOT,
  blankNonCode,
  dbUsages,
  importSpecifiers,
  ownsDeclaration,
} from "@/tests/kernel/kernel-source";
import { loadSchema, modelNamed } from "@/tests/kernel/prisma-schema";

const MODULE_DIR = path.join(REPO_ROOT, "lib", "modules", "deadlines");
const REPOSITORY = path.join(MODULE_DIR, "repository.ts");
const CLIENT = "@/lib/db";

/** data-ownership.md:30 — the Deadline monitor's row, in full. */
const OWNED = ["DeadlineRegistration", "ThresholdTable"];

/** The repository's source, or a failure that says what is missing. */
function source(): string {
  if (!existsSync(REPOSITORY)) {
    throw new Error(
      `${path.relative(REPO_ROOT, REPOSITORY)} does not exist. ` +
        "tasks/backlog.yaml#module-deadlines-repository produces it, so its absence is a " +
        "failure and not an empty sweep.",
    );
  }
  return readFileSync(REPOSITORY, "utf8");
}

const declared = (): string[] => ownsDeclaration(source()).tables;

const declares = (table: string): boolean =>
  declared().some((name) => name.toLowerCase() === table.toLowerCase());

describe("the deadline monitor's repository declares its tables with // owns:", () => {
  it("exists at all, which everything below is a claim about", () => {
    expect(existsSync(REPOSITORY), `${REPOSITORY} is missing`).toBe(true);
    expect(source().trim().length, "an empty repository declares nothing").toBeGreaterThan(0);
  });

  it("carries the declaration on the first line, where the boundary check looks", () => {
    // CLAUDE.md, Structure — "its first line is `// owns: TableA, TableB`".
    // scripts/check-boundaries.sh takes the FIRST matching line; a declaration
    // further down still passes that script today, but a second `// owns:`
    // above it would silently become the one that is read.
    const owns = ownsDeclaration(source());
    expect(owns.present, "no '// owns:' declaration anywhere in the file").toBe(true);
    expect(owns.onFirstLine, `the declaration is on line ${owns.line}, not line 1`).toBe(true);
  });

  it("names BOTH tables the module owns", () => {
    // The assertion says "both". One declared table and one undeclared one is
    // the failure mode the cross-check below cannot catch on its own: the
    // undeclared table simply never gets queried through this file.
    for (const table of OWNED) {
      expect(
        declares(table),
        `'${table}' is not declared. Declared: ${declared().join(", ") || "nothing"}`,
      ).toBe(true);
    }
  });

  it("names nothing else — not another module's table, and not a table that does not exist", () => {
    // data-ownership.md:3 — "Every table has exactly one writing owner." A
    // deadline repository declaring Finance's Settlement has taken ownership of
    // it by comment, and a misspelt name passes the boundary script's
    // case-insensitive match against itself while guarding nothing.
    const schema = loadSchema();
    const foreign = declared().filter(
      (table) => !OWNED.some((owned) => owned.toLowerCase() === table.toLowerCase()),
    );
    expect(foreign, "declared beyond the Deadline monitor's row of data-ownership.md:30").toEqual([]);

    const unknown = declared().filter((table) => modelNamed(schema, table) === undefined);
    expect(unknown, "declared, but not a model in prisma/schema.prisma").toEqual([]);
  });
});

describe("the deadline monitor's repository imports the shared client", () => {
  it("imports the client from lib/db.ts", () => {
    // data-ownership.md:17 — "Repositories import the client; they never
    // construct one… seven modules each doing that is seven pools against a
    // database sized for one application."
    expect(
      importSpecifiers(source()),
      "the repository reaches the database by some route other than the shared client",
    ).toContain(CLIENT);
  });

  it("constructs no client of its own", () => {
    expect(
      /new\s+PrismaClient\s*\(/.test(blankNonCode(source())),
      "a repository with its own client has its own pool",
    ).toBe(false);
  });

  it("touches at least one table through the client", () => {
    // The non-vacuity guard for the cross-check below, and a finding in its own
    // right: a repository.ts that never names a table either does nothing or
    // reaches the database by a route the declaration cannot describe.
    expect(dbUsages(source()).length, "no db.<table> call anywhere in the file").toBeGreaterThan(0);
  });

  it("touches only the tables it declares", () => {
    // The cross-check the declaration exists for. `// owns: DeadlineRegistration`
    // on a file that also writes `db.document` is a boundary the gate reports as
    // clean.
    const offenders = dbUsages(source())
      .filter((usage) => !declares(usage.delegate))
      .map((usage) => `line ${usage.line}: db.${usage.delegate} — declared: ${declared().join(", ")}`);
    expect(offenders).toEqual([]);
  });

  it("reaches no table through raw SQL or a computed delegate", () => {
    // `$queryRaw` names its tables in a string, and `db[name]` names none at
    // all. Either way the `// owns:` cross-check above is looking at nothing,
    // while still reading as clean.
    const code = blankNonCode(source(), { strings: false });
    expect(/\$(queryRaw|executeRaw)(Unsafe)?\b/.test(code), "raw SQL is invisible to // owns:").toBe(false);
    expect(
      /db\s+as\s+\w|\(\s*db\s*(as[^)]*)?\)\s*\.|db\s*\[/.test(blankNonCode(source())),
      "a cast or a computed delegate defeats the declaration",
    ).toBe(false);
  });
});

describe("nothing else in the deadline module reaches the database", () => {
  // CLAUDE.md rule 3. This is what makes `// owns:` the complete list of what
  // the module can touch, rather than the list of what one file happens to
  // touch. The linter enforces it too (eslint.config.mjs, block 1) — asserted
  // here as well because a rule that lives only in the linter is one a
  // suppression comment removes, and CLAUDE.md forbids adding one.
  const others = (): string[] =>
    ["index.ts", "thresholds.ts", "calendar.ts"].filter((name) =>
      existsSync(path.join(MODULE_DIR, name)),
    );

  it("has other files to check, so this is not an empty sweep", () => {
    expect(others().length, `no source beside repository.ts in ${MODULE_DIR}`).toBeGreaterThan(1);
  });

  it("keeps the client import out of every one of them", () => {
    const clients = [CLIENT, "@prisma/client", ".prisma/client"];
    const offenders = others().filter((name) =>
      importSpecifiers(readFileSync(path.join(MODULE_DIR, name), "utf8")).some((specifier) =>
        clients.includes(specifier),
      ),
    );
    expect(offenders, "only repository.ts may name the client").toEqual([]);
  });

  it("keeps db.<table> calls out of every one of them", () => {
    // The import is the usual route in, but not the only one: a re-export, or a
    // client passed as an argument, reaches the same tables without naming the
    // client package at the top of the file.
    const offenders = others().flatMap((name) =>
      dbUsages(readFileSync(path.join(MODULE_DIR, name), "utf8")).map(
        (usage) => `${name}:${usage.line} touches db.${usage.delegate}`,
      ),
    );
    expect(offenders).toEqual([]);
  });
});
