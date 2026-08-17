// lib/modules/deadlines/repository.ts against a real engine (ADR-038): all four
// members of the DeadlineStore port, the two unique indexes its tables carry,
// the orderings it promises, and what an empty table answers.
//
// THIS IS THE FIRST MODULE-SIDE FILE OF ITS KIND and the other six module
// repositories will copy it, so two conventions are stated here rather than
// left to be inferred.
//
// ONE — `db` is used only where the PORT CANNOT EXPRESS the setup or the check:
// seeding ThresholdTable, which the port only reads; forcing a constraint the
// port never violates; counting rows the port cannot see. Everything else goes
// through `prismaDeadlineStore`, or the file stops testing the repository and
// starts testing Prisma.
//
// TWO — an ORDERING case seeds DISTINCT sort keys. `listRegistrations` orders by
// `dueDate` alone and `listThresholds` by `businessDaysBefore` alone; neither
// has a tiebreak, and ThresholdTable's unique is per (deadlineType,
// businessDaysBefore), so two types may legitimately share a window. Seeding a
// tie and asserting an order asserts something PostgreSQL never promised. Both
// sort keys here are a date and an integer, so ADR-038's collation divergence
// cannot reach them — a text ordering would need the extra care that record
// describes.
import { describe, expect, it } from "vitest";
import { integrationDatabase, refusalFrom } from "../../support/database";

// Order is load-bearing: integrationDatabase swaps DATABASE_URL and evicts the
// cached client, so the store must be reached by dynamic import AFTER it. A
// static import at the top of the file would bind the client built for whatever
// DATABASE_URL held before the harness ran.
const db = await integrationDatabase("deadlines");
const { prismaDeadlineStore } = await import("@/lib/modules/deadlines/repository");

const day = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

const registration = (over: Partial<Parameters<typeof prismaDeadlineStore.upsertRegistration>[0]> = {}) => ({
  entityType: "document",
  entityId: "doc-1",
  deadlineType: "expiry",
  dueDate: day("2026-09-30"),
  jurisdictionId: "AE",
  ...over,
});

describe("upsertRegistration", () => {
  it("creates a registration and reads it back in the whole set", async () => {
    const created = await prismaDeadlineStore.upsertRegistration(registration());
    // toMatchObject, not toEqual: the store returns the raw row, which carries
    // createdAt as well as the fields the port names.
    expect(created).toMatchObject({
      id: expect.any(String),
      entityType: "document",
      entityId: "doc-1",
      deadlineType: "expiry",
      dueDate: day("2026-09-30"),
      jurisdictionId: "AE",
    });
    expect(await prismaDeadlineStore.listRegistrations()).toEqual([created]);
  });

  it("is idempotent on the triple, moving BOTH the date and the jurisdiction", async () => {
    const first = await prismaDeadlineStore.upsertRegistration(registration());
    const second = await prismaDeadlineStore.upsertRegistration(
      registration({ dueDate: day("2026-11-15"), jurisdictionId: "EG" }),
    );
    // One identity for one fact: same row, both new values, nothing added.
    expect(second.id).toBe(first.id);
    expect(second.dueDate).toEqual(day("2026-11-15"));
    expect(second.jurisdictionId).toBe("EG");
    expect(await prismaDeadlineStore.listRegistrations()).toHaveLength(1);
  });

  it("treats each part of the triple as part of the identity", async () => {
    await prismaDeadlineStore.upsertRegistration(registration());
    await prismaDeadlineStore.upsertRegistration(registration({ entityType: "tax-filing" }));
    await prismaDeadlineStore.upsertRegistration(registration({ entityId: "doc-2" }));
    await prismaDeadlineStore.upsertRegistration(registration({ deadlineType: "due" }));
    // Four rows, because changing any one segment is a different deadline.
    expect(await prismaDeadlineStore.listRegistrations()).toHaveLength(4);
  });

  it("accepts an entity and a jurisdiction that nothing in this database defines", async () => {
    // Deliberate, and the opposite of a foreign-key case: the row may point at a
    // Document, a TaxFiling or a BillablePosition, all owned elsewhere, and the
    // Kernel owns Jurisdiction (CLAUDE.md rule 1, ADR-021). A cross-owner FK is
    // what would stop this module being extracted. A jurisdiction with no
    // calendar surfaces at SCORING time as an incomplete RunScope, never here as
    // a write refusal — the write is not where that is caught.
    const created = await prismaDeadlineStore.upsertRegistration(
      registration({ entityType: "no-such-kind", entityId: "nothing", jurisdictionId: "ZZ" }),
    );
    expect(created.jurisdictionId).toBe("ZZ");
    expect(await prismaDeadlineStore.listRegistrations()).toHaveLength(1);
  });

  it("stores dueDate as a civil date, dropping any time carried in with it", async () => {
    // @db.Date. Distance is counted in whole days, so an instant late in the
    // evening must not become a different day than the one that was registered.
    const created = await prismaDeadlineStore.upsertRegistration(
      registration({ dueDate: new Date("2026-09-30T22:45:00.000Z") }),
    );
    expect(created.dueDate).toEqual(day("2026-09-30"));
  });

  it("cannot hold two rows for one triple", async () => {
    // Forced through db, because the port upserts and so can never violate this.
    await prismaDeadlineStore.upsertRegistration(registration());
    const refusal = await refusalFrom(db.deadlineRegistration.create({ data: registration() }));
    expect(refusal).toMatch(/[Uu]nique constraint/);
    expect(await prismaDeadlineStore.listRegistrations()).toHaveLength(1);
  });
});

describe("deleteRegistration", () => {
  it("removes the registration named by the triple, and leaves the others", async () => {
    await prismaDeadlineStore.upsertRegistration(registration());
    await prismaDeadlineStore.upsertRegistration(registration({ entityId: "doc-2" }));
    await prismaDeadlineStore.deleteRegistration({
      entityType: "document",
      entityId: "doc-1",
      deadlineType: "expiry",
    });
    const left = await prismaDeadlineStore.listRegistrations();
    expect(left).toHaveLength(1);
    expect(left[0].entityId).toBe("doc-2");
  });

  it("deregistering something that was never registered is not an error", async () => {
    // deleteMany, not delete. No state is kept about what was once watched, and
    // an alert resolves by absence from a complete report rather than by a
    // deletion succeeding.
    await expect(
      prismaDeadlineStore.deleteRegistration({
        entityType: "document",
        entityId: "never-here",
        deadlineType: "expiry",
      }),
    ).resolves.toBeUndefined();
  });

  it("deregistering twice is not an error either", async () => {
    const ref = { entityType: "document", entityId: "doc-1", deadlineType: "expiry" };
    await prismaDeadlineStore.upsertRegistration(registration());
    await prismaDeadlineStore.deleteRegistration(ref);
    await expect(prismaDeadlineStore.deleteRegistration(ref)).resolves.toBeUndefined();
    expect(await prismaDeadlineStore.listRegistrations()).toEqual([]);
  });
});

describe("listRegistrations", () => {
  it("answers an empty set rather than failing when nothing is registered", async () => {
    // An empty answer is an answer: a run over no registrations is a COMPLETE
    // report of nothing, which resolves every open alert in scope.
    expect(await prismaDeadlineStore.listRegistrations()).toEqual([]);
  });

  it("returns the whole set, unfiltered, across jurisdictions and entity types", async () => {
    await prismaDeadlineStore.upsertRegistration(registration({ entityId: "doc-1", dueDate: day("2026-09-01") }));
    await prismaDeadlineStore.upsertRegistration(registration({ entityId: "doc-2", dueDate: day("2026-09-02") }));
    await prismaDeadlineStore.upsertRegistration(
      registration({ entityType: "tax-filing", entityId: "f-1", jurisdictionId: "EG", dueDate: day("2026-09-03") }),
    );
    await prismaDeadlineStore.upsertRegistration(
      registration({ entityType: "tax-filing", entityId: "f-2", jurisdictionId: "EG", dueDate: day("2026-09-04") }),
    );
    await prismaDeadlineStore.upsertRegistration(
      registration({ entityType: "visa", entityId: "v-1", dueDate: day("2026-09-05") }),
    );
    // No filter anywhere in the port, deliberately: absence from a COMPLETE
    // report is what resolves an alert, so a store that quietly narrowed the set
    // would resolve alerts for deadlines it simply did not look at.
    const all = await prismaDeadlineStore.listRegistrations();
    expect(all).toHaveLength(5);
    expect(new Set(all.map((row) => row.jurisdictionId))).toEqual(new Set(["AE", "EG"]));
    expect(new Set(all.map((row) => row.entityType))).toEqual(new Set(["document", "tax-filing", "visa"]));
  });

  it("orders by dueDate ascending, whatever order they arrived in", async () => {
    // Distinct dates, per the convention at the top of this file.
    await prismaDeadlineStore.upsertRegistration(registration({ entityId: "c", dueDate: day("2026-12-01") }));
    await prismaDeadlineStore.upsertRegistration(registration({ entityId: "a", dueDate: day("2026-03-15") }));
    await prismaDeadlineStore.upsertRegistration(registration({ entityId: "b", dueDate: day("2026-07-04") }));
    expect((await prismaDeadlineStore.listRegistrations()).map((row) => row.entityId)).toEqual(["a", "b", "c"]);
  });
});

describe("listThresholds", () => {
  // Seeded through db throughout: the port reads ThresholdTable and never writes
  // it, so there is no port call that could put a row there.
  const threshold = (deadlineType: string, businessDaysBefore: number, severity: "minor" | "major") =>
    db.thresholdTable.create({ data: { deadlineType, businessDaysBefore, severity } });

  it("answers an empty set rather than failing when nothing is configured", async () => {
    // Not the same as "no threshold breached": an unconfigured type is a
    // misconfiguration the sweep reports, and it needs this to say so.
    expect(await prismaDeadlineStore.listThresholds()).toEqual([]);
  });

  it("returns every row, across deadline types", async () => {
    await threshold("expiry", 30, "minor");
    await threshold("expiry", 7, "major");
    await threshold("due", 14, "minor");
    expect(await prismaDeadlineStore.listThresholds()).toHaveLength(3);
  });

  it("orders by businessDaysBefore ascending", async () => {
    await threshold("expiry", 30, "minor");
    await threshold("expiry", 7, "major");
    await threshold("due", 14, "minor");
    expect((await prismaDeadlineStore.listThresholds()).map((row) => row.businessDaysBefore)).toEqual([7, 14, 30]);
  });

  it("carries severity as the string the module scores against", async () => {
    await threshold("expiry", 7, "major");
    const [row] = await prismaDeadlineStore.listThresholds();
    // The schema enum and the module's Severity union are the same two values;
    // a row that arrived as something else would make severityFor unsound.
    expect(row.severity).toBe("major");
  });

  it("cannot hold two rows for one deadline type and window", async () => {
    await threshold("expiry", 7, "minor");
    const refusal = await refusalFrom(threshold("expiry", 7, "major"));
    expect(refusal).toMatch(/[Uu]nique constraint/);
    // The reason the constraint exists: two rows for one window would make the
    // reported severity depend on row order, and severity is monotonic while an
    // alert is open — a value that flips is a resolve followed by a reopen.
    expect(await prismaDeadlineStore.listThresholds()).toHaveLength(1);
  });

  it("allows two deadline types to share one window", async () => {
    await threshold("expiry", 7, "major");
    await threshold("due", 7, "minor");
    // Which is exactly why an ordering case must seed distinct sort keys: these
    // two tie, and nothing promises which comes back first.
    expect(await prismaDeadlineStore.listThresholds()).toHaveLength(2);
  });
});
