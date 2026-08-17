// lib/kernel/enrolment/repository.ts against a real engine (ADR-038): all three
// exported functions, the (entity, regime) pair the schema makes unique, the
// upsert that pair makes idempotent, and the newest-first listing.
import { beforeEach, describe, expect, it } from "vitest";
import { integrationDatabase, refusalFrom } from "../support/database";

const db = await integrationDatabase("enrolment");
const { enrolmentFor, listEnrolments, recordEnrolment } = await import("@/lib/kernel/enrolment");

const day = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

let entityId = "";
let otherEntityId = "";
let vatId = "";
let taxId = "";

beforeEach(async () => {
  const jurisdiction = await db.jurisdiction.create({
    data: { code: "AE", name: "United Arab Emirates" },
  });
  entityId = (
    await db.legalEntity.create({ data: { name: "Reno Systems FZ-LLC", country: "AE", role: "self" } })
  ).id;
  otherEntityId = (
    await db.legalEntity.create({ data: { name: "Acme Trading LLC", country: "AE", role: "client" } })
  ).id;
  vatId = (
    await db.regime.create({
      data: {
        jurisdictionId: jurisdiction.id,
        obligationType: "vat",
        name: "UAE VAT",
        rate: "0.05",
        deadlineDays: 28,
      },
    })
  ).id;
  taxId = (
    await db.regime.create({
      data: {
        jurisdictionId: jurisdiction.id,
        obligationType: "corporate_tax",
        name: "UAE corporate tax",
        rate: "0.09",
        deadlineDays: 270,
      },
    })
  ).id;
});

const registration = (legalEntityId: string, regimeId: string, identifier: string, from: string) => ({
  legalEntityId,
  regimeId,
  identifier,
  frequency: "quarterly" as const,
  anchor: day("2026-01-01"),
  activeFrom: day(from),
  activeTo: null,
});

describe("recordEnrolment and enrolmentFor", () => {
  it("records the registration number, its cadence and what the period aligns to", async () => {
    const enrolment = await recordEnrolment(registration(entityId, vatId, "TRN-100000000000003", "2026-01-01"));
    expect(enrolment).toMatchObject({
      legalEntityId: entityId,
      regimeId: vatId,
      identifier: "TRN-100000000000003",
      frequency: "quarterly",
      anchor: day("2026-01-01"),
      activeFrom: day("2026-01-01"),
      activeTo: null,
      sourceDocumentId: null,
    });
    expect(await enrolmentFor(entityId, vatId)).toEqual(enrolment);
  });

  it("restates the one registration when the same certificate arrives twice", async () => {
    // The pair is unique, so a re-import cannot leave two registrations nobody
    // can tell apart.
    const first = await recordEnrolment(registration(entityId, vatId, "TRN-OLD", "2026-01-01"));
    const second = await recordEnrolment({
      ...registration(entityId, vatId, "TRN-100000000000003", "2026-01-01"),
      frequency: "monthly",
      activeTo: day("2026-12-31"),
    });
    expect(second.id).toBe(first.id);
    expect(second.identifier).toBe("TRN-100000000000003");
    expect(second.frequency).toBe("monthly");
    expect(second.activeTo).toEqual(day("2026-12-31"));
    expect(await listEnrolments()).toHaveLength(1);
  });

  it("cannot hold two rows for one entity and regime", async () => {
    await recordEnrolment(registration(entityId, vatId, "TRN-1", "2026-01-01"));
    const refusal = await refusalFrom(
      db.jurisdictionEnrolment.create({ data: registration(entityId, vatId, "TRN-2", "2026-01-01") }),
    );
    expect(refusal).toMatch(/[Uu]nique constraint/);
    expect(await listEnrolments()).toHaveLength(1);
  });

  it("answers null for a pair with no registration", async () => {
    await recordEnrolment(registration(entityId, vatId, "TRN-1", "2026-01-01"));
    expect(await enrolmentFor(entityId, taxId)).toBeNull();
    expect(await enrolmentFor(otherEntityId, vatId)).toBeNull();
  });

  it("carries the certificate when there is one, as evidence beside the record", async () => {
    const document = await db.document.create({
      data: { filename: "trn-certificate.pdf", mimeType: "application/pdf", direction: "inbound" },
    });
    const enrolment = await recordEnrolment({
      ...registration(entityId, vatId, "TRN-1", "2026-01-01"),
      sourceDocumentId: document.id,
    });
    expect(enrolment.sourceDocumentId).toBe(document.id);
  });

  it("refuses a regime that does not exist", async () => {
    expect(
      await refusalFrom(recordEnrolment(registration(entityId, "no-such-regime", "TRN-1", "2026-01-01"))),
    ).toMatch(/[Ff]oreign key/);
    expect(await listEnrolments()).toEqual([]);
  });
});

describe("listEnrolments", () => {
  beforeEach(async () => {
    await recordEnrolment(registration(entityId, vatId, "TRN-SELF-VAT", "2025-01-01"));
    await recordEnrolment(registration(entityId, taxId, "TRN-SELF-CT", "2026-06-01"));
    await recordEnrolment(registration(otherEntityId, vatId, "TRN-CLIENT-VAT", "2024-01-01"));
  });

  it("returns registrations newest first", async () => {
    expect((await listEnrolments()).map((row) => row.identifier)).toEqual([
      "TRN-SELF-CT",
      "TRN-SELF-VAT",
      "TRN-CLIENT-VAT",
    ]);
  });

  it("narrows by legal entity and by regime", async () => {
    expect((await listEnrolments({ legalEntityId: entityId })).map((row) => row.identifier)).toEqual([
      "TRN-SELF-CT",
      "TRN-SELF-VAT",
    ]);
    expect((await listEnrolments({ regimeId: vatId })).map((row) => row.identifier)).toEqual([
      "TRN-SELF-VAT",
      "TRN-CLIENT-VAT",
    ]);
    expect(
      (await listEnrolments({ legalEntityId: otherEntityId, regimeId: taxId })).map((row) => row.identifier),
    ).toEqual([]);
  });
});
