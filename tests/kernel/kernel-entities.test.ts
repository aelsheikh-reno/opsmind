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
// Scope: the split is closed. kernel-entities-law landed Jurisdiction with its
// calendar, Regime and JurisdictionEnrolment; kernel-entities-parties brings
// Person, Document and LegalEntity, and with them the cases carried out of this
// file rather than deleted. They return unchanged.
//
// One question the spec does not settle is genuinely left open here: whether a
// cyclic org chart throws or truncates. Both readings pass.
//
// The other is NOT open, and saying it was would have been false. Whether a
// manager chain includes the person themself IS decided — it does not — and
// three cases below depend on that. Review proved it by mutation: prepending
// the person fails "returns everybody above a person and nobody beside them",
// "stops at a manager who is not in the list", and "a person is not above
// themself". The promise made when these cases were carried out of
// kernel-entities-law was that the question would stay open; it did not, and
// the honest fix is to say so rather than neuter three assertions to match a
// comment. Neither the spec nor the legacy schema settles it — `managerId` does
// not exist in reference/legacy at all — so this is a decision made in code and
// it is flagged for Ahmed, not defended as derived.
//
// No other file under `lib/kernel/` was read by the author. The declarations
// swept below are read by the test process, from `index.ts` and the
// declarations it re-exports, and never from a function body.
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { managerChain, type Person } from "@/lib/kernel/person";
import { isWeekendMask } from "@/lib/kernel/jurisdiction";
import { documentAmount, type Document } from "@/lib/kernel/document";
import {
  KERNEL_DIR,
  blankNonCode,
  exportedTypeBlocks,
  kernelFiles,
  kernelModules,
  kernelPublicDeclarations,
  publicDeclarations,
  exportedDeclarations,
  reExports,
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

// ---- Jurisdiction exposes a business calendar --------------------------------

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

// ---- a weekend mask is a set of weekday numbers ------------------------------

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

// ---- the kernel's public surface loads ---------------------------------------

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

describe("Person carries managerId", () => {
  it("declares managerId on the kernel's public surface", () => {
    // components-kernel.md:9 — "+ managerId (org chart, required to resolve
    // approvers)". A person shape without it cannot answer "who approves this",
    // which is the reason the field was added.
    const person = typeWith("managerId");
    expect(memberNames(person)).toContain("managerid");
  });

  it("names one manager, not a list of them", () => {
    // "Org chart — required to resolve who approves what" (data-model.md:123).
    // A list makes the approver question ambiguous rather than answered.
    const managerId = member(typeWith("managerId"), "managerId");
    expect(
      isCollectionOf(managerId.type, "string") || managerId.type.includes("[]"),
      `managerId is declared \`${managerId.type}\``,
    ).toBe(false);
  });

  it("lets the top of the org chart have no manager", () => {
    // `managerId String?` in the schema, and necessarily so: somebody reports to
    // nobody. A required managerId makes the root unrepresentable and invites a
    // self-reference, which turns approver resolution into a cycle.
    const managerId = member(typeWith("managerId"), "managerId");
    expect(
      canBeAbsent(managerId.type, managerId.optional),
      `managerId is declared \`${managerId.type}\` and required`,
    ).toBe(true);
  });

  it("identifies the manager by id, not by an inlined person", () => {
    // "→ Person" is a foreign key. A nested person object on the surface makes
    // every read of a person a read of the whole chain above them.
    const managerId = member(typeWith("managerId"), "managerId");
    expect(managerId.type).toMatch(/\bstring\b/);
  });
});

// ---- Person supports per-jurisdiction enrolments -----------------------------

describe("Person supports per-jurisdiction enrolments", () => {
  // data-model.md:124 — "Social insurance and tax identifiers, per
  // jurisdiction, with validity dates". The shape is PersonEnrolment: a person,
  // a jurisdiction, an obligation type, an identifier and a validity window.

  it("declares an enrolment shape tied to a person and a jurisdiction", () => {
    const enrolment = typeWith("personId", "jurisdictionId");
    expect(memberNames(enrolment)).toEqual(
      expect.arrayContaining(["personid", "jurisdictionid"]),
    );
  });

  it("carries the identifier the enrolment exists to record", () => {
    // "SI and tax identifiers" (components-kernel.md:9). An enrolment row with
    // no identifier records that somebody is registered without recording as
    // what, which answers no payroll or filing question.
    const enrolment = typeWith("personId", "jurisdictionId");
    expect(memberNames(enrolment), `${enrolment.name} holds no identifier`).toContain("identifier");
  });

  it("carries validity dates, with an end that may be open", () => {
    // "with validity dates" — an enrolment must be answerable for a given
    // payroll month, so the start is required; a registration in force today has
    // no end, so a required end forces a sentinel far-future date.
    const enrolment = typeWith("personId", "jurisdictionId");
    const from = member(enrolment, "activeFrom");
    const to = member(enrolment, "activeTo");
    expect(canBeAbsent(from.type, from.optional), "an enrolment valid from no date").toBe(false);
    expect(canBeAbsent(to.type, to.optional), `activeTo is \`${to.type}\` and required`).toBe(true);
  });

  it("says which obligation the person is enrolled under", () => {
    // A person can hold a social-insurance number and a tax identifier in the
    // same jurisdiction; without the obligation type they are one
    // undifferentiated bag and neither can be looked up.
    const enrolment = typeWith("personId", "jurisdictionId");
    expect(memberNames(enrolment)).toContain("obligationtype");
  });

  it("keeps the person-level enrolment distinct from the entity-level one", () => {
    // components-kernel.md:9 adds person-level enrolments; :14 keeps
    // JurisdictionEnrolment for entities and counterparties — "a UAE VAT invoice
    // carries the customer's TRN". One shape serving both is how a person's
    // social-insurance number and a company's TRN end up in the same table,
    // which is the merge data-model.md:166 exists to undo.
    const person = typeWith("personId", "jurisdictionId");
    const entity = typeWith("legalEntityId", "regimeId");
    expect(entity.name).not.toBe(person.name);
    expect(memberNames(entity)).toContain("identifier");
  });

  it("exposes a person's enrolments through the PERSON module's surface", () => {
    // Rule 1 — "Cross-module access goes through the owning module's public
    // interface." Payroll needs an Egyptian SI number; if the only way to it is
    // the table, the boundary is not reachable.
    //
    // Scoped to the person module deliberately. Sweeping the whole kernel for
    // /enrol/ could never fail: lib/kernel/enrolment/ exports
    // JurisdictionEnrolment, listEnrolments and recordEnrolment, and satisfies
    // the filter whatever Person does. Review proved it — deleting Person's
    // entire enrolment API left the suite green. A different module's exports
    // are not this assertion's evidence.
    // Read from index.ts's export list, not from publicDeclarations(). That
    // helper follows `from "./repository"` and takes the whole file, so it
    // cannot tell `export { a }` from `export *` — it reports every function in
    // the repository whether index.ts names it or not, and a test built on it
    // stays green while the surface loses the API. Proven: removing both
    // enrolment functions from the export block left publicDeclarations at 11.
    //
    // A CALLABLE, not merely a type: exporting the PersonEnrolment shape tells
    // a caller what one looks like, it does not give them one.
    const person = kernelModules().find((module) => module.name === "person");
    expect(person, "there is no person module under lib/kernel").toBeDefined();
    const index = person!.files.find((file) => file.relative.endsWith("index.ts"));
    expect(index, "the person module has no index.ts").toBeDefined();

    // A star re-export genuinely exposes everything the target declares, so it
    // contributes the target's names rather than nothing. Treating it as empty
    // would fail an index.ts written `export * from "./repository"` — which does
    // expose listPersonEnrolments to every caller — and the message would send
    // the reader somewhere wrong.
    const callableNames = publicDeclarations(person!).map((d: Declaration) => d.name);
    const exported = new Set(
      reExports(index!.source).flatMap((re) => (re.star ? callableNames : re.names)),
    );
    for (const declaration of exportedDeclarations(index!)) exported.add(declaration.name);
    expect(exported.size, "index.ts exports nothing by name").toBeGreaterThan(0);

    const callable = new Map(
      publicDeclarations(person!)
        .filter((d: Declaration) => /\(/.test(d.signature))
        .map((d: Declaration) => [d.name, d.signature] as const),
    );
    const enrolmentApi = [...exported].filter((name) => /enrol/i.test(name) && callable.has(name));
    expect(
      enrolmentApi,
      "the person module's index.ts exposes no enrolment FUNCTION — payroll would have to read the table",
    ).not.toEqual([]);
  });
});

// ---- the org chart managerId exists to make walkable -------------------------

describe("the org chart managerId exists to make walkable", () => {
  // components-kernel.md:9 — managerId is there because the org chart is
  // "required to resolve approvers". The public surface exposes `managerChain`,
  // so the assertion can be tested as behaviour rather than as a field name.
  //
  // ORDERING AND THE CYCLE CASE ARE DELIBERATELY NOT PINNED TO ONE ANSWER.
  // Neither components-kernel.md nor data-model.md says whether the chain reads
  // nearest-first or furthest-first, nor what a cyclic chart should do. So these
  // pin what the spec does settle — which people are above whom, that a walk is
  // a walk, and that a corrupt chart cannot loop forever — and leave the rest to
  // Ahmed rather than inventing a rule (CLAUDE.md, Working style).

  const person = (id: string, managerId: string | null): Person => ({
    id,
    name: id,
    email: null,
    jobTitle: null,
    department: null,
    nationality: null,
    managerId,
    contractStart: null,
    contractEnd: null,
    exitDate: null,
    exitReason: null,
    employmentType: "fulltime",
    weeklyHours: "40",
    payslipInContractCurrency: false,
    documentId: null,
  });

  // A three-level chart plus somebody unrelated: engineer -> lead -> director.
  const director = person("director", null);
  const lead = person("lead", "director");
  const engineer = person("engineer", "lead");
  const unrelated = person("unrelated", "director");
  const chart = [engineer, lead, director, unrelated];

  it("returns everybody above a person and nobody beside them", () => {
    const ids = managerChain(chart, "engineer").map((who) => who.id);
    expect([...ids].sort()).toEqual(["director", "lead"]);
    expect(ids, "a peer is not an approver").not.toContain("unrelated");
  });

  it("returns a chain, not a set — each step is a managerId link", () => {
    const chain = managerChain(chart, "engineer");
    expect(chain.length).toBeGreaterThan(1);
    for (let i = 1; i < chain.length; i += 1) {
      const linked = chain[i].id === chain[i - 1].managerId || chain[i - 1].id === chain[i].managerId;
      expect(linked, `${chain[i - 1].id} and ${chain[i].id} are not manager and report`).toBe(true);
    }
  });

  it("has nobody above the top of the chart", () => {
    // `managerId` is null at the root (schema: `managerId String?`). Whether the
    // chain includes the person themself is unsettled, so this asserts only that
    // nobody ELSE is above the director.
    const others = managerChain(chart, "director").filter((who) => who.id !== "director");
    expect(others.map((who) => who.id)).toEqual([]);
  });

  it("stops at a manager who is not in the list it was given", () => {
    // A caller holding one department's people must get that department's answer,
    // not an exception. The chain simply ends where the data does.
    const partial = [engineer, lead];
    expect(managerChain(partial, "engineer").map((who) => who.id)).toEqual(["lead"]);
  });

  it("answers for somebody who is not in the chart at all", () => {
    expect(managerChain(chart, "nobody")).toEqual([]);
  });

  it("cannot loop forever on a cyclic chart", () => {
    // The boundary case that matters operationally: a mis-entered chart where
    // two people manage each other. An approver lookup must not hang and must
    // not report the same approver twice. Rule 8 — a chart that loops is wrong,
    // and quietly returning something plausible is the one outcome that is not
    // allowed. Either refusing or answering finitely satisfies the spec; hanging
    // does not, and this test would time out if it did.
    const a = person("a", "b");
    const b = person("b", "a");
    let chain: Person[] | undefined;
    try {
      chain = managerChain([a, b], "a");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      return;
    }
    const ids = chain.map((who) => who.id);
    expect(new Set(ids).size, `the chain repeats: ${ids.join(" -> ")}`).toBe(ids.length);
  });

  it("holds four invariants over every chart, not just this one", () => {
    // A property test rather than another example. The chart is generated so
    // that everybody reports to somebody earlier in the list, which is what
    // makes it acyclic; the four claims are the definition of "the managers
    // above a person" (data-model.md:123) and hold for any chart shaped that
    // way. A deterministic generator, so a failure is reproducible.
    // xorshift32 rather than a multiply-and-modulo: in JavaScript the classic
    // linear congruential form loses its low bits past 2^53 and degenerates,
    // which the guard at the end of this test caught doing exactly that.
    let seed = 20260814 >>> 0;
    const random = (bound: number): number => {
      seed ^= seed << 13;
      seed >>>= 0;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      seed >>>= 0;
      return seed % bound;
    };
    let deepest = 0;
    for (let trial = 0; trial < 50; trial += 1) {
      const size = 2 + random(8);
      const people = Array.from({ length: size }, (_, index) =>
        person(`p${index}`, index === 0 ? null : `p${random(index)}`),
      );
      const start = people[random(size)];
      const chain = managerChain(people, start.id);
      const ids = chain.map((who) => who.id);

      expect(new Set(ids).size, `repeats: ${ids.join(" -> ")}`).toBe(ids.length);
      expect(ids, "a person is not above themself").not.toContain(start.id);
      if (start.managerId !== null) {
        expect(ids, `${start.id}'s own manager is missing`).toContain(start.managerId);
      } else {
        expect(ids, `${start.id} reports to nobody`).toEqual([]);
      }
      for (const who of chain) {
        const linked = who.id === start.managerId || ids.includes(who.managerId ?? "") ||
          chain.some((other) => other.managerId === who.id);
        expect(linked, `${who.id} is in ${start.id}'s chain without a link to it`).toBe(true);
      }
      deepest = Math.max(deepest, chain.length);
    }
    // The generator has to have produced something to walk; fifty empty charts
    // would satisfy every claim above without testing one of them.
    expect(deepest, "every generated chart was flat — nothing was walked").toBeGreaterThan(1);
  });

  it("cannot loop on a person who manages themself", () => {
    const self = person("self", "self");
    let chain: Person[] | undefined;
    try {
      chain = managerChain([self], "self");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      return;
    }
    expect(chain.filter((who) => who.id === "self").length).toBeLessThanOrEqual(1);
  });
});

// ---- a document's amount carries its own direction ---------------------------

describe("a document's amount carries its own direction", () => {
  // CLAUDE.md rule 6 — "Money has a direction. Every invoice, open item and
  // settlement carries `inbound` or `outbound`. Never infer it from context."
  // components-kernel.md:10 — direction "fixes supplier bills counted as
  // income". data-model.md:133 — NOT NULL, for the same reason.

  const document = (over: Partial<Document>): Document => ({
    id: "doc",
    filename: "invoice.pdf",
    mimeType: "application/pdf",
    source: "upload",
    status: "processed",
    direction: "inbound",
    docType: null,
    confidence: null,
    legalEntityId: null,
    issueDate: null,
    expiryDate: null,
    renewalDeadline: null,
    amount: null,
    vatAmount: null,
    currency: null,
    referenceNumber: null,
    filePath: null,
    fileHash: null,
    ...over,
  });

  it("reports an inbound document's value as inbound", () => {
    const money = documentAmount(document({ direction: "inbound", amount: "1000.00", currency: "AED" }));
    expect(money).toEqual({ amount: "1000.00", currency: "AED", direction: "inbound" });
  });

  it("does not let two identical amounts differing only in direction come out the same", () => {
    // The defect in one line: a supplier bill and a client invoice for the same
    // figure must not be indistinguishable. This is rule 6 as a property, and it
    // holds whatever the representation of a signed amount turns out to be.
    const inbound = documentAmount(document({ direction: "inbound", amount: "5000", currency: "AED" }));
    const outbound = documentAmount(document({ direction: "outbound", amount: "5000", currency: "AED" }));
    expect(inbound).not.toEqual(outbound);
    expect(outbound?.direction).toBe("outbound");
  });

  it("keeps the amount exactly as extracted, in a currency that is not the entity's own", () => {
    // "amount, currency | decimal, ISO-4217" (data-model.md) and the schema's
    // `Decimal(18, 3)`. An EGP bill against an AED entity must not be converted
    // here — FX is a snapshot taken at settlement (components-kernel.md:16) —
    // and 1234.567 must survive with all three decimals, which is why the
    // surface carries an exact decimal string rather than a float.
    const money = documentAmount(document({ direction: "outbound", amount: "1234.567", currency: "EGP" }));
    expect(money?.amount).toBe("1234.567");
    expect(money?.currency).toBe("EGP");
  });

  it("keeps a zero amount, which is not the same as no amount", () => {
    // A zero-rated invoice is a real document with a real value of zero. Losing
    // it to a falsy check is the classic version of this defect.
    expect(documentAmount(document({ amount: "0", currency: "AED" }))?.amount).toBe("0");
  });

  it("refuses to answer when there is no amount", () => {
    // `amount` is nullable in the schema: a document can be filed before its
    // value is extracted.
    expect(documentAmount(document({ amount: null, currency: "AED" }))).toBeNull();
  });

  it("refuses to answer when there is an amount but no currency", () => {
    // Rule 8 — "Never guess when confidence is low." A bare number is not money,
    // and defaulting the currency to the house one turns a gap in an extraction
    // into a wrong figure in a cash forecast that nothing marks as uncertain.
    expect(documentAmount(document({ amount: "1000", currency: null }))).toBeNull();
  });
});

