// lib/kernel/document/repository.ts against a real engine (ADR-038): all four
// exported functions, the exact-string money the Decimal columns must return,
// the newest-first listing, and what a missing row answers.
import { beforeEach, describe, expect, it } from "vitest";
import { integrationDatabase, refusalFrom } from "../support/database";

const db = await integrationDatabase("document");
const { getDocument, listDocuments, recordDocument, updateDocument } = await import(
  "@/lib/kernel/document"
);

const stampedAt = async (id: string, iso: string): Promise<void> => {
  await db.document.update({ where: { id }, data: { createdAt: new Date(iso) } });
};

describe("recordDocument", () => {
  it("files a document with the direction the caller decided", async () => {
    // direction has no default anywhere: a supplier bill counted as income is
    // the defect ADR-027 and CLAUDE.md rule 6 close.
    const filed = await recordDocument({
      filename: "invoice-0001.pdf",
      mimeType: "application/pdf",
      direction: "outbound",
    });
    expect(filed).toMatchObject({
      direction: "outbound",
      status: "processing",
      source: "upload",
      docType: null,
      amount: null,
      currency: null,
    });
    expect(await getDocument(filed.id)).toEqual(filed);
  });

  it("returns money as an exact string, never a float", async () => {
    const filed = await recordDocument({
      filename: "invoice-0002.pdf",
      mimeType: "application/pdf",
      direction: "inbound",
      amount: "1234.567",
      vatAmount: "61.728",
      currency: "AED",
    });
    expect(filed.amount).toBe("1234.567");
    expect(filed.vatAmount).toBe("61.728");
    expect((await getDocument(filed.id))?.amount).toBe("1234.567");
  });

  it("holds three decimal places, because KWD and BHD have three", async () => {
    const filed = await recordDocument({
      filename: "invoice-0003.pdf",
      mimeType: "application/pdf",
      direction: "inbound",
      amount: "12.345",
      currency: "KWD",
    });
    expect(filed.amount).toBe("12.345");
  });

  it("refuses a legal entity that does not exist", async () => {
    expect(
      await refusalFrom(
        recordDocument({
          filename: "orphan.pdf",
          mimeType: "application/pdf",
          direction: "inbound",
          legalEntityId: "no-such-entity",
        }),
      ),
    ).toMatch(/[Ff]oreign key/);
    expect(await listDocuments()).toEqual([]);
  });
});

describe("getDocument", () => {
  it("answers null for an id that names nothing", async () => {
    expect(await getDocument("no-such-document")).toBeNull();
  });
});

describe("listDocuments", () => {
  let entityId = "";

  beforeEach(async () => {
    entityId = (
      await db.legalEntity.create({ data: { name: "Acme Trading LLC", country: "KW", role: "client" } })
    ).id;
    const bill = await recordDocument({
      filename: "bill.pdf",
      mimeType: "application/pdf",
      direction: "inbound",
      docType: "supplier_invoice",
    });
    const invoice = await recordDocument({
      filename: "invoice.pdf",
      mimeType: "application/pdf",
      direction: "outbound",
      docType: "sales_invoice",
      legalEntityId: entityId,
    });
    const licence = await recordDocument({
      filename: "licence.pdf",
      mimeType: "application/pdf",
      direction: "inbound",
      docType: "trade_licence",
      legalEntityId: entityId,
    });
    // Stamped rather than raced: two rows created in the same millisecond make
    // a "newest first" assertion depend on the engine's clock resolution.
    await stampedAt(bill.id, "2026-01-01T09:00:00.000Z");
    await stampedAt(invoice.id, "2026-02-01T09:00:00.000Z");
    await stampedAt(licence.id, "2026-03-01T09:00:00.000Z");
  });

  it("returns everything newest first", async () => {
    expect((await listDocuments()).map((document) => document.filename)).toEqual([
      "licence.pdf",
      "invoice.pdf",
      "bill.pdf",
    ]);
  });

  it("narrows by direction, by type and by legal entity", async () => {
    expect((await listDocuments({ direction: "inbound" })).map((document) => document.filename)).toEqual([
      "licence.pdf",
      "bill.pdf",
    ]);
    expect((await listDocuments({ docType: "sales_invoice" })).map((document) => document.filename)).toEqual(
      ["invoice.pdf"],
    );
    expect((await listDocuments({ legalEntityId: entityId })).map((document) => document.filename)).toEqual([
      "licence.pdf",
      "invoice.pdf",
    ]);
    expect(await listDocuments({ direction: "outbound", docType: "trade_licence" })).toEqual([]);
  });
});

describe("updateDocument", () => {
  it("fills in what extraction found later, leaving the filed record standing", async () => {
    const filed = await recordDocument({
      filename: "invoice-0004.pdf",
      mimeType: "application/pdf",
      direction: "inbound",
    });
    const updated = await updateDocument(filed.id, {
      docType: "supplier_invoice",
      confidence: 0.94,
      amount: "500.250",
      currency: "AED",
      status: "extracted",
    });
    expect(updated).toEqual({
      ...filed,
      docType: "supplier_invoice",
      confidence: 0.94,
      amount: "500.25",
      currency: "AED",
      status: "extracted",
    });
  });

  it("refuses an id that names nothing, rather than creating one", async () => {
    expect(await refusalFrom(updateDocument("no-such-document", { status: "extracted" }))).toMatch(
      /[Rr]ecord to update not found|no-such-document/,
    );
    expect(await listDocuments()).toEqual([]);
  });
});
