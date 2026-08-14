// The kernel Prisma schema — tests written from the specification alone.
// `prisma/schema.prisma` and `prisma/migrations/` were deliberately NOT read
// while writing this file: the schema is written by another agent in parallel,
// and a test retrofitted to it would describe what was written rather than what
// the spec requires. Everything below traces to a line of
// `docs/architecture/data-model.md`, `components-kernel.md`,
// `data-retention.md`, `data-ownership.md`, `security-authentication.md`,
// `decisions.md` or `CLAUDE.md`, cited at the test.
//
// `data-model.md:17` — "Field names in `monospace` are literal column names" —
// is what makes literal names below fair game rather than guesses.
//
// The schema arrives in two slices. `kernel-schema-base` landed the calendar,
// the law, the parties and the document; `kernel-schema-people-registry` lands
// people, accounts, the registry, FX and audit. Both sets of assertions live in
// this one file, because the two rules that are schema-*wide* — no paid
// boolean, and a direction is never nullable wherever it appears — have to be
// enforced over every model at once or they stop meaning anything.
//
// Assertion map (tasks/backlog.yaml#kernel-schema-base):
//   1. "Document carries a direction and it is not nullable"
//      -> "Document · direction" (all five cases)
//   2. "No isPaid or equivalent boolean exists anywhere in the schema"
//      -> "payment state is never a boolean" (all four cases)
//   3. "JurisdictionEnrolment is unique on (legalEntityId, regimeId)"
//      -> "JurisdictionEnrolment · one registration per entity per regime"
//   4. "Jurisdiction carries a business calendar with a weekend mask"
//      -> "Jurisdiction · business calendar"
//
// Assertion map (tasks/backlog.yaml#kernel-schema-people-registry):
//   1. "Person carries managerId and per-jurisdiction enrolments with validity
//      dates" -> "Person · the org chart" and "PersonEnrolment"
//   2. "DocumentType carries field schema, retention years and basis, and an
//      erasure mode of exactly redact_personal or full_delete"
//      -> "DocumentType registry"
//   3. "FxRate stores rate as a decimal with an asOf date, never a float"
//      -> "FxRate" (plus the schema-wide "no money column is a binary float")
//   4. "The audit log is append-only; erasure redacts rather than deletes"
//      -> "the append-only audit log"
//   5. "No isPaid or equivalent boolean, and no nullable direction, is
//      introduced by these models" -> already enforced schema-wide by
//      "payment state is never a boolean" and "every direction in the schema is
//      non-nullable...", both of which sweep every model in the file. The one
//      case those sweeps cannot catch is a model that never arrives, so
//      "the schema-wide sweeps see every model this slice adds" pins the
//      coverage rather than duplicating the sweeps per model.
//
// Scope: the required models are the kernel ones — data-model.md's "Kernel
// additions" section plus the tables in components-kernel.md and the kernel row
// of data-ownership.md. The financial spine (OpenItem, Settlement, TaxFiling,
// the schedule tables) carries its own hard constraints in the same spec; those
// belong to the module schema tasks and are not required to exist here.
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MIGRATIONS_DIR,
  SCHEMA_PATH,
  blockAttributes,
  enumNamed,
  everyField,
  fieldNamed,
  hasAttribute,
  loadSchema,
  locate,
  modelNamed,
  normalise,
  normalisedValues,
  sameFieldSet,
  type PrismaBlock,
  type PrismaField,
  type PrismaSchema,
} from "@/tests/kernel/prisma-schema";

let cached: PrismaSchema | undefined;

/**
 * The schema, parsed. Throws — loudly, inside whichever test asked for it — if
 * the file is missing or empty, so a missing schema fails every assertion
 * rather than skipping them.
 */
function schema(): PrismaSchema {
  cached ??= loadSchema();
  return cached;
}

function requireModel(name: string): PrismaBlock {
  const found = modelNamed(schema(), name);
  if (found === undefined) {
    const names = schema().models.map((model) => model.name).join(", ");
    throw new Error(`model ${name} is missing from the schema. Models present: ${names || "none"}`);
  }
  return found;
}

function requireField(model: PrismaBlock, name: string): PrismaField {
  const found = fieldNamed(model, name);
  if (found === undefined) {
    const names = model.fields.map((field) => field.name).join(", ");
    throw new Error(
      `${model.name}.${name} is missing. Fields on ${model.name}: ${names || "none"}`,
    );
  }
  return found;
}

/** The enum a field is typed as — a field typed `String` has no closed set. */
function closedSetOf(field: PrismaField): PrismaBlock {
  const found = enumNamed(schema(), field.type);
  if (found === undefined) {
    throw new Error(
      `${field.name} is typed \`${field.type}\`, which is not an enum declared in the schema. ` +
        "The spec gives this field a fixed list of values, which only an enum enforces.",
    );
  }
  return found;
}

/** A field whose name matches, for the shapes the spec names in prose. */
function fieldMatching(model: PrismaBlock, pattern: RegExp): PrismaField | undefined {
  return model.fields.find((field) => pattern.test(field.name));
}

// --------------------------------------------------------------- the file --

describe("the schema file", () => {
  it("exists, is not empty, and parses into models", () => {
    expect(existsSync(SCHEMA_PATH), `${SCHEMA_PATH} is missing`).toBe(true);
    expect(schema().models.length, "the schema declares no models at all").toBeGreaterThan(0);
  });

  it("contains no statement the checks below cannot read", () => {
    // A statement the reader skips is a hole every other assertion in this file
    // could pass through. Fail here rather than pass vacuously there.
    expect(schema().unparsed).toEqual([]);
  });

  it("declares the ten kernel models the spec names", () => {
    // data-model.md "Kernel additions" plus the kernel row of
    // data-ownership.md:21 — "Person · PersonEnrolment · Document ·
    // LegalEntity · Jurisdiction · BusinessCalendar · BusinessHoliday · Regime ·
    // JurisdictionEnrolment · DocumentType · IngestionRule · FxRate · User ·
    // AuditEntry".
    //
    // The list was narrowed to slice 1's five while people, accounts, the
    // registry, FX and audit were split out on size; it is restored here now
    // that `kernel-schema-people-registry` carries them. BusinessCalendar and
    // BusinessHoliday are checked by shape rather than by name (a calendar
    // inlined on Jurisdiction satisfies the spec), the audit table by the name
    // family below, and IngestionRule belongs to neither schema slice.
    const required = [
      "Document",
      "LegalEntity",
      "Jurisdiction",
      "Regime",
      "JurisdictionEnrolment",
      "Person",
      "PersonEnrolment",
      "DocumentType",
      "FxRate",
      "User",
    ];
    const present = schema().models.map((model) => model.name);
    expect(required.filter((name) => !present.includes(name))).toEqual([]);
  });

  it("ships at least one migration", () => {
    // tasks/backlog.yaml#kernel-schema-base `produces: prisma/migrations/`, and
    // operations-deployment runs `prisma migrate deploy` on every deploy.
    expect(existsSync(MIGRATIONS_DIR), `${MIGRATIONS_DIR} is missing`).toBe(true);
    const migrations = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .filter((entry) => existsSync(path.join(MIGRATIONS_DIR, entry.name, "migration.sql")));
    expect(migrations.length, "no migration directory holds a migration.sql").toBeGreaterThan(0);
  });
});

// ------------------------------------------------- assertion 1 · direction --

describe("Document · direction", () => {
  // data-model.md, Document: `direction` | inbound | outbound.
  // components-kernel.md:10 — "+ direction inbound|outbound — fixes supplier
  // bills counted as income (ADR-025)".
  // CLAUDE.md rule 6 — "Money has a direction... Never infer it from context."
  //
  // Nullability: settled by Ahmed for this build — `direction` is NOT NULL.
  // The nullable-then-backfill path in ADR-025 describes the old database
  // evolving in place, which this build does not do. A nullable column here
  // would reintroduce the defect the field exists to fix, so the check below is
  // on optionality specifically: `direction Direction?` must fail.

  it("Document declares a direction field", () => {
    expect(requireField(requireModel("Document"), "direction").name).toBe("direction");
  });

  it("direction is NOT nullable", () => {
    const direction = requireField(requireModel("Document"), "direction");
    expect(
      direction.optional,
      `Document.direction is optional (line ${direction.line}: ${direction.raw}). ` +
        "A document with no direction is a supplier bill that can be counted as income.",
    ).toBe(false);
  });

  it("direction is a single value, not a list", () => {
    expect(requireField(requireModel("Document"), "direction").list).toBe(false);
  });

  it("direction is a closed set of exactly inbound and outbound", () => {
    const direction = requireField(requireModel("Document"), "direction");
    expect(normalisedValues(closedSetOf(direction))).toEqual(["inbound", "outbound"]);
  });

  it("the direction enum has no member meaning unknown", () => {
    // An `unknown`/`pending`/`unclassified` member is nullability wearing a
    // different hat: it would satisfy NOT NULL while leaving the cash figure
    // exactly as wrong. Rule 8 sends low-confidence cases to a work item, not
    // to a placeholder value in the column.
    const evasions = /^(unknown|unclassified|unspecified|undetermined|pending|none|null|na|tbd|other|both|neither)$/;
    const members = closedSetOf(requireField(requireModel("Document"), "direction")).values;
    expect(members.filter((value) => evasions.test(normalise(value)))).toEqual([]);
  });

  it("every direction in the schema is non-nullable and uses the same closed set", () => {
    // CLAUDE.md rule 6 covers invoices, open items and settlements alike, so
    // this holds for the spine tables as they land. Document guarantees at
    // least one match, so the sweep can never pass on an empty list.
    const directions = everyField(schema()).filter(({ field }) => field.name === "direction");
    expect(directions.length, "no direction field found anywhere").toBeGreaterThan(0);
    const nullable = directions
      .filter(({ field }) => field.optional)
      .map(({ model, field }) => locate(model, field));
    expect(nullable, "money has a direction; it is never inferred from context").toEqual([]);
    const values = new Set(
      directions.map(({ field }) => normalisedValues(closedSetOf(field)).join("|")),
    );
    expect([...values]).toEqual(["inbound|outbound"]);
  });
});

// ----------------------------------------------- assertion 2 · paid flags --

describe("payment state is never a boolean", () => {
  // CLAUDE.md rule 5 — "Payment state is a recorded event, never a boolean.
  // There is no `isPaid` column anywhere."
  // ADR-015 — "isPaid was set by AI extraction; partial payments were
  // unrepresentable"; data-vocabulary.md:21 lists today's equivalent of a
  // Settlement as "isPaid / paidAt flags on six different models";
  // data-model.md, schedule tables: "~~isPaid~~ ... Removed — payment state
  // becomes a Settlement row".
  //
  // The family caught below is deliberately wider than the literal `isPaid`:
  // the rule is about the *shape* — a boolean that says money moved — so any
  // spelling of it fails. `paid`, `isPaid`, `hasPaid`, `wasPaid`, `fullyPaid`,
  // `isSettled`, `settled`, `unsettled`, `cleared`, `reconciled`, `remitted`,
  // `paymentComplete`, and the snake_case forms of each.
  const SETTLEMENT_WORDS = [
    "paid",
    "settled",
    "unsettled",
    "cleared",
    "reconciled",
    "remitted",
    "paymentcomplete",
    "paymentreceived",
    "paymentmade",
    "fullypaid",
  ];

  function saysMoneyMoved(name: string): boolean {
    const normalised = normalise(name);
    return SETTLEMENT_WORDS.some((word) => normalised.includes(word));
  }

  it("no boolean field anywhere records payment state", () => {
    const offenders = everyField(schema())
      .filter(({ field }) => field.type === "Boolean" && saysMoneyMoved(field.name))
      .map(({ model, field }) => locate(model, field));
    expect(offenders, "paid state is derived from Settlement rows, never stored").toEqual([]);
  });

  it("no field of any type is named for having been paid", () => {
    // `paidAt`, `paidBy`, `paidAmount`, `amountPaid`, `datePaid` are the same
    // stored payment state in a different type — data-vocabulary.md:21 names
    // `paidAt` alongside `isPaid` as what Settlement replaces. Enum *values*
    // may still be `paid` (TaxFiling.status is pending | filed | paid in
    // data-model.md), which is why this looks at field names only.
    const offenders = everyField(schema())
      .filter(({ field }) => normalise(field.name).includes("paid"))
      .map(({ model, field }) => locate(model, field));
    expect(offenders).toEqual([]);
  });

  it("no boolean is a payment flag in the raw source either", () => {
    // Independent of the parser: if the reader ever failed to see a block, this
    // still fails. Matches `<something>paid<something> Boolean` on a line.
    const lines = schema().source.split("\n");
    const offenders = lines
      .map((line, index) => ({ line: line.trim(), number: index + 1 }))
      .filter(({ line }) => /^\s*\w*(is_?|has_?|was_?)?paid\w*\s+Boolean/i.test(line))
      .map(({ line, number }) => `line ${number}: ${line}`);
    expect(offenders).toEqual([]);
  });

  it("Document carries no payment state of its own", () => {
    // The same rule stated where it was originally broken: a Document must not
    // carry its own payment state. Rule 7 — the document is evidence, not the
    // record.
    const document = requireModel("Document");
    const offenders = document.fields
      .filter((field) => field.type === "Boolean" && saysMoneyMoved(field.name))
      .map((field) => locate(document, field));
    expect(offenders).toEqual([]);
  });
});

// ------------------------------------------- assertion 3 · enrolment unique --

describe("JurisdictionEnrolment · one registration per entity per regime", () => {
  // data-model.md, JurisdictionEnrolment: "`@@unique` | (legalEntityId,
  // regimeId) | One registration per entity per regime".
  // components-kernel.md:14 — "unique per (entity, regime)".

  const PAIR = ["legalEntityId", "regimeId"];

  function compoundConstraints(model: PrismaBlock) {
    // @@id on the pair enforces the same thing as @@unique on the pair; either
    // satisfies "unique on (legalEntityId, regimeId)".
    return [...blockAttributes(model, "unique"), ...blockAttributes(model, "id")];
  }

  it("declares both foreign keys as literal columns", () => {
    const model = requireModel("JurisdictionEnrolment");
    expect(requireField(model, "legalEntityId").optional).toBe(false);
    expect(requireField(model, "regimeId").optional).toBe(false);
  });

  it("carries a compound unique over exactly (legalEntityId, regimeId)", () => {
    const model = requireModel("JurisdictionEnrolment");
    const constraints = compoundConstraints(model);
    const match = constraints.find((attribute) => sameFieldSet(attribute.fields, PAIR));
    expect(
      match,
      `no @@unique([legalEntityId, regimeId]) on JurisdictionEnrolment. Block attributes: ${
        model.attributes.map((attribute) => attribute.raw).join(" ") || "none"
      }`,
    ).toBeDefined();
    expect(match?.fields).toHaveLength(2);
  });

  it("does not make either column unique on its own", () => {
    // Two single-field uniques would allow an entity exactly one enrolment in
    // total — the spec allows an entity to be enrolled under several regimes,
    // and a regime to have many enrolled entities. This is the check that makes
    // the compound assertion mean what it says.
    const model = requireModel("JurisdictionEnrolment");
    const fieldLevel = PAIR.filter((name) => hasAttribute(requireField(model, name), "unique"));
    expect(fieldLevel, "a single-column @unique here forbids a second enrolment").toEqual([]);

    const singles = compoundConstraints(model)
      .filter((attribute) => attribute.fields.length === 1 && PAIR.includes(attribute.fields[0]))
      .map((attribute) => attribute.raw);
    expect(singles, "a single-column @@unique here forbids a second enrolment").toEqual([]);
  });

  it("carries the registration fields the spec lists", () => {
    // "identifier | string | TRN or equivalent registration number";
    // "frequency, anchor | enum, date"; "activeFrom, activeTo | date";
    // "sourceDocumentId | → Document | The certificate, as evidence".
    const model = requireModel("JurisdictionEnrolment");
    expect(requireField(model, "identifier").type).toBe("String");
    expect(normalisedValues(closedSetOf(requireField(model, "frequency")))).toEqual(
      expect.arrayContaining(["monthly", "quarterly"]),
    );
    // `annual` is a deliberate deviation from data-model.md's "Monthly or
    // quarterly" — UAE corporate tax is filed annually, so without it a CT
    // registration cannot be recorded at all. Ahmed's decision, 2026-08-14,
    // and data-model.md:170 was amended to match. Pinned separately because a
    // documented deviation that nothing tests is a deviation that quietly
    // reverts; `arrayContaining` above would pass without it.
    expect(
      normalisedValues(closedSetOf(requireField(model, "frequency"))),
      "annual is required — UAE corporate tax is filed annually",
    ).toContain("annual");
    expect(requireField(model, "anchor").type).toBe("DateTime");
    expect(requireField(model, "activeFrom").type).toBe("DateTime");
    expect(requireField(model, "activeTo").type).toBe("DateTime");
    expect(requireField(model, "sourceDocumentId").name).toBe("sourceDocumentId");
  });

  it("leaves an open-ended registration representable", () => {
    // "activeFrom, activeTo | date | Registration is not permanent" — a current
    // registration has no end date, and the evidencing certificate may not be
    // on file yet. These two are genuinely optional, unlike direction.
    const model = requireModel("JurisdictionEnrolment");
    expect(requireField(model, "activeTo").optional).toBe(true);
    expect(requireField(model, "sourceDocumentId").optional).toBe(true);
  });
});

// ------------------------------------------ assertion 4 · business calendar --

describe("Jurisdiction · business calendar", () => {
  // data-model.md, Jurisdiction: "`BusinessCalendar` | weekend mask +
  // holidays[] | Sunday–Thursday in the Gulf; deadline maths cannot be UTC
  // arithmetic".
  // components-kernel.md:12 — "The country, plus its business calendar (Sun–Thu,
  // per-country holidays)... Calendar becomes first-class".
  // CLAUDE.md rule 9 — "The working week is Sunday–Thursday in the Gulf."

  /** The calendar: its own model if there is one, else Jurisdiction itself. */
  function calendar(): PrismaBlock {
    return modelNamed(schema(), "BusinessCalendar") ?? requireModel("Jurisdiction");
  }

  function weekendMask(): PrismaField {
    const carrier = calendar();
    const field = fieldMatching(carrier, /weekend/i);
    if (field === undefined) {
      throw new Error(
        `no weekend mask on ${carrier.name}. Fields: ${carrier.fields.map((f) => f.name).join(", ")}`,
      );
    }
    return field;
  }

  it("a business calendar is reachable from Jurisdiction", () => {
    const jurisdiction = requireModel("Jurisdiction");
    const own = modelNamed(schema(), "BusinessCalendar");
    if (own === undefined) {
      // Inlined on Jurisdiction is acceptable; a calendar that exists nowhere is not.
      expect(
        fieldMatching(jurisdiction, /weekend/i),
        "neither a BusinessCalendar model nor a weekend mask on Jurisdiction",
      ).toBeDefined();
      return;
    }
    const linked =
      fieldNamed(own, "jurisdictionId") !== undefined ||
      own.fields.some((field) => field.type === "Jurisdiction") ||
      jurisdiction.fields.some((field) => field.type === "BusinessCalendar");
    expect(linked, "BusinessCalendar is not tied to a Jurisdiction").toBe(true);
  });

  it("the calendar carries a weekend mask", () => {
    expect(weekendMask().name).toMatch(/weekend/i);
  });

  it("the weekend mask can express a two-day weekend, Friday and Saturday", () => {
    // Sunday–Thursday working week means the mask must hold a *set* of days.
    // A list of days, an integer bitmask, JSON or a delimited string can; a
    // Boolean or a single day-of-week value cannot, and a schema that cannot
    // say "Friday and Saturday" cannot do Gulf deadline arithmetic at all.
    const mask = weekendMask();
    const setLike = mask.list || ["Int", "BigInt", "Json", "String"].includes(mask.type);
    expect(
      setLike,
      `${mask.name} is \`${mask.type}${mask.list ? "[]" : ""}\` (line ${mask.line}), ` +
        "which cannot hold both Friday and Saturday",
    ).toBe(true);
    expect(mask.type).not.toBe("Boolean");
  });

  it("the weekend mask is not nullable — every jurisdiction has a working week", () => {
    // A null mask forces a fallback, and the fallback in plain UTC arithmetic
    // is Saturday–Sunday, which is the wrong week for all five countries.
    const mask = weekendMask();
    expect(mask.optional, `${mask.name} is optional (line ${mask.line}: ${mask.raw})`).toBe(false);
  });

  it("the calendar carries public holidays as a collection", () => {
    // "weekend mask + holidays[]" — holidays are per-country and many.
    const carrier = calendar();
    const inline = fieldMatching(carrier, /holiday/i);
    const ownModel = schema().models.find((model) => /holiday/i.test(model.name));
    expect(
      inline !== undefined || ownModel !== undefined,
      `no holidays on ${carrier.name} and no holiday table in the schema`,
    ).toBe(true);
    if (inline !== undefined && ownModel === undefined) {
      expect(inline.list || inline.type === "Json", `${inline.name} holds only one value`).toBe(
        true,
      );
    }
  });
});

// -------------------------------------- the remaining kernel shapes in spec --

describe("LegalEntity", () => {
  it("carries a role from a closed set of self, client and vendor", () => {
    // data-model.md, LegalEntity: "`role` | self | client | vendor | Stops
    // entities being auto-created from fuzzy name matches".
    const role = requireField(requireModel("LegalEntity"), "role");
    expect(normalisedValues(closedSetOf(role))).toEqual(["client", "self", "vendor"]);
  });

  it("role is not nullable — an entity with no role is the fuzzy-match defect", () => {
    const role = requireField(requireModel("LegalEntity"), "role");
    expect(role.optional, `LegalEntity.role is optional (line ${role.line})`).toBe(false);
  });
});

describe("Regime · the law itself", () => {
  // data-model.md, Regime: jurisdictionId → Jurisdiction; obligationType
  // vat | corporate_tax | social_insurance | …; "rate, deadlineDays | decimal,
  // integer"; "thresholds, brackets | JSON".

  it("belongs to a jurisdiction", () => {
    expect(requireField(requireModel("Regime"), "jurisdictionId").optional).toBe(false);
  });

  it("names the obligation type from a closed set covering at least VAT, corporate tax and social insurance", () => {
    const obligation = requireField(requireModel("Regime"), "obligationType");
    expect(normalisedValues(closedSetOf(obligation))).toEqual(
      expect.arrayContaining(["vat", "corporatetax", "socialinsurance"]),
    );
  });

  it("stores rate as a decimal, never a float", () => {
    // "rate, deadlineDays | decimal, integer | Extracted from hardcoded values
    // in the current build". A tax rate in binary floating point is a rounding
    // defect waiting for the first filing.
    const rate = requireField(requireModel("Regime"), "rate");
    expect(rate.type, `Regime.rate is \`${rate.type}\``).toBe("Decimal");
  });

  it("stores deadlineDays as an integer", () => {
    expect(requireField(requireModel("Regime"), "deadlineDays").type).toBe("Int");
  });

  it("holds thresholds and brackets as JSON", () => {
    // "thresholds, brackets | JSON | Egyptian income tax bands, registration
    // thresholds".
    const regime = requireModel("Regime");
    expect(requireField(regime, "thresholds").type).toBe("Json");
    expect(requireField(regime, "brackets").type).toBe("Json");
  });
});

// ================================================================= slice 2 ==
// People, accounts, the registry, FX and audit.
// ============================================================================

// ----------------------------------------------- assertion 1 · the org chart --

describe("Person · the org chart", () => {
  it("carries managerId, the org chart the approver rules resolve against", () => {
    // data-model.md:119, Person: "`managerId` | → Person | Org chart — required
    // to resolve who approves what".
    const person = requireModel("Person");
    expect(requireField(person, "managerId").name).toBe("managerId");
    expect(
      person.fields.some((field) => field.type === "Person"),
      "managerId does not resolve to a Person — the org chart is not walkable",
    ).toBe(true);
  });

  it("wires managerId to Person as a self-relation, not a loose id", () => {
    // Strengthens the case above. `managerId String` next to any unrelated
    // Person-typed field would satisfy "some field is a Person"; the arrow in
    // "`managerId` | → Person" is a foreign key, and only a `@relation` whose
    // `fields:` list names managerId makes walking the chart a join rather than
    // a hopeful lookup.
    const person = requireModel("Person");
    const selfRelation = person.fields
      .filter((field) => field.type === "Person")
      .flatMap((field) => field.attributes)
      .find(
        (attribute) =>
          attribute.name === "relation" &&
          (attribute.fields.includes("managerId") ||
            /fields:\s*\[[^\]]*\bmanagerId\b/.test(attribute.args)),
      );
    expect(
      selfRelation,
      "no `@relation(fields: [managerId], references: [id])` on a Person-typed field. " +
        `Person fields: ${person.fields.map((field) => field.raw).join(" | ")}`,
    ).toBeDefined();
  });

  it("managerId names one manager, not a list", () => {
    // An org chart resolves "who approves what" to a single approver; a list
    // makes the approver question ambiguous rather than answered.
    expect(requireField(requireModel("Person"), "managerId").list).toBe(false);
  });

  it("has per-jurisdiction enrolments with identifiers and validity dates", () => {
    // data-model.md:120, Person: "`PersonEnrolment` | new relation | Social
    // insurance and tax identifiers, per jurisdiction, with validity dates".
    const enrolment = requireModel("PersonEnrolment");
    expect(
      fieldNamed(enrolment, "personId") ?? fieldMatching(enrolment, /^person/i),
      "PersonEnrolment is not tied to a Person",
    ).toBeDefined();
    expect(
      fieldNamed(enrolment, "jurisdictionId") ??
        enrolment.fields.find((field) => field.type === "Jurisdiction") ??
        fieldNamed(enrolment, "regimeId"),
      "PersonEnrolment is not per jurisdiction",
    ).toBeDefined();
    expect(
      fieldMatching(enrolment, /identifier|number|trn/i),
      "PersonEnrolment holds no identifier",
    ).toBeDefined();
    expect(
      fieldMatching(enrolment, /(from|start)$/i),
      "PersonEnrolment has no validity start",
    ).toBeDefined();
    expect(
      fieldMatching(enrolment, /(to|until|end)$/i),
      "PersonEnrolment has no validity end",
    ).toBeDefined();
  });
});

describe("PersonEnrolment", () => {
  // data-model.md:120 — "Social insurance and tax identifiers, per
  // jurisdiction, with validity dates".
  // components-kernel.md:9 — "+ person-level enrolments (SI and tax identifiers
  // per jurisdiction)".
  //
  // The block above proves the fields exist by name. These pin their types and
  // optionality, which is where "per jurisdiction, with validity dates" is
  // actually kept or lost.

  /** Whichever link the schema uses to reach a jurisdiction — direct or via a regime. */
  function jurisdictionLink(): PrismaField {
    const enrolment = requireModel("PersonEnrolment");
    const link =
      fieldNamed(enrolment, "jurisdictionId") ??
      enrolment.fields.find((field) => field.type === "Jurisdiction") ??
      fieldNamed(enrolment, "regimeId");
    if (link === undefined) {
      throw new Error(
        "PersonEnrolment reaches no jurisdiction, directly or through a regime. " +
          `Fields: ${enrolment.fields.map((field) => field.name).join(", ")}`,
      );
    }
    return link;
  }

  function validity(pattern: RegExp, what: string): PrismaField {
    const enrolment = requireModel("PersonEnrolment");
    const field = fieldMatching(enrolment, pattern);
    if (field === undefined) {
      throw new Error(
        `PersonEnrolment has no validity ${what}. ` +
          `Fields: ${enrolment.fields.map((f) => f.name).join(", ")}`,
      );
    }
    return field;
  }

  it("belongs to exactly one person, not optionally", () => {
    const person =
      fieldNamed(requireModel("PersonEnrolment"), "personId") ??
      requireField(requireModel("PersonEnrolment"), "person");
    expect(person.list, "an enrolment covers one person").toBe(false);
    expect(
      person.optional,
      "an enrolment with no person is a social-insurance number belonging to nobody",
    ).toBe(false);
  });

  it("is per jurisdiction, and the link is not optional", () => {
    // "per jurisdiction" is the whole point: an Egyptian SI number and a UAE
    // tax identifier are different registrations under different law. A
    // nullable link makes them one undifferentiated bag.
    const link = jurisdictionLink();
    expect(link.list, `PersonEnrolment.${link.name} is a list`).toBe(false);
    expect(
      link.optional,
      `PersonEnrolment.${link.name} is optional (line ${link.line}: ${link.raw}) — ` +
        "an enrolment under no jurisdiction is not per-jurisdiction",
    ).toBe(false);
  });

  it("holds the identifier as a string, and it is required", () => {
    // JurisdictionEnrolment's equivalent is "`identifier` | string | TRN or
    // equivalent registration number" (data-model.md:169); the person-level row
    // holds "Social insurance and tax identifiers". An enrolment row with no
    // identifier records nothing.
    const identifier = validity(/identifier|number|trn/i, "identifier");
    expect(identifier.type, `PersonEnrolment.${identifier.name} is \`${identifier.type}\``).toBe(
      "String",
    );
    expect(identifier.optional).toBe(false);
  });

  it("carries validity dates as dates, with a required start", () => {
    const from = validity(/(from|start)$/i, "start");
    expect(from.type, `PersonEnrolment.${from.name} is \`${from.type}\``).toBe("DateTime");
    expect(
      from.optional,
      `PersonEnrolment.${from.name} is optional — an enrolment valid from no date ` +
        "cannot be asked whether it covered a given payroll month",
    ).toBe(false);
  });

  it("leaves a current enrolment open-ended", () => {
    // The same reading as JurisdictionEnrolment's "activeFrom, activeTo | date |
    // Registration is not permanent" (data-model.md:171): a registration in
    // force today has no end date, so a NOT NULL end makes the ordinary case
    // unrepresentable and invites a sentinel far-future date instead.
    const to = validity(/(to|until|end)$/i, "end");
    expect(to.type, `PersonEnrolment.${to.name} is \`${to.type}\``).toBe("DateTime");
    expect(to.optional, `PersonEnrolment.${to.name} is NOT NULL`).toBe(true);
  });
});

// ------------------------------------------- assertion 2 · the type registry --

describe("DocumentType registry", () => {
  // data-model.md:182-185, DocumentType: "`type, label, category` | string";
  // "`fields` | JSON | The extraction schema handed to the parser on every
  // call"; "`retentionYears, retentionBasis` | integer, enum";
  // "`erasureMode` | redact_personal | full_delete".
  // data-retention.md:17-26 gives the same four retention fields plus legalHold.

  it("carries type, label and category as strings", () => {
    const registry = requireModel("DocumentType");
    for (const name of ["type", "label", "category"]) {
      expect(requireField(registry, name).type, `DocumentType.${name}`).toBe("String");
    }
  });

  it("carries the extraction field schema as JSON", () => {
    expect(requireField(requireModel("DocumentType"), "fields").type).toBe("Json");
  });

  it("carries retention as years plus a basis", () => {
    const registry = requireModel("DocumentType");
    expect(requireField(registry, "retentionYears").type).toBe("Int");
    expect(requireField(registry, "retentionBasis").name).toBe("retentionBasis");
  });

  it("carries an erasure mode of exactly redact_personal or full_delete", () => {
    // ADR-023 — "erasure redacts personal fields while financial records
    // survive". A third mode would be a policy decision, not a schema one.
    const mode = requireField(requireModel("DocumentType"), "erasureMode");
    expect(normalisedValues(closedSetOf(mode))).toEqual(["fulldelete", "redactpersonal"]);
  });

  it("erasure mode is one required value, so every type has an answer", () => {
    // data-retention.md:26 — "How a data-subject erasure request is honoured for
    // this type". A null mode is a PDPL request with no defined handling, which
    // is the one outcome the registry exists to prevent.
    const mode = requireField(requireModel("DocumentType"), "erasureMode");
    expect(mode.optional, `DocumentType.erasureMode is optional (line ${mode.line})`).toBe(false);
    expect(mode.list).toBe(false);
  });

  it("retention years are required and default to 7", () => {
    // data-retention.md:23 — "`retentionYears` | integer · default 7 |
    // Corporate tax governs where the same invoice serves both regimes", and
    // data-retention.md:31 — seven years from the end of the financial year is
    // the longer of the two regimes, so it is the safe default for a new type.
    // A type added without a retention period would otherwise be purged on
    // whatever the job treats as null.
    const years = requireField(requireModel("DocumentType"), "retentionYears");
    expect(years.optional, "DocumentType.retentionYears is optional").toBe(false);
    const fallback = years.attributes.find((attribute) => attribute.name === "default");
    expect(
      fallback,
      `no @default on DocumentType.retentionYears (line ${years.line}: ${years.raw})`,
    ).toBeDefined();
    expect(fallback?.args.trim()).toBe("7");
  });

  it("retention basis is a closed set covering the three statutory clocks", () => {
    // data-retention.md:24 — "`retentionBasis` | end_of_financial_year |
    // end_of_tax_period | document_date | What the clock counts from — it
    // differs per statute". data-model.md:184 types it `enum`, so a free string
    // that lets `EOFY`, `end_of_FY` and `endOfFinancialYear` coexist is wrong
    // for the same reason Regime.obligationType is.
    const basis = requireField(requireModel("DocumentType"), "retentionBasis");
    expect(normalisedValues(closedSetOf(basis))).toEqual(
      expect.arrayContaining(["endoffinancialyear", "endoftaxperiod", "documentdate"]),
    );
    expect(basis.optional, "a retention period counting from nothing cannot be computed").toBe(
      false,
    );
  });

  it("carries a legal hold that blocks the purge", () => {
    // data-retention.md:25 — "`legalHold` | boolean | Blocks purge regardless of
    // age, for disputes and investigations"; data-retention.md:35 — the purge
    // job "select[s] records past their computed retention date, skipping legal
    // holds". A nullable hold makes the job guess on the rows it matters for.
    const hold = requireField(requireModel("DocumentType"), "legalHold");
    expect(hold.type, `DocumentType.legalHold is \`${hold.type}\``).toBe("Boolean");
    expect(hold.optional, "a null legal hold is a purge decision made by accident").toBe(false);
  });

  it("names a type once, so the parser cannot be handed two field schemas", () => {
    // data-model.md:183 — the field schema is "handed to the parser on every
    // call", keyed by type; components-kernel.md:15 — the registry is "Field
    // schemas + the ingestion rule catalogue + retention policy per type".
    // Two rows for `invoice` means two answers to "what does the parser
    // extract" and two retention periods for the same document.
    const registry = requireModel("DocumentType");
    const fieldLevel = hasAttribute(requireField(registry, "type"), "unique");
    const compound = [
      ...blockAttributes(registry, "unique"),
      ...blockAttributes(registry, "id"),
    ];
    const blockLevel = compound.some((attribute) => sameFieldSet(attribute.fields, ["type"]));
    expect(
      fieldLevel || blockLevel,
      `DocumentType.type is not unique. Block attributes: ${
        registry.attributes.map((attribute) => attribute.raw).join(" ") || "none"
      }`,
    ).toBe(true);
  });
});

// -------------------------------------------------------- assertion 3 · FX --

describe("FxRate", () => {
  // data-model.md:193-196, FxRate: "`base, quote` | ISO-4217"; "`rate` |
  // decimal"; "`asOf` | date | Snapshots are taken from here and never
  // recomputed".
  // components-kernel.md:16 — "Own table replaces the JSON blob in Setting;
  // adapter fetches, kernel writes" and "a payroll month keeps its rate
  // forever".

  it("carries base and quote currencies", () => {
    const fx = requireModel("FxRate");
    expect(requireField(fx, "base").type).toBe("String");
    expect(requireField(fx, "quote").type).toBe("String");
  });

  it("base and quote are both required — a one-sided rate is not a rate", () => {
    const fx = requireModel("FxRate");
    for (const name of ["base", "quote"]) {
      const currency = requireField(fx, name);
      expect(currency.optional, `FxRate.${name} is optional (line ${currency.line})`).toBe(false);
      expect(currency.list, `FxRate.${name} is a list`).toBe(false);
    }
  });

  it("stores the rate as a decimal, never a float", () => {
    const rate = requireField(requireModel("FxRate"), "rate");
    expect(rate.type, `FxRate.rate is \`${rate.type}\``).toBe("Decimal");
  });

  it("the rate itself is required", () => {
    // A row in the rate store with no rate is a conversion that silently
    // becomes zero or throws at settlement time, long after the fetch.
    const rate = requireField(requireModel("FxRate"), "rate");
    expect(rate.optional, `FxRate.rate is optional (line ${rate.line})`).toBe(false);
    expect(rate.list).toBe(false);
  });

  it("carries the date the rate is as of, non-nullable", () => {
    const asOf = requireField(requireModel("FxRate"), "asOf");
    expect(asOf.type).toBe("DateTime");
    expect(asOf.optional, "a rate with no date cannot be snapshotted").toBe(false);
  });

  it("no money or rate column anywhere is a binary float", () => {
    // data-model.md types every amount, balance and rate `decimal` — FxRate.rate
    // and Regime.rate literally, and "amount, currency | decimal, ISO-4217" on
    // every spine table. Binary floating point cannot represent 0.05, so a
    // Float here is a rounding defect that surfaces in a payroll total or a VAT
    // line, not in a test. The legacy schema types Person.salary, costPerHour
    // and billingRate `Float?`, so this is a live regression, not a hypothetical.
    // Swept over the whole file so it keeps holding as the spine lands;
    // FxRate.rate and Regime.rate guarantee matches, so it can never pass on an
    // empty list.
    // `cost` and `price` are here because the word-split misses them otherwise:
    // costPerHour tokenises to ["cost","per","hour"], so a sweep keyed only on
    // rate/amount/balance/salary silently skipped a money column on Person
    // while its own comment claimed to cover it. Caught by review, with a
    // Float mutant on costPerHour surviving all 78 assertions.
    const MONEY_WORDS = new Set([
      "rate", "rates", "amount", "balance", "salary", "cost", "price", "fee", "pay",
    ]);
    const words = (name: string) =>
      name
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .split(/[\s_-]+/)
        .map((word) => word.toLowerCase());
    const money = everyField(schema()).filter(({ field }) =>
      words(field.name).some((word) => MONEY_WORDS.has(word)),
    );
    expect(money.length, "no money or rate column found anywhere").toBeGreaterThan(0);
    const floats = money
      .filter(({ field }) => field.type === "Float")
      .map(({ model, field }) => locate(model, field));
    expect(floats, "money and rates are decimal; binary floats lose cents").toEqual([]);
  });
});

// ------------------------------------------------- assertion 4 · audit log --

describe("the append-only audit log", () => {
  // components-kernel.md:18 — "Audit | Append-only activity log, read back by
  // in-product timelines | Stays in the DB (read-back requirement); S3 Object
  // Lock archive is a later option; erasure = redaction, not deletion".
  // data-retention.md:37 — "The audit log stays append-only; redaction inside
  // entries resolves the deletion/immutability tension."
  // data-retention.md:35 — "every purge writes an audit entry".
  // ADR-023 — "the audit log stays immutable".
  //
  // WHAT A SCHEMA CAN AND CANNOT ENFORCE HERE. Append-only is a privilege and a
  // repository property, not a column: Prisma has no way to say "INSERT only",
  // and nothing in `schema.prisma` stops `prisma.auditEntry.delete()`. Those
  // guarantees are made by a database grant (REVOKE UPDATE, DELETE), by a
  // trigger, or by the kernel audit module never exposing an update or a delete
  // — and they belong to the tasks that build those, not to this one.
  //
  // What the schema CAN do is make erasure-by-redaction *representable* and
  // stop deletion being structurally invited. That is what the cases below
  // pin: an entry has to record who, when, what and about-which-record so a
  // data subject's entries can be found at all; it has to carry content that
  // can be redacted in place, because "redaction inside entries" needs
  // something inside the entry to redact; it must not carry a soft-delete flag,
  // because erasure is redaction and not deletion; and no relation may cascade,
  // because a cascading delete turns erasing one person into deleting the
  // record that they were erased.
  //
  // Anything beyond that would be invented. In particular, this file does NOT
  // assert the absence of an `@updatedAt` column: redaction is an in-place
  // write, so a timestamp recording when an entry was redacted is consistent
  // with the spec rather than evidence against it.

  const AUDIT_NAME = /^Audit(Log|Event|Entry|Record)?$/;

  /** The audit table, whatever the schema calls it. Throws rather than skipping. */
  function auditModel(): PrismaBlock {
    const present = schema().models.map((model) => model.name);
    const found = schema().models.find((model) => AUDIT_NAME.test(model.name));
    if (found === undefined) {
      throw new Error(`no audit table found among: ${present.join(", ") || "none"}`);
    }
    return found;
  }

  function auditField(pattern: RegExp, what: string): PrismaField {
    const audit = auditModel();
    const field = fieldMatching(audit, pattern);
    if (field === undefined) {
      throw new Error(
        `${audit.name} records no ${what}. Fields: ${
          audit.fields.map((f) => f.name).join(", ") || "none"
        }`,
      );
    }
    return field;
  }

  it("declares an append-only audit log", () => {
    // components-kernel.md:18 — "Audit | Append-only activity log, read back by
    // in-product timelines | Stays in the DB (read-back requirement)".
    const present = schema().models.map((model) => model.name);
    expect(
      present.filter((name) => AUDIT_NAME.test(name)),
      `no audit table found among: ${present.join(", ")}`,
    ).not.toEqual([]);
  });

  it("records when, as a required timestamp", () => {
    // "read back by in-product timelines" — a timeline is an ordering by time,
    // and an entry with a nullable time cannot be placed on one. A second,
    // optional DateTime (a redaction timestamp, say) is fine; what the log
    // cannot do without is at least one required one.
    const audit = auditModel();
    const stamps = audit.fields.filter(
      (field) => field.type === "DateTime" && /(at|timestamp|time)$/i.test(field.name),
    );
    expect(
      stamps.map((field) => field.name),
      `${audit.name} carries no timestamp. Fields: ${
        audit.fields.map((f) => `${f.name} ${f.type}`).join(", ") || "none"
      }`,
    ).not.toEqual([]);
    expect(
      stamps.filter((field) => !field.optional).map((field) => field.name),
      `every timestamp on ${audit.name} is nullable — an entry with no time is not on any timeline`,
    ).not.toEqual([]);
  });

  it("records what happened, and it is required", () => {
    // "activity log" — an entry that does not say what the activity was is not
    // one, and a nullable action is an entry that says nothing happened.
    const action = auditField(/^(action|event|verb|activity|operation|change)/i, "action");
    expect(action.optional, `${auditModel().name}.${action.name} is optional`).toBe(false);
  });

  it("records who did it", () => {
    // An activity log read back as a timeline answers "who changed this".
    // Deliberately NOT asserted non-nullable: data-retention.md:35 has the
    // scheduled purge job writing an entry, and a job is not a user.
    const audit = auditModel();
    const actor =
      fieldMatching(audit, /^(actor|user|performedby|recordedby|changedby|author)/i) ??
      audit.fields.find((field) => field.type === "User");
    expect(
      actor,
      `${audit.name} records no actor. Fields: ${audit.fields.map((f) => f.name).join(", ")}`,
    ).toBeDefined();
  });

  it("records which record it is about, by type and by id", () => {
    // Two things need this. The timeline is read back per record
    // (components-kernel.md:18), and PDPL erasure "redact[s] personal fields"
    // (data-retention.md:36) — which is only possible if the entries about a
    // subject can be found. A log that says what happened but not to what can
    // neither be shown on a record nor redacted for a person.
    const audit = auditModel();
    expect(
      fieldMatching(audit, /(entitytype|targettype|subjecttype|resourcetype|recordtype)/i),
      `${audit.name} does not say what kind of record an entry is about`,
    ).toBeDefined();
    expect(
      fieldMatching(audit, /(entityid|targetid|subjectid|resourceid|recordid)/i),
      `${audit.name} does not say which record an entry is about`,
    ).toBeDefined();
  });

  it("carries content that can be redacted in place", () => {
    // data-retention.md:37 — "redaction inside entries resolves the
    // deletion/immutability tension". Redaction *inside* an entry requires the
    // entry to hold something other than its own identity: the changed values,
    // the detail, the personal fields. Without such a column the only way to
    // honour an erasure request against the log is to delete the row, which is
    // the outcome the spec rules out.
    const audit = auditModel();
    const payload = fieldMatching(
      audit,
      /^(new|old|prev|previous)?(details?|payload|changes?|diff|delta|data|metadata|before|after|snapshot|values|context)$/i,
    );
    expect(
      payload,
      `${audit.name} has no redactable content column. Fields: ${
        audit.fields.map((f) => f.name).join(", ")
      }`,
    ).toBeDefined();
    expect(
      ["Json", "String"].includes(payload?.type ?? ""),
      `${audit.name}.${payload?.name} is \`${payload?.type}\`, which holds no redactable content`,
    ).toBe(true);
  });

  it("carries no soft-delete flag — erasure redacts, it does not delete", () => {
    // components-kernel.md:18 — "erasure = redaction, not deletion". A
    // `deletedAt` or `isDeleted` on the log is deletion arriving under another
    // name: the entry stops being read back, which is the same loss as removing
    // the row. A `redactedAt` is not caught here, and should not be — that is
    // the sanctioned mechanism.
    const audit = auditModel();
    const gone = /(deleted|removed|purged|destroyed|voided|discarded)/;
    const offenders = audit.fields
      .filter((field) => gone.test(normalise(field.name)))
      .map((field) => locate(audit, field));
    expect(offenders, "the audit log is append-only; entries are redacted, never removed").toEqual(
      [],
    );
  });

  it("no relation on the log cascades a delete into it", () => {
    // The sharpest thing a schema can say about append-only. With
    // `onDelete: Cascade` on the actor or subject relation, erasing a person
    // deletes every entry recording what was done to them — including the entry
    // recording the erasure itself. ADR-023 keeps the log immutable precisely so
    // that cannot happen; data-retention.md:35 requires an audit entry per purge
    // to survive the purge.
    const audit = auditModel();
    const cascading = audit.fields
      .filter((field) =>
        field.attributes.some(
          (attribute) =>
            attribute.name === "relation" && /onDelete\s*:\s*Cascade/i.test(attribute.args),
        ),
      )
      .map((field) => locate(audit, field));
    expect(
      cascading,
      "a cascading delete would erase the log along with the subject of the entries",
    ).toEqual([]);
  });
});

// ------------------------------------------------- ADR-007 · User carries no roles --

describe("User", () => {
  // components-kernel.md:17 — "User | Account: email, credential hash, provider
  // + providerSub, personId | Survives every IdP change; roles live in
  // Authorization, never here".
  // security-authentication.md:27 — "**User** holds provider + providerSub +
  // personId; roles never — those are Authorization's (ADR-007)."
  // ADR-007 — "A reusable Authorization service owns roles, grants and entity
  // scope with a per-app vocabulary."

  it("carries the account fields the kernel row names", () => {
    const user = requireModel("User");
    expect(requireField(user, "email").type).toBe("String");
    expect(requireField(user, "provider").name).toBe("provider");
    expect(requireField(user, "providerSub").name).toBe("providerSub");
    expect(requireField(user, "personId").name).toBe("personId");
  });

  it("carries no role or permission columns — those belong to Authorization", () => {
    // The legacy schema has exactly these: `role String @default("viewer")` and
    // `permissions String?` holding a JSON grant blob
    // (reference/legacy/prisma/schema.prisma, model User). ADR-007 moves both
    // out. Copying them forward would put the same permission model in two
    // places and make "roles live in Authorization, never here" untrue on the
    // day the schema lands.
    const user = requireModel("User");
    const authorization =
      /^(role|roles|permission|permissions|grant|grants|scope|scopes|entityscope|access|acl)$/;
    const offenders = user.fields
      .filter((field) => authorization.test(normalise(field.name)))
      .map((field) => locate(user, field));
    expect(offenders, "roles, grants and entity scope are the Authorization service's").toEqual([]);
  });

  it("the credential hash is optional, because an SSO user has none", () => {
    // security-authentication.md — "Credentials | Email + bcrypt hash in the
    // User table"; ADR-008 — "Exactly one provider per user; enabling SSO for a
    // domain disables credentials for those users". A NOT NULL hash makes a
    // Google Workspace user unrepresentable, and the workaround is a fake hash
    // that a credentials login could one day be checked against.
    const user = requireModel("User");
    const hash = fieldMatching(user, /(passwordhash|credentialhash|passwordHash)/i);
    expect(
      hash,
      `User carries no credential hash. Fields: ${user.fields.map((f) => f.name).join(", ")}`,
    ).toBeDefined();
    expect(hash?.optional, `User.${hash?.name} is NOT NULL, so an SSO user cannot exist`).toBe(true);
  });

  it("is bound to one provider identity, not a list of linked accounts", () => {
    // ADR-008 — "Exactly one provider per user... Account linking is a known
    // takeover surface". A `provider` or `providerSub` list is account linking
    // expressed in the schema.
    const user = requireModel("User");
    expect(requireField(user, "provider").list).toBe(false);
    expect(requireField(user, "providerSub").list).toBe(false);
  });
});

// ---------------------------------- assertion 5 · the schema-wide sweeps hold --

describe("the schema-wide sweeps see every model this slice adds", () => {
  // "No isPaid or equivalent boolean, and no nullable direction, is introduced
  // by these models" needs no new sweep: "payment state is never a boolean" and
  // "every direction in the schema is non-nullable and uses the same closed set"
  // already run over `everyField(schema())`, which is every field of every model
  // in the file, so a `Person.isPaid` or a nullable `FxRate.direction` fails
  // them on arrival. Restating either per model would duplicate them and, worse,
  // suggest that the file-wide versions were scoped to slice 1.
  //
  // The one gap a sweep genuinely has is a model that never arrives: a sweep
  // over a schema missing PersonEnrolment passes without ever seeing it. This
  // case closes that by asserting the sweeps' input contains the six models
  // this slice adds, each with fields to sweep.

  it("every model this slice adds contributes fields to the sweeps", () => {
    const swept = everyField(schema());
    const named = new Set(swept.map(({ model }) => model.name));
    const audit = [...named].filter((name) => /^Audit(Log|Event|Entry|Record)?$/.test(name));
    const missing = ["Person", "PersonEnrolment", "User", "DocumentType", "FxRate"].filter(
      (name) => !named.has(name),
    );
    expect(
      missing,
      "these models are not in the sweeps' input, so the sweeps say nothing about them",
    ).toEqual([]);
    expect(audit, "the audit table contributes no fields to the sweeps").not.toEqual([]);
  });
});

// ---------------------------------------------------- settled on review ----
// Three decisions taken after the first review pass, each pinned so a later
// edit has to argue with a test rather than with a comment.

describe("FxRate · one rate per pair per day", () => {
  it("is unique on (base, quote, asOf)", () => {
    // "Snapshots are taken from here and never recomputed" (data-model.md).
    // Two rows for one pair on one date make "the rate as of that date"
    // ambiguous exactly where the spec says it is determinate, and a payslip
    // reopened next year would convert differently. Ahmed's decision.
    const model = requireModel("FxRate");
    const constraints = [...blockAttributes(model, "unique"), ...blockAttributes(model, "id")];
    expect(
      constraints.some((a) => sameFieldSet(a.fields, ["base", "quote", "asOf"])),
      `no @@unique([base, quote, asOf]). Block attributes: ${
        model.attributes.map((a) => a.raw).join(" ") || "none"
      }`,
    ).toBeDefined();
    expect(
      constraints.some((a) => sameFieldSet(a.fields, ["base", "quote", "asOf"])),
    ).toBe(true);
  });

  it("carries no source column", () => {
    // Deliberately absent: a second rate provider would be a migration, not a
    // redesign, and adding it speculatively weakens the key above today for a
    // case that may never arrive.
    expect(fieldNamed(requireModel("FxRate"), "source")).toBeUndefined();
  });
});

describe("the audit entry snapshots the retention policy it applied", () => {
  it("carries the applied years, basis and erasure mode, all optional", () => {
    // How "what policy governed this action" is answered without versioning
    // DocumentType: the registry keeps only its latest actor and timestamp, and
    // a purge destroys records, so the question is always about an action that
    // already happened. Optional because only purge and erasure entries set
    // them (data-retention.md).
    const audit = schema().models.find((m) => /^Audit(Log|Event|Entry|Record)?$/.test(m.name));
    expect(audit, "no audit table found").toBeDefined();
    for (const [name, type] of [
      ["appliedRetentionYears", "Int"],
      ["appliedRetentionBasis", "RetentionBasis"],
      ["appliedErasureMode", "ErasureMode"],
    ]) {
      const f = fieldNamed(audit!, name);
      expect(f, `${name} is missing from ${audit!.name}`).toBeDefined();
      expect(f!.type, `${name} is \`${f!.type}\``).toBe(type);
      expect(f!.optional, `${name} must be optional — only purge and erasure set it`).toBe(true);
    }
  });

  it("does not version DocumentType instead", () => {
    // The rejected alternative. A DocumentTypeVersion table would be the other
    // way to answer the same question, and it is not what was chosen.
    const names = schema().models.map((m) => m.name);
    expect(names.filter((n) => /^DocumentType.+/.test(n))).toEqual([]);
  });
});

describe("Person carries no rate that is not effective-dated", () => {
  it("has no costPerHour, billingRate or rateCurrency", () => {
    // Removed on review. A project's margin for a past month must not move
    // when someone's rate changes today — the same argument ADR-022 makes for
    // salary. They return effective-dated with kernel-rate-terms, which must
    // merge before module-projects and module-payroll read them. This test is
    // what stops them being re-added as plain columns in the meantime.
    const person = requireModel("Person");
    for (const name of ["costPerHour", "billingRate", "rateCurrency"]) {
      expect(
        fieldNamed(person, name),
        `${name} is back on Person as a plain column; it belongs in a terms table`,
      ).toBeUndefined();
    }
  });

  it("still carries no money as a binary float", () => {
    // The sweep that would have caught the above had it been a Float rather
    // than absent — restated here so removing the columns did not remove the
    // guarantee with them.
    const floats = everyField(schema())
      .filter(({ field }) => /rate|amount|balance|salary|cost|price/i.test(field.name))
      .filter(({ field }) => field.type === "Float");
    expect(floats.map(({ model, field }) => locate(model, field))).toEqual([]);
  });
});
