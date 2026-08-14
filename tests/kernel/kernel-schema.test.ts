// Task `kernel-schema-base` — tests written from the specification alone.
// `prisma/schema.prisma` and `prisma/migrations/` were deliberately NOT read
// while writing this file: another agent is writing the schema in parallel, and
// a test retrofitted to it would describe what was written rather than what the
// spec requires. Everything below traces to a line of
// `docs/architecture/data-model.md`, `components-kernel.md`, `decisions.md` or
// `CLAUDE.md`, cited at the test.
//
// `data-model.md:17` — "Field names in `monospace` are literal column names" —
// is what makes literal names below fair game rather than guesses.
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
// Scope: this task is "Prisma schema for the kernel entities", so the required
// models below are the kernel ones — data-model.md's "Kernel additions" section
// plus the tables in components-kernel.md. The financial spine (OpenItem,
// Settlement, TaxFiling, the schedule tables) carries its own hard constraints
// in the same spec; those belong to the module schema tasks and are not
// required to exist here. The two rules that are schema-*wide* — no paid
// boolean, and a direction is never nullable wherever it appears — are enforced
// over every model in the file, so they keep holding as the spine lands.
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

  it("declares the kernel entities this task carries", () => {
    // data-model.md "Kernel additions" names ten kernel models. This task
    // carries the first slice of them — the calendar, the law, the parties and
    // the document — because the whole set is 677 implementation lines against
    // a 400 budget that cannot be waived (see the node's split note).
    //
    // Person, PersonEnrolment, DocumentType, FxRate, User and the audit log
    // belong to `kernel-schema-people-registry`, and their assertions are
    // written and waiting in tests/kernel/pending-slice-2/. They are NOT
    // softened here and NOT deleted — moving them is what keeps this list
    // honest about what has actually landed rather than quietly shrinking the
    // spec to fit the task.
    const required = [
      "Document",
      "LegalEntity",
      "Jurisdiction",
      "Regime",
      "JurisdictionEnrolment",
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

