# Assertions waiting for the second kernel slice

Written by the test-author for `kernel-schema-base` from the specification
alone, before that task was split on size. They assert models that moved to the
second slice — `Person`, `PersonEnrolment`, `DocumentType`, `FxRate`, `User`
and the append-only audit log — so they cannot pass until that slice lands.

Parked, not deleted and not weakened. Deleting them would lose independently
written assertions; softening them to "check only if the model is present" would
make them pass vacuously, which is the failure mode their author called out by
name. When the second slice lands, move each block back into
`kernel-schema.test.ts` and restore the full ten-model list in "declares the
kernel entities this task carries".

Nothing here is imported or executed. `.md` keeps it out of the vitest glob.

---

```ts
describe("Person", () => {
  it("carries managerId, the org chart the approver rules resolve against", () => {
    // data-model.md, Person: "`managerId` | → Person | Org chart — required to
    // resolve who approves what".
    const person = requireModel("Person");
    expect(requireField(person, "managerId").name).toBe("managerId");
    expect(
      person.fields.some((field) => field.type === "Person"),
      "managerId does not resolve to a Person — the org chart is not walkable",
    ).toBe(true);
  });

  it("has per-jurisdiction enrolments with identifiers and validity dates", () => {
    // data-model.md, Person: "`PersonEnrolment` | new relation | Social
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

describe("DocumentType registry", () => {
  // data-model.md, DocumentType: "`type, label, category` | string";
  // "`fields` | JSON | The extraction schema handed to the parser on every
  // call"; "`retentionYears, retentionBasis` | integer, enum";
  // "`erasureMode` | redact_personal | full_delete".

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
});

describe("FxRate", () => {
  // data-model.md, FxRate: "`base, quote` | ISO-4217"; "`rate` | decimal";
  // "`asOf` | date | Snapshots are taken from here and never recomputed".
  // components-kernel.md:16 — "Own table replaces the JSON blob in Setting".

  it("carries base and quote currencies", () => {
    const fx = requireModel("FxRate");
    expect(requireField(fx, "base").type).toBe("String");
    expect(requireField(fx, "quote").type).toBe("String");
  });

  it("stores the rate as a decimal, never a float", () => {
    const rate = requireField(requireModel("FxRate"), "rate");
    expect(rate.type, `FxRate.rate is \`${rate.type}\``).toBe("Decimal");
  });

  it("carries the date the rate is as of, non-nullable", () => {
    const asOf = requireField(requireModel("FxRate"), "asOf");
    expect(asOf.type).toBe("DateTime");
    expect(asOf.optional, "a rate with no date cannot be snapshotted").toBe(false);
  });
});

describe("the append-only audit log", () => {
  it("declares an append-only audit log", () => {
    // components-kernel.md:18 — "Audit | Append-only activity log, read back by
    // in-product timelines | Stays in the DB (read-back requirement)".
    const present = schema().models.map((model) => model.name);
    expect(
      present.filter((name) => /^Audit(Log|Event|Entry|Record)?$/.test(name)),
      `no audit table found among: ${present.join(", ")}`,
    ).not.toEqual([]);
  });
});
```
