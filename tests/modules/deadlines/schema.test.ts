// The two tables this module owns were DERIVED, not specified: their only
// mention anywhere before this task was one cell in data-ownership.md. Derived
// fields are exactly the ones that need pinning — nothing upstream will catch a
// change to them, because there is no page they can drift from.
//
// Parsed with the same reader the kernel schema tests use, so a change here
// fails the same way a change to Document.direction does.
import { describe, expect, it } from "vitest";
import {
  blockAttributes,
  enumNamed,
  fieldNamed,
  hasAttribute,
  loadSchema,
  modelNamed,
  normalisedValues,
  sameFieldSet,
} from "@/tests/kernel/prisma-schema";

const schema = loadSchema();
const model = (name: string) => {
  const found = modelNamed(schema, name);
  if (found === undefined) throw new Error(`${name} is missing from the schema`);
  return found;
};
const field = (m: string, f: string) => {
  const found = fieldNamed(model(m), f);
  if (found === undefined) throw new Error(`${m}.${f} is missing`);
  return found;
};

describe("DeadlineRegistration", () => {
  it("stores the due date as a DATE, not a timestamp", () => {
    // The run "recalculates days remaining" (deadline-monitor spec), so the
    // column names a civil day. A plain DateTime would carry an hour, and two
    // rows on the same day would sit different distances from today.
    const due = field("DeadlineRegistration", "dueDate");
    expect(due.type).toBe("DateTime");
    expect(hasAttribute(due, "db.Date"), "dueDate must be @db.Date, not a timestamp").toBe(true);
  });

  it("names what it watches by type and id, both required", () => {
    // registerDeadline(entityRef, type, dueDate), and the fingerprint's entity
    // segment `…document:123:expiry`.
    for (const name of ["entityType", "entityId", "deadlineType"]) {
      expect(field("DeadlineRegistration", name).optional, `${name} must be required`).toBe(false);
    }
  });

  it("carries the jurisdiction whose calendar scores it, and it is required", () => {
    // "Distance is measured in business days against the jurisdiction's
    // calendar." A row that cannot name its jurisdiction cannot be scored.
    expect(field("DeadlineRegistration", "jurisdictionId").optional).toBe(false);
  });

  it("holds one row per watched fact", () => {
    // "Fingerprints are deterministic … no source needs memory of what it
    // raised" (flows-alerting.md). One fingerprint is one fact, so one row.
    const m = model("DeadlineRegistration");
    const constraints = [...blockAttributes(m, "unique"), ...blockAttributes(m, "id")];
    expect(
      constraints.some((a) => sameFieldSet(a.fields, ["entityType", "entityId", "deadlineType"])),
      `no compound unique over (entityType, entityId, deadlineType). Block attributes: ${
        m.attributes.map((a) => a.raw).join(" ") || "none"
      }`,
    ).toBe(true);
  });

  it("records nothing about what a previous run warned", () => {
    // "Each run is stateless: it recomputes distance from today rather than
    // remembering what it warned about yesterday." A column holding last-warned
    // state would make a missed night unrecoverable instead of self-healing.
    const names = model("DeadlineRegistration").fields.map((f) => f.name.toLowerCase());
    const state = names.filter((n) => /warn|notified|alerted|lastrun|lastevaluat|seen/.test(n));
    expect(state, "statelessness is the design; this column remembers a run").toEqual([]);
  });
});

describe("ThresholdTable", () => {
  it("keys a window to a deadline type", () => {
    expect(field("ThresholdTable", "deadlineType").optional).toBe(false);
  });

  it("measures its window in business days", () => {
    // "applies the threshold configured for that type" against "distance is
    // measured in business days" — the unit has to be the same one.
    const window = field("ThresholdTable", "businessDaysBefore");
    expect(window.type).toBe("Int");
    expect(window.optional).toBe(false);
  });

  it("carries severity from a closed set of exactly minor and major", () => {
    // The spec's own reportRun example is the whole severity vocabulary:
    // `severity: "major"` and `severity: "minor"`. Nothing anywhere attests a
    // third level, and an open string would let an extraction invent one.
    const severity = field("ThresholdTable", "severity");
    const set = enumNamed(schema, severity.type);
    expect(set, `severity is typed ${severity.type}, which is not an enum`).toBeDefined();
    expect(normalisedValues(set!).sort()).toEqual(["major", "minor"]);
  });

  it("allows several windows per type, so warnings can escalate", () => {
    // One row per type could not escalate. The unique is on the PAIR.
    const m = model("ThresholdTable");
    const constraints = [...blockAttributes(m, "unique"), ...blockAttributes(m, "id")];
    expect(
      constraints.some((a) => sameFieldSet(a.fields, ["deadlineType", "businessDaysBefore"])),
      `no compound unique over (deadlineType, businessDaysBefore). Block attributes: ${
        m.attributes.map((a) => a.raw).join(" ") || "none"
      }`,
    ).toBe(true);
    expect(
      constraints.some((a) => sameFieldSet(a.fields, ["deadlineType"])),
      "a unique on deadlineType alone would allow only one window per type, so none could escalate",
    ).toBe(false);
  });
});
