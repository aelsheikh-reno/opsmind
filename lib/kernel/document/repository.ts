// owns: Document
import type { Document as DocumentRow } from "@prisma/client";
import { db } from "@/lib/db";
import type { Direction, Document, NewDocument } from "./index";

const toDocument = (row: DocumentRow): Document => ({
  ...row,
  amount: row.amount?.toString() ?? null,
  vatAmount: row.vatAmount?.toString() ?? null,
});

export async function getDocument(id: string): Promise<Document | null> {
  const row = await db.document.findUnique({ where: { id } });
  return row && toDocument(row);
}

export async function listDocuments(
  filter: { direction?: Direction; docType?: string; legalEntityId?: string } = {},
): Promise<Document[]> {
  const rows = await db.document.findMany({ where: filter, orderBy: { createdAt: "desc" } });
  return rows.map(toDocument);
}

/**
 * Files a document. `direction` is a required argument with no default: the
 * caller has to have decided which way the value flows before the row exists,
 * and an ingestion run that cannot decide raises a work item instead of calling
 * this (ADR-027, CLAUDE.md rules 6 and 8).
 */
export async function recordDocument(input: NewDocument): Promise<Document> {
  return toDocument(await db.document.create({ data: input }));
}

/** Fills in what extraction found later; the file itself is already the record. */
export async function updateDocument(id: string, patch: Partial<NewDocument>): Promise<Document> {
  return toDocument(await db.document.update({ where: { id }, data: patch }));
}
