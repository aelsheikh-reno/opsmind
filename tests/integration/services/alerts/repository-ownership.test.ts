// Assertion 5 of tasks/backlog.yaml#service-alerts-store:
//   "The repository declares '// owns:' and touches no table outside that
//    declaration"
//
// and the two static halves of assertions 2, 4 and 7 — the claims that are
// about what the file NEVER does, which no amount of exercising can establish:
// an event is never updated or deleted, an alert is never deleted to close it,
// and no configuration is consulted to record a policyId.
//
// Traced to:
//   CLAUDE.md, Structure — "`repository.ts`  the ONLY file importing @/lib/db;
//     its first line is `// owns: TableA, TableB` naming every table it may
//     touch — the boundary check reads this declaration".
//   CLAUDE.md rule 1 — "A module owns its tables exclusively."
//   CLAUDE.md rule 3 — never import @/lib/db outside repository.ts.
//   docs/architecture/decisions.md, ADR-039 — a capability service's tables
//     live in the host application's storage, "owns them exclusively rather
//     than holding a store of its own"; the membership test loses "owns its own
//     store" and keeps EXCLUSIVE TABLE OWNERSHIP, so "the boundary lint rule —
//     not the network — is what enforces it".
//   docs/architecture/data-model.md#alert-manager — the four cards, which are
//     the whole of what this service may touch.
//
// HOW THIS FILE READS THE IMPLEMENTATION. The author of these tests read no file
// under lib/services/alerts/ except the merged index.ts and lifecycle.ts. Every
// assertion below is a static claim about source text that the TEST PROCESS
// reads at run time, using the same reader tests/kernel/kernel-repositories.test.ts
// and tests/modules/deadlines/repository.test.ts use.
//
// IT OBTAINS NO ENGINE, deliberately, and that is not a skip: it makes no claim
// about data. It sits beside the file that does, under the directory this node
// produces, so the two halves of the node's assertions are found together.
//
// SCOPED TO ONE FILE ON PURPOSE. A sweep over lib/services/* would be satisfied
// by any other service's repository the moment one exists, and this assertion is
// about the Alert Manager's.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, blankNonCode, dbUsages, importSpecifiers, ownsDeclaration } from "@/tests/kernel/kernel-source";
import { fieldNamed, loadSchema, modelNamed } from "@/tests/kernel/prisma-schema";

const SERVICE_DIR = path.join(REPO_ROOT, "lib", "services", "alerts");
const REPOSITORY = path.join(SERVICE_DIR, "repository.ts");
const CLIENT = "@/lib/db";
const OWNERSHIP_MAP = path.join(REPO_ROOT, "docs", "architecture", "data-ownership.md");

/** data-model.md#alert-manager — the four cards, in full and in order. */
const OWNED = ["Alert", "AlertArea", "AlertEvent", "AlertSource"];

/** The repository's source, or a failure that says what is missing. */
function source(): string {
  if (!existsSync(REPOSITORY)) {
    throw new Error(
      `${path.relative(REPO_ROOT, REPOSITORY)} does not exist. ` +
        "tasks/backlog.yaml#service-alerts-store produces it, so its absence is a failure and " +
        "not an empty sweep.",
    );
  }
  return readFileSync(REPOSITORY, "utf8");
}

const declared = (): string[] => ownsDeclaration(source()).tables;

const declares = (table: string): boolean => declared().some((name) => name.toLowerCase() === table.toLowerCase());

describe("the Alert Manager's repository declares its tables with // owns:", () => {
  it("exists at all, which everything below is a claim about", () => {
    expect(existsSync(REPOSITORY), `${REPOSITORY} is missing`).toBe(true);
    expect(source().trim().length, "an empty repository declares nothing").toBeGreaterThan(0);
  });

  it("carries the declaration on the first line, where the boundary check looks", () => {
    // CLAUDE.md, Structure — "its first line is `// owns: TableA, TableB`".
    // scripts/check-boundaries.sh takes the FIRST matching line, so a second
    // `// owns:` above the real one would silently become the one that is read.
    const owns = ownsDeclaration(source());
    expect(owns.present, "no '// owns:' declaration anywhere in the file").toBe(true);
    expect(owns.onFirstLine, `the declaration is on line ${owns.line}, not line 1`).toBe(true);
  });

  it("names all FOUR tables of the Alert Manager's cards", () => {
    // One declared table and three undeclared ones is the failure the
    // cross-check below cannot catch on its own: an undeclared table simply
    // never gets queried through this file, and the gate stays green while the
    // store is half built.
    for (const table of OWNED) {
      expect(declares(table), `'${table}' is not declared. Declared: ${declared().join(", ") || "nothing"}`).toBe(true);
    }
  });

  it("names nothing else — not another owner's table, and not a table that does not exist", () => {
    // ADR-039: exclusive table ownership is the whole of the membership test now
    // that the service shares the host's storage. A declaration naming Finance's
    // Settlement has taken ownership of it by comment, and a misspelt name
    // passes the boundary script's case-insensitive match against itself while
    // guarding nothing.
    const schema = loadSchema();
    const foreign = declared().filter((table) => !OWNED.some((owned) => owned.toLowerCase() === table.toLowerCase()));
    expect(foreign, "declared beyond the four cards of data-model.md#alert-manager").toEqual([]);

    const unknown = declared().filter((table) => modelNamed(schema, table) === undefined);
    expect(unknown, "declared, but not a model in prisma/schema.prisma").toEqual([]);
  });

  it("is named as the Alert Manager's row in the ownership map", () => {
    // data-ownership.md is what makes "exactly one writing owner" checkable
    // across the whole build rather than file by file, and this node produces an
    // update to it. A `// owns:` that agrees with nothing outside itself is a
    // declaration and not an ownership.
    const map = readFileSync(OWNERSHIP_MAP, "utf8");
    const absent = OWNED.filter((table) => !new RegExp(`\\b${table}\\b`).test(map));
    expect(absent, "owned by the repository but not named in docs/architecture/data-ownership.md").toEqual([]);
  });
});

describe("the Alert Manager's repository imports the shared client", () => {
  it("imports the client from lib/db.ts", () => {
    // ADR-039: a package shares the HOST'S connection by construction — "there
    // is no second datasource and no second connection pool". Constructing one
    // here is the concrete way that ruling gets broken.
    expect(
      importSpecifiers(source()),
      "the repository reaches the database by some route other than the shared client",
    ).toContain(CLIENT);
  });

  it("constructs no client of its own", () => {
    expect(
      /new\s+PrismaClient\s*\(/.test(blankNonCode(source())),
      "a repository with its own client has its own pool, and ADR-039 allows neither",
    ).toBe(false);
  });

  it("touches at least one table through the client", () => {
    // The non-vacuity guard for the cross-check below, and a finding in its own
    // right: a repository.ts that never names a table either does nothing or
    // reaches the database by a route the declaration cannot describe.
    expect(dbUsages(source()).length, "no db.<table> call anywhere in the file").toBeGreaterThan(0);
  });

  it("touches only the tables it declares", () => {
    // THE ASSERTION. `// owns: Alert` on a file that also writes
    // `db.deadlineRegistration` is a boundary the gate reports as clean.
    const offenders = dbUsages(source())
      .filter((usage) => !declares(usage.delegate))
      .map((usage) => `line ${usage.line}: db.${usage.delegate} — declared: ${declared().join(", ")}`);
    expect(offenders).toEqual([]);
  });

  it("reaches no table through raw SQL or a computed delegate", () => {
    // `$queryRaw` names its tables in a string and `db[name]` names none at all.
    // Either way the `// owns:` cross-check above is looking at nothing while
    // still reading as clean.
    const code = blankNonCode(source(), { strings: false });
    expect(/\$(queryRaw|executeRaw)(Unsafe)?\b/.test(code), "raw SQL is invisible to // owns:").toBe(false);
    expect(
      /db\s+as\s+\w|\(\s*db\s*(as[^)]*)?\)\s*\.|db\s*\[/.test(blankNonCode(source())),
      "a cast or a computed delegate defeats the declaration",
    ).toBe(false);
  });
});

describe("nothing else in the Alert Manager reaches the database", () => {
  // CLAUDE.md rule 3, and what makes `// owns:` the complete list of what this
  // service can touch rather than the list of what one file happens to touch.
  // The linter enforces it too — asserted here as well because a rule that lives
  // only in the linter is one a suppression comment removes, and CLAUDE.md
  // forbids adding one.
  const others = (): string[] =>
    readdirSync(SERVICE_DIR).filter((name) => name.endsWith(".ts") && name !== "repository.ts");

  it("has other files to check, so this is not an empty sweep", () => {
    // index.ts and lifecycle.ts are both merged, so this cannot be vacuous.
    expect(others().length, `no source beside repository.ts in ${SERVICE_DIR}`).toBeGreaterThan(1);
  });

  it("keeps the client import out of every one of them", () => {
    const clients = [CLIENT, "@prisma/client", ".prisma/client"];
    const offenders = others().filter((name) =>
      importSpecifiers(readFileSync(path.join(SERVICE_DIR, name), "utf8")).some((specifier) =>
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
      dbUsages(readFileSync(path.join(SERVICE_DIR, name), "utf8")).map(
        (usage) => `${name}:${usage.line} touches db.${usage.delegate}`,
      ),
    );
    expect(offenders).toEqual([]);
  });
});

describe("what the repository never does", () => {
  // The static halves of three assertions. Each of these is a claim about
  // absence, and absence cannot be exercised: no sequence of calls proves that
  // no call anywhere updates an event. The dynamic halves are next door in
  // repository.test.ts.
  const calls = (delegate: string, methods: string[]): string[] => {
    const code = blankNonCode(source());
    return methods.filter((method) => new RegExp(`\\b${delegate}\\s*\\.\\s*${method}\\b`).test(code));
  };

  it("never updates or deletes an AlertEvent", () => {
    // data-model.md#alert-manager, the AlertEvent card — "Never updated, never
    // deleted. The alert row carries current state so the hot path does not
    // replay history; this table is why the current state can be trusted." A
    // history that can be edited is not evidence of anything, and there is no
    // append-only trigger anywhere in prisma/migrations to catch it below.
    expect(
      calls("alertEvent", ["update", "updateMany", "upsert", "delete", "deleteMany"]),
      "the append-only table is written by something other than a create",
    ).toEqual([]);
  });

  it("never deletes an Alert", () => {
    // "A resolved alert's row survives its resolution — nothing is deleted to
    // close an alert." Retention for a resolved alert is OPEN in this node's
    // note (data-retention.md governs documents and says nothing about alerts),
    // so if a delete ever appears here it belongs to a retention decision
    // somebody recorded — not to closing one.
    expect(calls("alert", ["delete", "deleteMany"]), "an alert row is removed somewhere in this file").toEqual([]);
  });

  it("consults no configuration to record a policyId", () => {
    // ASSERTION 7's other half. "An unknown policyId is RECORDED, not only
    // accepted: the row carries it verbatim and NO CONFIGURATION IS CONSULTED."
    // The repository declares four tables and touches nothing else (above), and
    // none of the four is a rule book — so there is nothing for it to consult.
    // What remains is the schema: `policyId` must be a plain scalar, because a
    // relation would make an unknown policy a foreign-key violation and the
    // engine would refuse the very alert it is specified to keep.
    const alertModel = modelNamed(loadSchema(), "Alert");
    expect(alertModel, "prisma/schema.prisma declares no Alert model").toBeDefined();

    const policyId = alertModel === undefined ? undefined : fieldNamed(alertModel, "policyId");
    expect(policyId, "the Alert model has no policyId field").toBeDefined();
    expect(policyId?.type, "policyId is not a plain string").toBe("String");
    expect(policyId?.optional, "policyId is optional; the card has it always present").toBe(false);
    expect(
      policyId?.attributes.map((attribute) => attribute.name) ?? [],
      "policyId carries a relation, which makes an unknown policy a refusal",
    ).not.toContain("relation");
  });
});
