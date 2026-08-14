// The business-calendar assertion of tasks/backlog.yaml#kernel-entities-law:
//   1. "Person carries managerId and supports per-jurisdiction enrolments"
//   2. "Jurisdiction exposes a business calendar with weekend mask and holidays"
//
// Traced to:
//   components-kernel.md:9 — "**Person** | Staff identity … | + managerId (org
//     chart, required to resolve approvers) · + person-level enrolments (SI and
//     tax identifiers per jurisdiction)".
//   components-kernel.md:12 — "**Jurisdiction** | The country, plus its business
//     calendar (Sun–Thu, per-country holidays) | Calendar becomes first-class —
//     deadline maths cannot be UTC arithmetic".
//   components-kernel.md:14 — "**JurisdictionEnrolment** | An entity's standing
//     under a regime … needed for counterparties too".
//   data-model.md:123-124 — "`managerId` | → Person | Org chart — required to
//     resolve who approves what"; "`PersonEnrolment` | new relation | Social
//     insurance and tax identifiers, per jurisdiction, with validity dates".
//   data-model.md:151 — "`BusinessCalendar` | weekend mask + holidays[] |
//     Sunday–Thursday in the Gulf; deadline maths cannot be UTC arithmetic".
//   data-model.md:226 — "Business days are counted against the jurisdiction's
//     calendar … a jurisdiction with no calendar is an error, never a
//     Saturday–Sunday fallback. An id with no relation — the Kernel owns
//     `Jurisdiction`, and this module reads it through the kernel interface".
//   CLAUDE.md rule 4 — "A module's public surface is its `index.ts`."
//   CLAUDE.md rule 9 — "The working week is Sunday–Thursday in the Gulf."
//
// HOW THESE TWO ARE TESTED, AND WHAT THAT COSTS.
//
// The behaviour behind both assertions lives on the other side of a database:
// resolving an approver walks Person rows, and producing a calendar reads
// BusinessCalendar and BusinessHoliday. There is no PostgreSQL in this
// environment and the module takes no port these tests can substitute for one,
// so what is checkable here is the public surface itself — the shapes the
// kernel promises everything else, which rule 4 makes its contract — plus that
// the surface loads at all and leaks no client.
//
// Two things are deliberately NOT claimed by this file, and are stated so the
// gap is visible rather than assumed covered:
//   * that a calendar read back from the database has the Gulf mask [5, 6].
//     Business-day arithmetic over that mask is exercised end to end in
//     tests/modules/deadlines/calendar.test.ts, which is where the Friday and
//     Saturday boundaries live.
//   * that `managerId` resolves to a real Person. That is a foreign key, pinned
//     in tests/kernel/kernel-schema.test.ts against prisma/schema.prisma.
//
// WHAT WAS READ WHILE WRITING THIS FILE, STATED EXACTLY. The tests were
// designed from the specification, against an empty `lib/kernel/`. When the
// implementation landed mid-task, the exported type declarations of
// `person/index.ts`, `jurisdiction/index.ts` and `document/index.ts` were read
// to bind the calls and build the fixtures — the allowance the task gives for
// signatures. A range-matching mistake in that extraction also printed the
// bodies of `managerChain` and `documentAmount`. That is disclosed rather than
// hidden, and it is why those two are tested by properties the spec settles —
// direction is carried and not inferred (rule 6), a chain does not repeat a
// person, an absent amount is refused — rather than by anything a body showed.
//
// Scope: this node is kernel-entities-law — Jurisdiction with its calendar,
// Regime and JurisdictionEnrolment. The Person, org-chart and Document cases
// written alongside these went to kernel-entities-parties with the components
// they assert, so the code and the tests are cut at the same seam. They were
// carried, not deleted; the two questions the spec does not settle (whether a
// cyclic chart throws or truncates, and whether a chain includes the person
// themself) travel with them and are flagged for Ahmed rather than pinned to
// what the code happens to do.
//
// No other file under `lib/kernel/` was read by the author. The declarations
// swept below are read by the test process, from `index.ts` and the
// declarations it re-exports, and never from a function body.
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { isWeekendMask } from "@/lib/kernel/jurisdiction";
import {
  KERNEL_DIR,
  blankNonCode,
  exportedTypeBlocks,
  kernelFiles,
  kernelModules,
  kernelPublicDeclarations,
  kernelPublicTypeBlocks,
  REPO_ROOT,
  type Declaration,
  type KernelModule,
  type TypeBlock,
} from "./kernel-source";
import path from "node:path";
import { readFileSync } from "node:fs";

// ------------------------------------------------------------ loud finders --

function requireModules(): KernelModule[] {
  const modules = kernelModules();
  if (modules.length === 0) {
    throw new Error(
      `no module folders under ${KERNEL_DIR}. kernel-entities produces ` +
        "lib/kernel/*/{index,repository}.ts; with none there is no surface to assert about.",
    );
  }
  return modules;
}

function requirePublicTypes(): TypeBlock[] {
  const blocks = kernelPublicTypeBlocks();
  if (blocks.length === 0) {
    const modules = requireModules().map((module) => module.name).join(", ");
    throw new Error(
      `the kernel's public surface declares no exported type. Modules: ${modules}. ` +
        "Person's managerId and the business calendar are shapes callers read; a surface " +
        "that declares none of them promises nothing. (If the shapes are re-exported " +
        "Prisma types rather than declared, they are not readable here and rule 3 forbids " +
        "the client import that would make them so.)",
    );
  }
  return blocks;
}

const memberNames = (block: TypeBlock): string[] =>
  block.members.map((member) => member.name.toLowerCase());

/** The public type carrying all of these members. Throws, listing the surface, if none does. */
function typeWith(...members: string[]): TypeBlock {
  const wanted = members.map((member) => member.toLowerCase());
  const found = requirePublicTypes().find((block) =>
    wanted.every((member) => memberNames(block).includes(member)),
  );
  if (found === undefined) {
    const surface = requirePublicTypes()
      .map((block) => `${block.name}{${block.members.map((m) => m.name).join(",")}}`)
      .join("  ");
    throw new Error(`no exported kernel type carries ${members.join(" + ")}. Surface: ${surface}`);
  }
  return found;
}

function member(block: TypeBlock, name: string) {
  const found = block.members.find((m) => m.name.toLowerCase() === name.toLowerCase());
  if (found === undefined) {
    throw new Error(`${block.name} has no ${name}. Members: ${memberNames(block).join(", ")}`);
  }
  return found;
}

/** A collection of T: `T[]`, `readonly T[]` or `Array<T>`. */
const isCollectionOf = (type: string, of: string): boolean =>
  new RegExp(`(^|[^\\w])${of}\\s*\\[\\]|Array\\s*<\\s*${of}\\s*>|ReadonlyArray\\s*<\\s*${of}\\s*>`).test(
    type,
  );

const canBeAbsent = (type: string, optional: boolean): boolean =>
  optional || /\bnull\b|\bundefined\b/.test(type);

// ------------------------------ the calendar Jurisdiction must expose --

describe("Jurisdiction exposes a business calendar", () => {
  /** The calendar shape: whatever public type carries a weekend mask. */
  function calendar(): TypeBlock {
    return typeWith("weekendMask");
  }

  it("declares a calendar with a weekend mask and holidays", () => {
    // data-model.md:151 — "`BusinessCalendar` | weekend mask + holidays[]".
    // components-kernel.md:12 — "Calendar becomes first-class".
    expect(memberNames(calendar())).toEqual(expect.arrayContaining(["weekendmask", "holidays"]));
  });

  it("says which jurisdiction the calendar belongs to", () => {
    // A calendar that cannot name its jurisdiction cannot be selected for one,
    // and data-model.md:226 makes the jurisdiction the thing distance is
    // measured against.
    expect(memberNames(calendar())).toContain("jurisdictionid");
  });

  it("holds the weekend as a set of day numbers, so Friday AND Saturday fit", () => {
    // CLAUDE.md rule 9 — "The working week is Sunday–Thursday in the Gulf." The
    // Gulf mask is two days, [5, 6] with 0 = Sunday (prisma BusinessCalendar,
    // and lib/modules/deadlines/calendar.ts:23). A boolean or a single
    // day-of-week cannot express it, and a schema that cannot say "Friday and
    // Saturday" cannot do Gulf deadline arithmetic at all.
    const mask = member(calendar(), "weekendMask");
    expect(
      isCollectionOf(mask.type, "number"),
      `weekendMask is declared \`${mask.type}\`, which cannot hold both Friday and Saturday`,
    ).toBe(true);
  });

  it("holds holidays as a collection of dates", () => {
    // "per-country holidays" (components-kernel.md:12) — many per country, each
    // a civil date. data-model.md:19 — civil dates are stored at UTC midnight
    // and name a calendar day.
    const holidays = member(calendar(), "holidays");
    expect(
      isCollectionOf(holidays.type, "Date"),
      `holidays is declared \`${holidays.type}\``,
    ).toBe(true);
  });

  it("makes neither the mask nor the holidays optional", () => {
    // data-model.md:226 — "a jurisdiction with no calendar is an error, never a
    // Saturday–Sunday fallback". An optional mask is that fallback wearing a
    // different hat: the caller has to invent a working week, and the invented
    // one is Saturday–Sunday, which is wrong for all five countries. An empty
    // holiday list is representable without the member being optional.
    const mask = member(calendar(), "weekendMask");
    const holidays = member(calendar(), "holidays");
    expect(canBeAbsent(mask.type, mask.optional), `weekendMask is \`${mask.type}\``).toBe(false);
    expect(canBeAbsent(holidays.type, holidays.optional), `holidays is \`${holidays.type}\``).toBe(
      false,
    );
  });

  it("exposes the calendar through a call that takes a jurisdiction", () => {
    // "Jurisdiction EXPOSES a business calendar" — declaring the type is not
    // exposing it. data-model.md:226 has the deadline monitor reading the
    // calendar "through the kernel interface rather than joining", so there has
    // to be something on the surface to call.
    const name = calendar().name;
    const exposing = kernelPublicDeclarations().filter(
      (declaration) =>
        declaration.name !== name &&
        declaration.signature.includes(name) &&
        /jurisdiction/i.test(declaration.signature),
    );
    expect(
      exposing.map((declaration) => `${declaration.file}: ${declaration.signature}`),
      `nothing on the kernel's public surface returns ${name} for a jurisdiction`,
    ).not.toEqual([]);
  });

  it("hands the deadline monitor the shape it already expects", () => {
    // lib/modules/deadlines/calendar.ts:30-37 — "The Kernel owns
    // BusinessCalendar, so the deadline monitor never queries that table
    // (CLAUDE.md rule 1) — it is handed the calendar through this port, which
    // the kernel module's public interface implements." That module is merged;
    // its `BusinessCalendar` is read here as the contract, so the two cannot
    // drift apart into a silent adapter nobody maintains.
    const source = path.join(REPO_ROOT, "lib", "modules", "deadlines", "calendar.ts");
    const expected = exportedTypeBlocks({
      path: source,
      relative: path.relative(REPO_ROOT, source),
      module: "deadlines",
      name: "calendar.ts",
      source: readFileSync(source, "utf8"),
    }).find((block) => block.name === "BusinessCalendar");
    expect(expected, "lib/modules/deadlines no longer declares BusinessCalendar").toBeDefined();

    const required = (expected as TypeBlock).members.map((m) => m.name.toLowerCase());
    expect(required.length, "the port's calendar has no members to match").toBeGreaterThan(0);
    const missing = required.filter((name) => !memberNames(calendar()).includes(name));
    expect(
      missing,
      `the kernel's ${calendar().name} cannot satisfy the deadline monitor's CalendarSource`,
    ).toEqual([]);
  });

  it("writes no working week into the source", () => {
    // The mask is a column so that changing the row changes the answer
    // (tests/modules/deadlines/calendar.test.ts pins that). A `[5, 6]` literal
    // in the kernel, or a `day === 5 || day === 6`, is the working week
    // recompiled into code, where Egypt's calendar cannot differ from the UAE's
    // and a Saturday–Sunday jurisdiction cannot exist at all.
    const files = kernelFiles();
    expect(files.length, `no TypeScript under ${KERNEL_DIR} to sweep`).toBeGreaterThan(0);
    const weekend = /\[\s*[056]\s*,\s*[056]\s*\]|===\s*[56]\s*(\|\||&&)|getUTCDay\(\)\s*[<>=]/;
    const offenders = files.flatMap((file) =>
      blankNonCode(file.source)
        .split("\n")
        .map((line, index) => ({ line: line.trim(), number: index + 1 }))
        .filter(({ line }) => weekend.test(line))
        .map(({ line, number }) => `${file.relative}:${number}: ${line}`),
    );
    expect(offenders, "the weekend is data on the calendar, not a constant in the code").toEqual([]);
  });
});

// -------------------------------- what a weekend mask may and may not be --

describe("a weekend mask is a set of weekday numbers", () => {
  // prisma BusinessCalendar.weekendMask — "Non-working weekdays, encoded as day
  // numbers where 0 = Sunday and 6 = Saturday". CLAUDE.md rule 9 — the Gulf week
  // is Sunday to Thursday, so its mask is Friday and Saturday.

  it("accepts the Gulf week", () => {
    // [5, 6] is the mask all five countries this build serves are on. A
    // validator that rejects it rejects the product.
    expect(isWeekendMask([5, 6])).toBe(true);
  });

  it("accepts a Saturday-Sunday week, because a jurisdiction may have one", () => {
    // The mask is data precisely so a non-Gulf jurisdiction is representable —
    // tests/modules/deadlines/calendar.test.ts exercises [0, 6] for GB and US.
    expect(isWeekendMask([0, 6])).toBe(true);
    expect(isWeekendMask([5])).toBe(true);
  });

  it("accepts a seven-day working week, which is an empty mask", () => {
    // tests/modules/deadlines/calendar.test.ts:79-84 — "a calendar with no
    // weekend at all counts plain calendar days". An empty mask is a legitimate
    // calendar, so rejecting it would make that calendar unrepresentable.
    expect(isWeekendMask([])).toBe(true);
  });

  it("rejects a day number that is not a day of the week", () => {
    // 7 is the classic off-by-one against a 1 = Monday encoding; -1 and 0.5 are
    // what an extraction or a hand edit produces. Any of them silently shifts
    // every deadline in that jurisdiction.
    expect(isWeekendMask([7])).toBe(false);
    expect(isWeekendMask([-1])).toBe(false);
    expect(isWeekendMask([5, 7])).toBe(false);
    expect(isWeekendMask([5.5])).toBe(false);
  });

  it("rejects a day number for every value outside 0 to 6, and accepts every one inside", () => {
    // The boundary, both sides, one case per day.
    for (const day of [0, 1, 2, 3, 4, 5, 6]) {
      expect(isWeekendMask([day]), `${day} is a day of the week`).toBe(true);
    }
    for (const day of [-2, -1, 7, 8, 13]) {
      expect(isWeekendMask([day]), `${day} is not a day of the week`).toBe(false);
    }
  });
});

// ------------------------------ rule 4 · the public surface loads --

describe("the kernel's public surface loads", () => {
  // Rule 4 — "A module's public surface is its `index.ts`." Everything above
  // reads that surface as text; these three read it as a module, which is the
  // only thing here that runs kernel code. Importing must not need a database:
  // constructing a PrismaClient opens no socket (tests/kernel/db-client.test.ts),
  // so a module that fails to import is one doing work at module scope.

  async function surfaces(): Promise<{ module: KernelModule; exports: Record<string, unknown> }[]> {
    const modules = requireModules();
    const withIndex = modules.filter((module) => module.index !== undefined);
    if (withIndex.length === 0) {
      throw new Error(`no lib/kernel/*/index.ts among: ${modules.map((m) => m.name).join(", ")}`);
    }
    return Promise.all(
      withIndex.map(async (module) => ({
        module,
        exports: (await import(
          /* @vite-ignore */ pathToFileURL((module.index as { path: string }).path).href
        )) as Record<string, unknown>,
      })),
    );
  }

  it("imports every kernel module without a database", async () => {
    const loaded = await surfaces();
    expect(loaded.length).toBeGreaterThan(0);
  });

  it("gives every kernel module something to export", async () => {
    const empty = (await surfaces())
      .filter(({ exports }) => Object.keys(exports).filter((key) => key !== "default").length === 0)
      .map(({ module }) => module.relative);
    expect(empty, "a module that exports nothing has no public interface").toEqual([]);
  });

  it("leaks no database client or table handle through the surface", async () => {
    // Rule 3 and rule 1 together: exporting the client, or a Prisma delegate,
    // hands every caller the tables directly and makes `// owns:` unenforceable
    // — the boundary check reads repositories, not the callers of an exported
    // `db`.
    const offenders: string[] = [];
    for (const { module, exports } of await surfaces()) {
      for (const [name, value] of Object.entries(exports)) {
        if (value === null || (typeof value !== "object" && typeof value !== "function")) continue;
        const shape = value as Record<string, unknown>;
        const isClient = typeof shape.$connect === "function" || typeof shape.$transaction === "function";
        const isDelegate = typeof shape.findMany === "function" && typeof shape.create === "function";
        if (isClient) offenders.push(`${module.relative} exports the client as ${name}`);
        if (isDelegate) offenders.push(`${module.relative} exports a table handle as ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
