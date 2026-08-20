// owns: DocumentType
//
// The one file in this component that reaches the database (CLAUDE.md rule
// 3), through the single client in lib/db.ts (data-ownership.md).
import type { Prisma } from "@prisma/client";
import type { DocumentType as DocumentTypeRow } from "@prisma/client";
import { db } from "@/lib/db";
import type { DocumentType, NewDocumentType } from "./index";

// No conversion needed: DocumentType carries no Decimal column, so the row
// Prisma returns already has the shape this component promises.
const toDocumentType = (row: DocumentTypeRow): DocumentType => row;

export async function getDocumentType(id: string): Promise<DocumentType | null> {
  const row = await db.documentType.findUnique({ where: { id } });
  return row && toDocumentType(row);
}

/**
 * The lookup ingestion actually makes: the schema and the policy for one
 * type, keyed on the same string Document.docType carries.
 */
export async function documentTypeByType(type: string): Promise<DocumentType | null> {
  const row = await db.documentType.findUnique({ where: { type } });
  return row && toDocumentType(row);
}

export async function listDocumentTypes(
  filter: { category?: string } = {},
): Promise<DocumentType[]> {
  const rows = await db.documentType.findMany({ where: filter, orderBy: { type: "asc" } });
  return rows.map(toDocumentType);
}

export async function createDocumentType(input: NewDocumentType): Promise<DocumentType> {
  const row = await db.documentType.create({
    data: { ...input, fields: input.fields as Prisma.InputJsonValue },
  });
  return toDocumentType(row);
}

/**
 * Amends a type in place — a field added to the schema, a retention year
 * corrected once the accountant confirms it. The registry keeps only its
 * latest actor and timestamp (data-retention.md), so an update is a plain
 * write rather than a new version.
 */
export async function updateDocumentType(
  id: string,
  patch: Partial<NewDocumentType>,
): Promise<DocumentType> {
  const { fields, ...rest } = patch;
  const row = await db.documentType.update({
    where: { id },
    data: { ...rest, ...(fields !== undefined ? { fields: fields as Prisma.InputJsonValue } : {}) },
  });
  return toDocumentType(row);
}
