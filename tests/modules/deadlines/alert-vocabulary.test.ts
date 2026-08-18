// Assertions 1, 2 and 3 of
// tasks/backlog.yaml#deadlines-alert-contract-vocabulary:
//
//   "No type on the AlertManager port names a jurisdiction, or any other
//    OpsMind noun"
//   "A caller can read a scope off the port without spelling an OpsMind word"
//   "OpsMind's own storage and inputs still name a jurisdiction, and no
//    migration is required"
//
// ADR-043, verbatim: "The scope field on the alert contract is named `area`,
// matching the `areas` argument ADR-040 already introduced — one vocabulary
// across the port rather than two. `ReportedAlert.area` and `RunScope.area`."
//
// WHY THIS FILE EXISTS AT ALL, given that alert-scope.test.ts and
// alert-failure.test.ts already exercise both types. Those cases are about
// WHERE the scope travels and WHICH areas it names; they read the field through
// helpers and would go on passing if it were renamed back, because a rename is
// invisible to a test that only ever reads the value. ADR-043's claim is about
// the NAME, and nothing was asserting it. The collision is concrete:
// service-alerts-surface-and-lifecycle must satisfy this port exactly while no
// file in it names a jurisdiction, and TypeScript is structural, so reading a
// scope means spelling the field.
//
// ------------------------------------------------------------------------
// THE SCOPE OF THE RULE, AND WHY IT IS NARROW. Read this before widening it.
//
// The rule is about THE TYPES ON THE PORT, not about the module. OpsMind is a
// compliance system for five Gulf jurisdictions and is entitled to know what a
// jurisdiction is (ADR-043, "What is deliberately NOT renamed"). All of the
// following are correct and must keep working:
//
//   · DeadlineInput.jurisdictionId, Registration.jurisdictionId — its own inputs
//   · DeadlineRegistration.jurisdictionId — a database column, not renamed
//   · BusinessCalendar.jurisdictionId, CalendarSource.forJurisdiction
//   · local variables in the sweep, the `context` diagnostic bags, and the
//     human-readable text of a RunScope.reason
//
// So "the word `jurisdiction` appears nowhere in lib/modules/deadlines/" would
// be the WRONG assertion: it would fail honestly-correct code, and of 177
// mentions in the repository exactly two field declarations changed. Every
// sweep below names the three declarations that ARE the port — AlertManager and
// the two types it mentions — and looks at nothing else. The last describe in
// this file asserts the other side of the line on purpose: it FAILS if someone
// widens the rename into OpsMind's own inputs or storage.
// ------------------------------------------------------------------------
//
// HOW THIS FILE READS THE MODULE. The author of these tests read no file under
// lib/modules/deadlines/ as implementation; the pre-change public surface was
// read once, from git, to bind the calls. The declarations below are parsed at
// RUN TIME by the TEST PROCESS, through the same TypeScript-backed reader
// tests/modules/deadlines/repository.test.ts uses, so a member list here is the
// compiler's answer rather than a regular expression's guess.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  REPO_ROOT,
  exportedTypeBlocks,
  type SourceFile,
  type TypeBlock,
} from "@/tests/kernel/kernel-source";
import { fieldNamed, loadSchema, modelNamed } from "@/tests/kernel/prisma-schema";
import {
  fingerprintFor,
  runDeadlineSweep,
  type AlertManager,
  type CalendarSource,
  type DeadlineDeps,
  type DeadlineStore,
  type Registration,
  type ThresholdRule,
} from "@/lib/modules/deadlines";

import { GULF, calendar, d, deadline, threshold } from "./surface";

const MODULE_DIR = path.join(REPO_ROOT, "lib", "modules", "deadlines");

const sorted = (values: Iterable<string>): string[] => [...values].sort();

/** One of the module's files, as the reader wants it. */
function sourceFile(name: string): SourceFile {
  const file = path.join(MODULE_DIR, name);
  if (!existsSync(file)) {
    throw new Error(
      `${path.relative(REPO_ROOT, file)} does not exist, so the sweep below would be empty ` +
        "rather than clean.",
    );
  }
  return {
    path: file,
    relative: path.relative(REPO_ROOT, file),
    module: "deadlines",
    name,
    source: readFileSync(file, "utf8"),
  };
}

const blocksIn = (name: string): TypeBlock[] => exportedTypeBlocks(sourceFile(name));

const blockNamed = (blocks: TypeBlock[], name: string): TypeBlock | undefined =>
  blocks.find((block) => block.name === name);

// ------------------------------------------------------------- the rule --

/**
 * The three declarations that make up the Alert Manager port.
 *
 * `AlertManager` is the port; `ReportedAlert` and `RunScope` are the only types
 * its verbs mention, so a caller cannot satisfy the port without spelling every
 * member of all three. Nothing else in index.ts is in scope here — see the
 * header. If a fourth type is ever added to a signature on this port, it belongs
 * in this list, and the "mentions nothing outside this list" case below is what
 * will say so.
 */
const PORT_TYPES = ["AlertManager", "ReportedAlert", "RunScope"];

/**
 * Words only OpsMind knows.
 *
 * A floor, not a ceiling: `jurisdiction` is the one ADR-043 decided, and the
 * rest are the nouns from this build's own domain that would be the next ones to
 * leak. Deliberately NOT here: `entity`, `source`, `policy`, `severity`,
 * `fingerprint`, `context` and `alert`, which are the ALERT ENGINE's own
 * vocabulary — the fingerprint is `{tenant}:{app}:{source}:{entity}:{policy}`
 * (flows-alerting.md), so an engine naming an entity is naming its own concept,
 * not OpsMind's.
 */
const OPSMIND_NOUNS = [
  "jurisdiction",
  "emirate",
  "deadline",
  "registration",
  "threshold",
  "calendar",
  "holiday",
  "document",
  "invoice",
  "settlement",
  "payroll",
  "expense",
  "timesheet",
];

const nounsIn = (text: string): string[] =>
  OPSMIND_NOUNS.filter((noun) => text.toLowerCase().includes(noun));

/**
 * Every OpsMind noun a declaration carries, as `where → noun`.
 *
 * Three surfaces per block, because a caller has to spell all three: the type's
 * own name, each member's name, and the text of each member's type — which for
 * an interface method is its whole parameter list, so `raiseAlert(…, areas, …)`
 * is checked here and not only in the fake that calls it.
 *
 * Comments are already gone: `exportedTypeBlocks` reads the compiler's token
 * stream with comments blanked, so a doc comment saying "the jurisdiction whose
 * calendar scores it" is not a finding. That matters — the port's members are
 * documented in exactly those terms and should be.
 */
function opsmindNouns(block: TypeBlock): string[] {
  const found = nounsIn(block.name).map((noun) => `${block.name} (the type's own name) → ${noun}`);
  for (const member of block.members) {
    for (const noun of nounsIn(member.name)) {
      found.push(`${block.name}.${member.name} → ${noun}`);
    }
    for (const noun of nounsIn(member.type)) {
      found.push(`${block.name}.${member.name}'s signature ${member.type.trim()} → ${noun}`);
    }
  }
  return found;
}

describe("the AlertManager port carries no OpsMind noun", () => {
  const ports = (): TypeBlock[] => {
    const blocks = blocksIn("index.ts");
    return PORT_TYPES.map((name) => {
      const found = blockNamed(blocks, name);
      if (found === undefined) {
        throw new Error(
          `${name} is not an exported type of lib/modules/deadlines/index.ts. ` +
            `Exported: ${blocks.map((block) => block.name).join(", ") || "nothing"}. ` +
            "ADR-039 makes this port a package another codebase imports, so it is public or " +
            "it is not a port.",
        );
      }
      return found;
    });
  };

  it("declares all three port types, with members, so this is not an empty sweep", () => {
    // A source-reading assertion that finds nothing passes. Every case below is
    // a claim about these members, so their absence has to be the failure.
    for (const block of ports()) {
      expect(block.members.length, `${block.name} parsed with no members at all`).toBeGreaterThan(0);
    }
  });

  it("names the scope `area` on both types that carry one", () => {
    // ADR-043: "`ReportedAlert.area` and `RunScope.area`." The positive half of
    // the rule, and the one that fails if the field is deleted rather than
    // renamed — a port with no scope at all would satisfy "no OpsMind noun"
    // while making resolution by absence unsound (ADR-040(1)).
    for (const name of ["ReportedAlert", "RunScope"]) {
      const block = ports().find((candidate) => candidate.name === name) as TypeBlock;
      const area = block.members.find((member) => member.name === "area");
      expect(
        area,
        `${name} declares no \`area\`. It declares: ${block.members.map((m) => m.name).join(", ")}`,
      ).toBeDefined();
      expect((area as { type: string }).type, `${name}.area must be a plain string key`).toContain(
        "string",
      );
      expect((area as { optional: boolean }).optional, `${name}.area is not optional: an alert with no scope could never be resolved by absence`).toBe(false);
    }
  });

  it("names no OpsMind noun in any member, or any argument, of the port", () => {
    // The rule ADR-043 decided, applied to exactly the three declarations that
    // are the port and to nothing else in the module. `jurisdictionId` here is
    // the case that was found; the rest of OPSMIND_NOUNS is the same fault
    // arriving under a different word.
    const offenders = ports().flatMap(opsmindNouns);
    expect(
      offenders,
      "ADR-043: the port is lent to other applications, and a caller cannot satisfy it " +
        "without spelling these names in its own source",
    ).toEqual([]);
  });

  it("mentions no type outside the three, so the sweep above is the whole port", () => {
    // The completeness guard for PORT_TYPES. A fourth type introduced into a
    // signature — `scopes: readonly JurisdictionScope[]` — would carry its
    // members past the sweep above, because the sweep only looks at three
    // declarations. Every capitalised name a port signature mentions must
    // therefore be either one of the three or a built-in.
    // `Severity` is here rather than in PORT_TYPES because it is a union of
    // string literals with no members to sweep, and because a severity level is
    // the alert engine's OWN concept, not one OpsMind is lending it.
    const NOT_A_SHAPE = ["Promise", "Record", "Date", "Array", "ReadonlyArray", "Severity"];
    const port = ports().find((block) => block.name === "AlertManager") as TypeBlock;
    const mentioned = port.members
      .flatMap((member) => member.type.match(/\b[A-Z]\w*/g) ?? [])
      .filter((name) => !NOT_A_SHAPE.includes(name) && !PORT_TYPES.includes(name));
    expect(
      sorted(new Set(mentioned)),
      "a type on the port that this file does not sweep. Add it to PORT_TYPES — " +
        "or, if it carries no members of its own, to NOT_A_SHAPE.",
    ).toEqual([]);
  });

  it("would notice: the same rule flags the declarations as they stood before ADR-043", () => {
    // The detector's own test. Everything above is an assertion that a sweep
    // found NOTHING, which is also what a broken reader returns, so the rule is
    // pointed at the shape it was written to reject. The text is the pre-ADR-043
    // declaration, quoted from git history rather than from any file.
    const before: SourceFile = {
      path: "(pre-ADR-043)",
      relative: "(pre-ADR-043)",
      module: "deadlines",
      name: "index.ts",
      source: [
        "export interface ReportedAlert {",
        "  fingerprint: string;",
        "  severity: Severity;",
        "  /** The completeness scope it was scored in. */",
        "  jurisdictionId: string;",
        "}",
        "export interface RunScope {",
        "  jurisdictionId: string;",
        "  complete: boolean;",
        "}",
      ].join("\n"),
    };
    const flagged = exportedTypeBlocks(before).flatMap(opsmindNouns);
    expect(flagged).toEqual([
      "ReportedAlert.jurisdictionId → jurisdiction",
      "RunScope.jurisdictionId → jurisdiction",
    ]);
  });
});

// ------------------------------------------------ a caller in generic terms --

/**
 * The vocabulary a second codebase has. Nothing here is an OpsMind word, and
 * none of it is imported from OpsMind — these are the shapes an alert engine
 * would declare for itself, having read only ADR-040 and ADR-043.
 */
type GenericAlert = { fingerprint: string; severity: string; area: string };
type GenericScope = { area: string; complete: boolean };

/**
 * An Alert Manager that knows only about areas.
 *
 * It models the one thing the scope exists for: absence from a report resolves
 * an alert ONLY inside an area the run declared complete (flows-alerting.md:47).
 * It does that by comparing `alert.area` to `scope.area` and by nothing else —
 * no context bag, no registry of jurisdictions, no OpsMind import.
 */
function genericEngine() {
  const seen: GenericAlert[] = [];
  const declared: GenericScope[] = [];
  const raisedAreas: string[][] = [];

  const port = {
    reportRun(
      _sourceId: string,
      _runId: string,
      alerts: readonly GenericAlert[],
      scopes: readonly GenericScope[],
    ): Promise<void> {
      seen.push(...alerts);
      declared.push(...scopes);
      return Promise.resolve();
    },
    /**
     * The context bag is not even DECLARED here, which is deliberate: an engine
     * that never names the parameter demonstrably cannot dig a scope out of it
     * (ADR-040(2), ADR-039). A shorter parameter list still satisfies the port.
     */
    raiseAlert(
      _fingerprint: string,
      _severity: string,
      _policyId: string,
      areas: readonly string[],
    ): Promise<void> {
      raisedAreas.push([...areas]);
      return Promise.resolve();
    },
  };

  /**
   * THE COMPILE-LEVEL ASSERTION, and the reason there is no cast on this line.
   * A generic engine satisfies the port structurally or it does not compile:
   * with the scope named `jurisdictionId`, neither GenericAlert nor
   * ReportedAlert is assignable to the other, and `npm run typecheck` fails
   * right here. The runtime cases below fail for the same reason under vitest,
   * which does not typecheck — `alert.area` is `undefined` on the old shape.
   */
  const bound: AlertManager = port;

  return {
    port: bound,
    alerts: () => seen,
    scopes: () => declared,
    raisedAreas: () => raisedAreas,
    areasDeclared: () => declared.map((scope) => scope.area),
    completeAreas: () => declared.filter((scope) => scope.complete).map((scope) => scope.area),
    /** Would absence from this report have resolved an alert in `area`? */
    resolvesIn: (area: string): boolean =>
      declared.some((scope) => scope.area === area && scope.complete),
    areaOf: (fingerprint: string): string | undefined =>
      seen.find((alert) => alert.fingerprint === fingerprint)?.area,
  };
}

const WATCHED = "expiry";
const TODAY = d("2026-08-16");
/** Four business days out under the Gulf week — inside the ten-day window. */
const DUE = d("2026-08-20");

function depsFor(registrations: Registration[], calendars: string[], alerts: AlertManager): DeadlineDeps {
  const rows = [...registrations];
  const thresholds: ThresholdRule[] = [threshold(WATCHED, 10, "major")];
  const store: DeadlineStore = {
    upsertRegistration: (input) => Promise.resolve({ id: "x", ...input }),
    deleteRegistration: () => Promise.resolve(),
    listRegistrations: () => Promise.resolve([...rows]),
    listThresholds: () => Promise.resolve([...thresholds]),
  };
  const source: CalendarSource = {
    forJurisdiction: (id) =>
      Promise.resolve(calendars.includes(id) ? calendar(id, GULF) : null),
  };
  return {
    tenant: "reno",
    store,
    calendars: source,
    alerts,
    now: () => TODAY,
    runId: () => "r9",
  };
}

describe("a caller that speaks no OpsMind can read a scope and a reported alert", () => {
  // Assertion 2 of the node, and the whole reason ADR-043 was worth a second
  // edit to a merged module. The engine below is written the way
  // service-alerts-surface-and-lifecycle will have to write its client: it never
  // says "jurisdiction", and it still places every alert.
  //
  // AE holds a breaching deadline and has a calendar. BH holds one months out
  // and has a calendar. KW has a registration and NO calendar, so it is the
  // area the run could not finish.
  const run = async () => {
    const engine = genericEngine();
    await runDeadlineSweep(
      depsFor(
        [
          deadline("document:1", WATCHED, DUE, "AE"),
          deadline("document:2", WATCHED, d("2026-12-31"), "BH"),
          deadline("document:3", WATCHED, DUE, "KW"),
        ],
        ["AE", "BH"],
        engine.port,
      ),
    );
    return engine;
  };

  it("is told about every area the run visited, reading only `area`", async () => {
    const engine = await run();
    expect(engine.scopes(), "the run declared no scopes at all").not.toHaveLength(0);
    expect(sorted(engine.areasDeclared())).toEqual(["AE", "BH", "KW"]);
  });

  it("can tell a finished area from an unfinished one without asking what an area is", async () => {
    // The lifecycle claim. `resolvesIn` compares two `area` strings; if it can
    // answer this, an engine holding yesterday's open alerts can resolve by
    // absence correctly, which is what flows-alerting.md:47 requires.
    const engine = await run();
    expect(sorted(engine.completeAreas())).toEqual(["AE", "BH"]);
    expect(engine.resolvesIn("BH"), "BH was scored end to end").toBe(true);
    expect(engine.resolvesIn("KW"), "KW has no calendar; nothing in it was scored").toBe(false);
  });

  it("can place a reported breach in an area", async () => {
    const engine = await run();
    expect(engine.alerts(), "the run reported no breach to place").not.toHaveLength(0);
    // The fingerprint is built with the module's own public helper rather than
    // spelled out here: its segment encoding is pinned by thresholds.test.ts,
    // and this case is about the AREA, not about the identity.
    expect(engine.areaOf(fingerprintFor("reno", "document", "1", WATCHED))).toBe("AE");
  });

  it("is never told about an alert in an area it was not also told about", async () => {
    // The soundness invariant the field exists to serve, stated generically: an
    // alert whose area is absent from the declaration — or empty, or undefined —
    // can be neither resolved nor left open on purpose.
    const engine = await run();
    const areas = engine.areasDeclared();
    for (const alert of engine.alerts()) {
      expect(typeof alert.area, `${alert.fingerprint} arrived with no area`).toBe("string");
      expect(areas, `${alert.fingerprint} names an area the run never declared`).toContain(alert.area);
    }
  });

  it("hears the out-of-band alert in the same vocabulary", async () => {
    // ADR-040(2) put `areas` on raiseAlert for this reason; ADR-043 made
    // reportRun's side match it. Both halves in one vocabulary is the decision.
    const engine = await run();
    expect(engine.raisedAreas(), "KW has no calendar and should have raised one alert").toEqual([
      ["KW"],
    ]);
  });
});

// ------------------------------------------- the other side of the line --

describe("OpsMind still names a jurisdiction where it is entitled to", () => {
  // ADR-043, "What is deliberately NOT renamed": "OpsMind is entitled to know
  // what a jurisdiction is — it is a compliance system for five Gulf
  // jurisdictions. The rule was only ever about the component being lent to
  // other applications."
  //
  // These cases fail if the rename is WIDENED. That is their whole job: the next
  // person to read the file above will be tempted to apply the rule to the
  // module, and two of the four assertions on this node say they must not.

  it("keeps jurisdictionId on the module's own input type", () => {
    const input = blockNamed(blocksIn("index.ts"), "DeadlineInput");
    expect(input, "DeadlineInput is not exported from index.ts").toBeDefined();
    expect(
      (input as TypeBlock).members.map((member) => member.name),
      "DeadlineInput is OpsMind's own argument, not the alert port. ADR-043 leaves it alone.",
    ).toContain("jurisdictionId");
  });

  it("keeps jurisdictionId on the business calendar", () => {
    const cal = blockNamed(blocksIn("calendar.ts"), "BusinessCalendar");
    expect(cal, "BusinessCalendar is not declared in calendar.ts").toBeDefined();
    expect((cal as TypeBlock).members.map((member) => member.name)).toContain("jurisdictionId");
  });

  it("keeps the column, and adds none beside it — which is why no migration is required", () => {
    // ADR-043: "There is no migration and nothing about how anything is stored
    // changes." A second column named `area` would be a migration by another
    // name, so both halves are asserted.
    const model = modelNamed(loadSchema(), "DeadlineRegistration");
    expect(model, "DeadlineRegistration is missing from prisma/schema.prisma").toBeDefined();
    expect(
      fieldNamed(model as NonNullable<typeof model>, "jurisdictionId"),
      "the storage column is not the port and was not renamed",
    ).toBeDefined();
    expect(
      fieldNamed(model as NonNullable<typeof model>, "area"),
      "a new `area` column means a migration, and ADR-043 says there is none",
    ).toBeUndefined();
  });
});
