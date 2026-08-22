// lib/kernel/registry/repository.ts against a real engine (ADR-038): field
// schema and retention policy stored and read back as data (components-kernel.md
// row 15, data-retention.md), the (type) uniqueness the schema pins, and the
// "amend in place, no history table" update data-retention.md describes.
//
// Added by the feature tester under the allowlist amendment recorded for
// kernel-registry-fx: tests/integration/kernel/ joined this node's produces
// list so the repository layer gets real-engine coverage the static sweep in
// tests/kernel/kernel-registry-fx.test.ts cannot provide on its own.
import { beforeEach, describe, expect, it } from "vitest";
import { integrationDatabase, refusalFrom } from "../support/database";

await integrationDatabase("registry");
const {
  createDocumentType,
  documentTypeByType,
  getDocumentType,
  listDocumentTypes,
  updateDocumentType,
} = await import("@/lib/kernel/registry");

const SALES_INVOICE = {
  type: "sales_invoice",
  label: "Sales Invoice",
  category: "billing",
  fields: { number: "string", amount: "decimal", currency: "string" },
  retentionBasis: "end_of_tax_period",
  erasureMode: "redact_personal",
} as const;

describe("createDocumentType and getDocumentType", () => {
  it("stores the field schema and the retention policy as data", async () => {
    const created = await createDocumentType(SALES_INVOICE);
    expect(created).toMatchObject({
      id: expect.any(String),
      type: "sales_invoice",
      label: "Sales Invoice",
      category: "billing",
      fields: { number: "string", amount: "decimal", currency: "string" },
      retentionBasis: "end_of_tax_period",
      erasureMode: "redact_personal",
      legalHold: false,
    });
    expect(await getDocumentType(created.id)).toEqual(created);
  });

  it("defaults retentionYears to seven when the caller does not name one", async () => {
    const created = await createDocumentType(SALES_INVOICE);
    expect(created.retentionYears).toBe(7);
  });

  it("accepts an explicit retentionYears and legalHold", async () => {
    const created = await createDocumentType({
      ...SALES_INVOICE,
      type: "government_permit",
      retentionYears: 15,
      legalHold: true,
    });
    expect(created.retentionYears).toBe(15);
    expect(created.legalHold).toBe(true);
  });

  it("records the actor as given, and stamps updatedAt", async () => {
    const created = await createDocumentType({ ...SALES_INVOICE, updatedByUserId: "user-7" });
    expect(created.updatedByUserId).toBe("user-7");
    expect(created.updatedAt).toBeInstanceOf(Date);
  });

  it("answers null for an id that names nothing", async () => {
    expect(await getDocumentType("no-such-document-type")).toBeNull();
  });

  it("refuses a second type with the same key", async () => {
    await createDocumentType(SALES_INVOICE);
    expect(await refusalFrom(createDocumentType(SALES_INVOICE))).toMatch(
      /[Uu]nique constraint/,
    );
    expect(await listDocumentTypes()).toHaveLength(1);
  });
});

describe("documentTypeByType", () => {
  it("looks a type up by the string Document.docType carries, not by id", async () => {
    const created = await createDocumentType(SALES_INVOICE);
    const found = await documentTypeByType("sales_invoice");
    expect(found).toEqual(created);
  });

  it("answers null for a type nobody registered", async () => {
    expect(await documentTypeByType("no-such-type")).toBeNull();
  });
});

describe("listDocumentTypes", () => {
  beforeEach(async () => {
    await createDocumentType({ ...SALES_INVOICE, type: "supplier_invoice", category: "billing" });
    await createDocumentType({ ...SALES_INVOICE, type: "trade_licence", category: "government" });
    await createDocumentType({ ...SALES_INVOICE, type: "employment_contract", category: "hr" });
  });

  it("orders by type ascending", async () => {
    expect((await listDocumentTypes()).map((type) => type.type)).toEqual([
      "employment_contract",
      "supplier_invoice",
      "trade_licence",
    ]);
  });

  it("narrows by category", async () => {
    expect((await listDocumentTypes({ category: "billing" })).map((type) => type.type)).toEqual([
      "supplier_invoice",
    ]);
    expect(await listDocumentTypes({ category: "no-such-category" })).toEqual([]);
  });
});

describe("updateDocumentType", () => {
  let typeId = "";

  beforeEach(async () => {
    typeId = (await createDocumentType(SALES_INVOICE)).id;
  });

  it("amends the type in place — a plain write, never a new version", async () => {
    const updated = await updateDocumentType(typeId, { retentionYears: 10, legalHold: true });
    expect(updated.retentionYears).toBe(10);
    expect(updated.legalHold).toBe(true);
    // Only ever one row for this type: the registry keeps its latest actor
    // and timestamp, not a history table (data-retention.md).
    expect(await listDocumentTypes()).toHaveLength(1);
  });

  it("replaces the field schema wholesale when the patch carries one", async () => {
    const updated = await updateDocumentType(typeId, {
      fields: { number: "string", amount: "decimal", currency: "string", vat: "decimal" },
    });
    expect(updated.fields).toEqual({
      number: "string",
      amount: "decimal",
      currency: "string",
      vat: "decimal",
    });
  });

  it("leaves the field schema untouched when the patch does not name it", async () => {
    const updated = await updateDocumentType(typeId, { retentionYears: 5 });
    expect(updated.fields).toEqual(SALES_INVOICE.fields);
  });

  it("refuses an id that names nothing, rather than creating one", async () => {
    expect(
      await refusalFrom(updateDocumentType("no-such-document-type", { retentionYears: 3 })),
    ).toMatch(/[Rr]ecord to update not found|no-such-document-type/);
    expect(await listDocumentTypes()).toHaveLength(1);
  });
});
