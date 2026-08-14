// The // owns: assertion of tasks/backlog.yaml#kernel-entities-law:
//   "Every kernel repository declares its tables with // owns:"
//
// and the three rules that give that declaration teeth. On its own, `// owns:`
// is a comment; what makes it a boundary is that (a) it is the first line, where
// scripts/check-boundaries.sh looks for it, (b) it names tables that exist and
// that the Kernel actually owns, (c) it names everything the file goes on to
// touch, and (d) nothing else in the kernel can reach the database at all. A
// declaration failing any of those is decoration.
//
// Traced to:
//   CLAUDE.md, Structure — "`repository.ts`  the ONLY file importing @/lib/db;
//     its first line is `// owns: TableA, TableB` naming every table it may
//     touch — the boundary check reads this declaration".
//   CLAUDE.md rule 1 — "A module owns its tables exclusively."
//   CLAUDE.md rule 3 — "Never import `@/lib/db` outside a module's
//     `repository.ts`."
//   CLAUDE.md rule 4 — "A module's public surface is its `index.ts`."
//   docs/architecture/data-ownership.md:3 — "Every table has exactly one
//     writing owner."
//   docs/architecture/data-ownership.md:23 — the Kernel's row of the ownership
//     table, quoted verbatim in KERNEL_TABLES below.
//   docs/architecture/data-ownership.md:17 — "Repositories import the client;
//     they never construct one."
//   docs/architecture/components-kernel.md:3 — "the dependency arrow only ever
//     points inward."
//
// HOW THIS FILE READS THE IMPLEMENTATION. It does not. The assertions are
// static sweeps over source text performed by the test process; the author of
// these tests read no file under `lib/kernel/`. Every expected value comes from
// the documents above or from `prisma/schema.prisma`, which was already merged
// and is not what this task builds.
//
// NON-VACUITY. Every sweep here is a "no file contains X" claim, which passes
// for free over an empty list. Each one therefore asserts its own input first:
// that kernel modules exist, that repositories exist, and — the one that
// matters most — that the repositories make at least one `db.<table>.` call
// between them, so the declared-versus-touched cross-check is comparing
// something against something. The reader those sweeps run on is itself proven
// against fixtures in kernel-source.test.ts.
import { describe, expect, it } from "vitest";
import {
  KERNEL_DIR,
  blankNonCode,
  dbUsages,
  importSpecifiers,
  kernelFiles,
  kernelModules,
  kernelRepositories,
  ownsDeclaration,
  type KernelModule,
  type SourceFile,
} from "./kernel-source";
import { loadSchema } from "./prisma-schema";

// data-ownership.md:23 — "Kernel | Person · PersonEnrolment · Document ·
// LegalEntity · Jurisdiction · BusinessCalendar · BusinessHoliday · Regime ·
// JurisdictionEnrolment · DocumentType · IngestionRule · FxRate · User ·
// AuditEntry · search_index (matview)".
const KERNEL_TABLES = [
  "Person",
  "PersonEnrolment",
  "Document",
  "LegalEntity",
  "Jurisdiction",
  "BusinessCalendar",
  "BusinessHoliday",
  "Regime",
  "JurisdictionEnrolment",
  "DocumentType",
  "IngestionRule",
  "FxRate",
  "User",
  "AuditEntry",
];

// Every table the kernel entities are made of, both halves of the split now
// landed. Jurisdiction's calendar is two tables because data-model.md:151 gives
// it "weekend mask + holidays[]", and enrolment is two because
// components-kernel.md:9 adds person-level enrolments alongside the
// entity-level JurisdictionEnrolment of :14.
const IN_SCOPE_TABLES = [
  "Person",
  "PersonEnrolment",
  "Document",
  "LegalEntity",
  "Jurisdiction",
  "BusinessCalendar",
  "BusinessHoliday",
  "Regime",
  "JurisdictionEnrolment",
];

// The other owners' rows of data-ownership.md:24-30. A kernel repository naming
// one of these has claimed a table it does not own, which is rule 1 broken in
// the declaration itself rather than in a query.
const OTHER_OWNERS: Record<string, string[]> = {
  Payroll: ["PayrollRun", "PayrollEntry", "SalarySchedule", "SalaryTerm"],
  Projects: [
    "Project",
    "ProjectService",
    "ProjectActivity",
    "ProjectMilestone",
    "Timesheet",
    "TimesheetEntry",
    "ProjectTeamMember",
    "ProjectMemberAllocation",
    "ProjectAiSuggestion",
    "ProjectDocumentLink",
  ],
  Expenses: ["Expense", "ExpenseAttachment", "PettyCashFloat", "ClaimToken"],
  Billing: ["BillablePosition"],
  Finance: [
    "OpenItem",
    "Settlement",
    "TaxFiling",
    "LeaseSchedule",
    "LoanSchedule",
    "Budget",
    "CapitalInjection",
    "Scenario",
    "ScenarioEvent",
  ],
  Ingestion: ["IngestionRun", "ReviewQueueRef"],
  "Deadline monitor": ["DeadlineRegistration", "ThresholdTable"],
};

const ownerOf = (table: string): string | undefined =>
  Object.entries(OTHER_OWNERS).find(([, tables]) =>
    tables.some((name) => name.toLowerCase() === table.toLowerCase()),
  )?.[0];

// ------------------------------------------------------------ loud finders --

/** The kernel's modules. Throws, naming what is there, rather than sweeping nothing. */
function requireModules(): KernelModule[] {
  const modules = kernelModules();
  if (modules.length === 0) {
    throw new Error(
      `no module folders under ${KERNEL_DIR}. tasks/backlog.yaml#kernel-entities-law produces ` +
        "lib/kernel/*/{index,repository}.ts, so an empty kernel is a failure and not an " +
        "empty sweep.",
    );
  }
  return modules;
}

function requireRepositories(): SourceFile[] {
  const repositories = kernelRepositories();
  if (repositories.length === 0) {
    const folders = requireModules()
      .map((module) => module.name)
      .join(", ");
    throw new Error(
      `no lib/kernel/*/repository.ts exists. Kernel folders present: ${folders || "none"}. ` +
        "Assertion 4 is about what every kernel repository declares; with none, it says nothing.",
    );
  }
  return repositories;
}

const schema = loadSchema();
const modelNames = schema.models.map((model) => model.name);

/** The schema model a Prisma delegate refers to: `personEnrolment` -> `PersonEnrolment`. */
function modelForDelegate(delegate: string): string | undefined {
  return modelNames.find((name) => name.toLowerCase() === delegate.toLowerCase());
}

const declaredBy = (repository: SourceFile): string[] => ownsDeclaration(repository.source).tables;

const declaresTable = (repository: SourceFile, table: string): boolean =>
  declaredBy(repository).some((name) => name.toLowerCase() === table.toLowerCase());

const allDeclared = (): string[] =>
  requireRepositories().flatMap((repository) => declaredBy(repository));

// ------------------------------------------------------ the kernel exists --

describe("the kernel's modules", () => {
  it("exist, as folders under lib/kernel with source in them", () => {
    const modules = requireModules();
    const empty = modules.filter((module) => module.files.length === 0).map((m) => m.relative);
    expect(empty, "a kernel folder with no TypeScript in it is not a module").toEqual([]);
  });

  it("each expose an index.ts, which is the module's only public surface", () => {
    // CLAUDE.md rule 4 — "A module's public surface is its `index.ts`. Never
    // deep-import `lib/modules/payroll/internal/...` from outside". A module
    // with no index has no surface, so every use of it is a deep import.
    const missing = requireModules()
      .filter((module) => module.index === undefined)
      .map((module) => module.relative);
    expect(missing, "these kernel modules have no index.ts").toEqual([]);
  });

  it("between them hold at least one repository", () => {
    expect(requireRepositories().length).toBeGreaterThan(0);
  });
});

// --------------------------------------------- assertion 4 · the declaration --

describe("every kernel repository declares its tables with // owns:", () => {
  it("declares them on the first line, where the boundary check looks", () => {
    // CLAUDE.md, Structure — "its first line is `// owns: TableA, TableB`".
    // scripts/check-boundaries.sh takes the FIRST matching line; a declaration
    // further down still passes that script today, but the convention CLAUDE.md
    // states is line one, and a second `// owns:` above it would silently become
    // the one that is read.
    const offenders = requireRepositories()
      .map((repository) => ({ repository, owns: ownsDeclaration(repository.source) }))
      .filter(({ owns }) => !owns.onFirstLine)
      .map(({ repository, owns }) =>
        owns.present
          ? `${repository.relative}: declaration is on line ${owns.line}, not line 1`
          : `${repository.relative}: no '// owns:' declaration at all`,
      );
    expect(offenders).toEqual([]);
  });

  it("names at least one table in each declaration", () => {
    // An empty `// owns:` satisfies a grep for the string and declares nothing.
    const offenders = requireRepositories()
      .filter((repository) => declaredBy(repository).length === 0)
      .map((repository) => `${repository.relative}: ${ownsDeclaration(repository.source).raw}`);
    expect(offenders, "a declaration listing no table is a comment").toEqual([]);
  });

  it("names only tables that exist in prisma/schema.prisma", () => {
    // A misspelt table passes the boundary script's case-insensitive substring
    // match against itself and then guards nothing.
    const offenders = requireRepositories().flatMap((repository) =>
      declaredBy(repository)
        .filter((table) => modelForDelegate(table) === undefined)
        .map((table) => `${repository.relative} declares '${table}', which is not a model`),
    );
    expect(offenders).toEqual([]);
  });

  it("names only tables the Kernel owns", () => {
    // data-ownership.md:23 lists the Kernel's tables; :3 gives every table
    // exactly one writing owner. A kernel repository declaring Finance's
    // Settlement has taken ownership of it by comment.
    const offenders = requireRepositories().flatMap((repository) =>
      declaredBy(repository)
        .filter((table) => !KERNEL_TABLES.some((name) => name.toLowerCase() === table.toLowerCase()))
        .map(
          (table) =>
            `${repository.relative} declares '${table}'` +
            (ownerOf(table) === undefined
              ? ", which is not in the Kernel's row of data-ownership.md"
              : `, which ${ownerOf(table)} owns`),
        ),
    );
    expect(offenders).toEqual([]);
  });

  it("gives every table exactly one owning repository", () => {
    // data-ownership.md:3 — "Every table has exactly one writing owner." Two
    // kernel repositories both writing Person is the same defect as a module
    // writing another module's table, one level down.
    const seen = new Map<string, string[]>();
    for (const repository of requireRepositories()) {
      for (const table of declaredBy(repository)) {
        const key = table.toLowerCase();
        seen.set(key, [...(seen.get(key) ?? []), repository.relative]);
      }
    }
    const shared = [...seen.entries()]
      .filter(([, owners]) => owners.length > 1)
      .map(([table, owners]) => `${table} is declared by ${owners.join(" and ")}`);
    expect(shared).toEqual([]);
  });

  it("covers every table the kernel entities are made of", () => {
    // A table nobody declares is a table no repository may touch, which means
    // the entity has no way in or out of the database.
    const declared = allDeclared().map((table) => table.toLowerCase());
    const missing = IN_SCOPE_TABLES.filter((table) => !declared.includes(table.toLowerCase()));
    expect(
      missing,
      `no kernel repository declares these. Declared: ${allDeclared().join(", ") || "nothing"}`,
    ).toEqual([]);
  });
});

// ----------------------------------------- assertion 4 · what makes it true --

describe("a kernel repository touches only what it declares", () => {
  it("makes at least one call through the client, in every repository", () => {
    // The non-vacuity guard for the cross-check below, and a finding in its own
    // right: a repository.ts that never names a table either does nothing or
    // reaches the database by a route the declaration cannot describe.
    const silent = requireRepositories()
      .filter((repository) => dbUsages(repository.source).length === 0)
      .map((repository) => repository.relative);
    expect(silent, "a repository that queries nothing declares nothing meaningful").toEqual([]);

    const total = requireRepositories().flatMap((repository) => dbUsages(repository.source));
    expect(total.length, "no db.<table>. call found anywhere in the kernel").toBeGreaterThan(0);
  });

  it("touches only tables that exist in the schema", () => {
    const offenders = requireRepositories().flatMap((repository) =>
      dbUsages(repository.source)
        .filter((usage) => modelForDelegate(usage.delegate) === undefined)
        .map(
          (usage) =>
            `${repository.relative}:${usage.line} touches db.${usage.delegate}, which is not a model`,
        ),
    );
    expect(offenders).toEqual([]);
  });

  it("declares every table it touches", () => {
    // The cross-check the declaration exists for. `// owns: Person` on a file
    // that also writes `db.document` is a boundary the gate reports as clean.
    const offenders = requireRepositories().flatMap((repository) =>
      dbUsages(repository.source)
        .map((usage) => ({ usage, model: modelForDelegate(usage.delegate) ?? usage.delegate }))
        .filter(({ model }) => !declaresTable(repository, model))
        .map(
          ({ usage, model }) =>
            `${repository.relative}:${usage.line} touches ${model}, declared: ` +
            `${declaredBy(repository).join(", ") || "nothing"}`,
        ),
    );
    expect(offenders).toEqual([]);
  });

  it("reaches no table through raw SQL, which the declaration cannot see", () => {
    // `$queryRaw`/`$executeRaw` name their tables in a SQL string. Nothing about
    // that string is checkable against `// owns:`, so a repository using one has
    // stepped outside the boundary while the declaration still reads as clean.
    const offenders = requireRepositories().flatMap((repository) =>
      blankNonCode(repository.source, { strings: false })
        .split("\n")
        .map((line, index) => ({ line: line.trim(), number: index + 1 }))
        .filter(({ line }) => /\$(queryRaw|executeRaw)(Unsafe)?\b/.test(line))
        .map(({ line, number }) => `${repository.relative}:${number}: ${line}`),
    );
    expect(offenders).toEqual([]);
  });

  it("does not reach the client through a cast or a computed name", () => {
    // The evasions scripts/check-boundaries.sh flags by name: `db as any`,
    // `(db).foo`, `db[name]`. A computed delegate defeats the cross-check above
    // in exactly the same way raw SQL does.
    const offenders = requireRepositories().flatMap((repository) =>
      blankNonCode(repository.source)
        .split("\n")
        .map((line, index) => ({ line: line.trim(), number: index + 1 }))
        .filter(({ line }) => /db\s+as\s+\w|\(\s*db\s*(as[^)]*)?\)\s*\.|db\s*\[/.test(line))
        .map(({ line, number }) => `${repository.relative}:${number}: ${line}`),
    );
    expect(offenders).toEqual([]);
  });

  it("imports the shared client and never constructs one", () => {
    // data-ownership.md:17 — "Repositories import the client; they never
    // construct one... seven modules each doing that is seven pools against a
    // database sized for one application".
    const repositories = requireRepositories();
    const constructing = repositories
      .filter((repository) => /new\s+PrismaClient\s*\(/.test(blankNonCode(repository.source)))
      .map((repository) => repository.relative);
    expect(constructing, "a repository with its own client has its own pool").toEqual([]);

    const notImporting = repositories
      .filter((repository) => !importSpecifiers(repository.source).includes("@/lib/db"))
      .map((repository) => repository.relative);
    expect(
      notImporting,
      "a repository that does not import the shared client reaches the database some other way",
    ).toEqual([]);
  });
});

// ------------------------------------------ rule 3 · nothing else reaches it --

describe("nothing in the kernel but a repository reaches the database", () => {
  it("has kernel source to sweep", () => {
    // The guard for the sweep below, which is otherwise satisfied by an empty
    // folder.
    const files = kernelFiles();
    expect(files.length, `no TypeScript under ${KERNEL_DIR}`).toBeGreaterThan(0);
    expect(files.filter((file) => file.name === "index.ts").length).toBeGreaterThan(0);
  });

  it("keeps the database import out of every other kernel file", () => {
    // CLAUDE.md rule 3 — "Never import `@/lib/db` outside a module's
    // `repository.ts`." Stated here for lib/kernel specifically: this is what
    // makes `// owns:` the complete list of what a module can touch, rather than
    // the list of what one file happens to touch.
    const clientImports = ["@/lib/db", "@prisma/client", ".prisma/client"];
    const offenders = kernelFiles()
      .filter((file) => file.name !== "repository.ts")
      .filter((file) =>
        importSpecifiers(file.source).some((specifier) => clientImports.includes(specifier)),
      )
      .map((file) => file.relative);
    expect(offenders, "only a repository.ts may name the client").toEqual([]);
  });
});

// -------------------------------- components-kernel.md:3 · the arrow inward --

describe("the kernel depends on nothing above it", () => {
  it("imports no module, service, adapter or page", () => {
    // components-kernel.md:3 — "Twelve components every module may depend on...
    // the dependency arrow only ever points inward." A kernel that imports
    // Payroll cannot be the shared vocabulary Payroll is built on, and the
    // cycle makes either one impossible to extract later (ADR-021).
    const forbidden = [
      /^@\/lib\/modules\//,
      /^@\/lib\/services\//,
      /^@\/lib\/adapters\//,
      /^@\/app\//,
    ];
    const offenders = kernelFiles().flatMap((file) =>
      importSpecifiers(file.source)
        .filter((specifier) => forbidden.some((pattern) => pattern.test(specifier)))
        .map((specifier) => `${file.relative} imports ${specifier}`),
    );
    expect(offenders).toEqual([]);
  });

  it("reaches another kernel module only through its index", () => {
    // CLAUDE.md rule 4, applied inside the kernel. `@/lib/kernel/person/repository`
    // from the jurisdiction module is the same boundary break as a cross-module
    // deep import, and it is the one the eslint `no-restricted-imports` pattern
    // (`@/lib/modules/*/!(index)`) does not currently cover.
    const offenders = kernelFiles().flatMap((file) =>
      importSpecifiers(file.source)
        .filter((specifier) => {
          const alias = /^@\/lib\/kernel\/([^/]+)\/(.+)$/.exec(specifier);
          if (alias !== null) return alias[1] !== file.module && alias[2] !== "index";
          const relative = /^\.\.\/([^/]+)\/(.+)$/.exec(specifier);
          return relative !== null && relative[1] !== file.module && relative[2] !== "index";
        })
        .map((specifier) => `${file.relative} deep-imports ${specifier}`),
    );
    expect(offenders).toEqual([]);
  });
});
