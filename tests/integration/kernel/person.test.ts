// lib/kernel/person/repository.ts against a real engine (ADR-038): all six
// exported functions, the org-chart filter, the newest-first ordering of
// enrolments, and what a missing row answers.
import { beforeEach, describe, expect, it } from "vitest";
import { integrationDatabase, refusalFrom } from "../support/database";

const db = await integrationDatabase("person");
const { createPerson, getPerson, listPeople, listPersonEnrolments, recordPersonEnrolment, updatePerson } =
  await import("@/lib/kernel/person");

const day = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

describe("createPerson and getPerson", () => {
  it("stores the HR record and returns weeklyHours as an exact string", async () => {
    // Decimal leaves the kernel as a string; a float here is a rounding error
    // in a prorata calculation later (CLAUDE.md, money and dates).
    const created = await createPerson({ name: "Layla Hassan", email: "layla@example.com" });
    expect(created.weeklyHours).toBe("40");
    expect(created.employmentType).toBe("fulltime");
    expect(created.payslipInContractCurrency).toBe(false);
    expect(await getPerson(created.id)).toEqual(created);
  });

  it("keeps a part-time week at the hours it was given", async () => {
    const created = await createPerson({ name: "Omar Nabil", weeklyHours: "22.5", employmentType: "parttime" });
    expect(created.weeklyHours).toBe("22.5");
    expect((await getPerson(created.id))?.weeklyHours).toBe("22.5");
  });

  it("answers null for an id that names nothing", async () => {
    expect(await getPerson("no-such-person")).toBeNull();
  });
});

describe("listPeople", () => {
  it("orders by name ascending", async () => {
    for (const name of ["Zara Ahmed", "Ali Mansour", "Mona Fawzy"]) await createPerson({ name });
    expect((await listPeople()).map((person) => person.name)).toEqual([
      "Ali Mansour",
      "Mona Fawzy",
      "Zara Ahmed",
    ]);
  });

  it("narrows to the direct reports of one manager — the org chart, one level", async () => {
    const manager = await createPerson({ name: "Ali Mansour" });
    const report = await createPerson({ name: "Mona Fawzy", managerId: manager.id });
    const indirect = await createPerson({ name: "Zara Ahmed", managerId: report.id });
    expect((await listPeople({ managerId: manager.id })).map((person) => person.name)).toEqual([
      "Mona Fawzy",
    ]);
    expect((await listPeople({ managerId: report.id })).map((person) => person.id)).toEqual([indirect.id]);
  });
});

describe("updatePerson", () => {
  it("amends the record — a promotion, a manager change, a leaving date", async () => {
    const manager = await createPerson({ name: "Ali Mansour" });
    const person = await createPerson({ name: "Mona Fawzy", jobTitle: "Consultant" });
    const updated = await updatePerson(person.id, {
      jobTitle: "Senior Consultant",
      managerId: manager.id,
      exitDate: day("2026-09-30"),
      exitReason: "resignation",
    });
    expect(updated).toEqual({
      ...person,
      jobTitle: "Senior Consultant",
      managerId: manager.id,
      exitDate: day("2026-09-30"),
      exitReason: "resignation",
    });
  });

  it("refuses an id that names nothing, rather than creating one", async () => {
    expect(await refusalFrom(updatePerson("no-such-person", { jobTitle: "Partner" }))).toMatch(
      /[Rr]ecord to update not found|no-such-person/,
    );
    expect(await listPeople()).toEqual([]);
  });
});

describe("recordPersonEnrolment and listPersonEnrolments", () => {
  let personId = "";
  let egyptId = "";
  let uaeId = "";

  beforeEach(async () => {
    personId = (await createPerson({ name: "Mona Fawzy" })).id;
    egyptId = (await db.jurisdiction.create({ data: { code: "EG", name: "Egypt" } })).id;
    uaeId = (await db.jurisdiction.create({ data: { code: "AE", name: "United Arab Emirates" } })).id;
  });

  it("records a registration and returns its validity dates", async () => {
    const enrolment = await recordPersonEnrolment({
      personId,
      jurisdictionId: egyptId,
      obligationType: "social_insurance",
      identifier: "SI-2026-0001",
      activeFrom: day("2026-01-01"),
    });
    expect(enrolment).toMatchObject({
      personId,
      jurisdictionId: egyptId,
      obligationType: "social_insurance",
      identifier: "SI-2026-0001",
      activeFrom: day("2026-01-01"),
      activeTo: null,
    });
  });

  it("returns registrations newest first, and narrows by jurisdiction and obligation", async () => {
    // How payroll finds the social insurance number for the country it is
    // running. No "as at a date" filter exists to be tested — see the note on
    // listPersonEnrolments.
    await recordPersonEnrolment({
      personId,
      jurisdictionId: egyptId,
      obligationType: "social_insurance",
      identifier: "SI-OLD",
      activeFrom: day("2024-01-01"),
      activeTo: day("2025-12-31"),
    });
    await recordPersonEnrolment({
      personId,
      jurisdictionId: egyptId,
      obligationType: "social_insurance",
      identifier: "SI-NEW",
      activeFrom: day("2026-01-01"),
    });
    await recordPersonEnrolment({
      personId,
      jurisdictionId: uaeId,
      obligationType: "corporate_tax",
      identifier: "CT-AE",
      activeFrom: day("2025-06-01"),
    });

    expect((await listPersonEnrolments(personId)).map((row) => row.identifier)).toEqual([
      "SI-NEW",
      "CT-AE",
      "SI-OLD",
    ]);
    expect(
      (await listPersonEnrolments(personId, { jurisdictionId: egyptId })).map((row) => row.identifier),
    ).toEqual(["SI-NEW", "SI-OLD"]);
    expect(
      (await listPersonEnrolments(personId, { obligationType: "corporate_tax" })).map((row) => row.identifier),
    ).toEqual(["CT-AE"]);
  });

  it("returns nothing for a person with no registrations", async () => {
    const other = await createPerson({ name: "Omar Nabil" });
    await recordPersonEnrolment({
      personId,
      jurisdictionId: egyptId,
      obligationType: "vat",
      identifier: "VAT-1",
      activeFrom: day("2026-01-01"),
    });
    expect(await listPersonEnrolments(other.id)).toEqual([]);
  });

  it("refuses a registration in a jurisdiction that does not exist", async () => {
    expect(
      await refusalFrom(
        recordPersonEnrolment({
          personId,
          jurisdictionId: "no-such-jurisdiction",
          obligationType: "vat",
          identifier: "VAT-1",
          activeFrom: day("2026-01-01"),
        }),
      ),
    ).toMatch(/[Ff]oreign key/);
    expect(await listPersonEnrolments(personId)).toEqual([]);
  });
});
