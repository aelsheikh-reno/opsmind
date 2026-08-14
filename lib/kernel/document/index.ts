// Document — files and the metadata extracted from them. Evidence, never the
// record itself (CLAUDE.md rule 7): a salary lives in a schedule you can query
// and the signed PDF sits alongside it as proof.
//
// Payment state is not here and never will be. There is no isPaid column and no
// paidAt; whether something is settled is derived from Settlement rows owned by
// Finance (rule 5, ADR-015). The legacy Document carried both flags, set by an
// AI extraction, which is the defect that rule exists to close.

/** Which way value flows. Stated on the row, never inferred (rule 6). */
export type Direction = "inbound" | "outbound";

export interface Document {
  id: string;
  filename: string;
  mimeType: string;
  /** Where it came from: "upload", an inbox, a drive sync. */
  source: string;
  status: string;
  /**
   * NOT NULL, and no default. A supplier bill counted as income is exactly the
   * defect this closes (ADR-027). A document arriving with an undeterminable
   * direction becomes a work item for a human; it does not become an inbound
   * row because inbound was the cheaper guess (rule 8).
   */
  direction: Direction;
  /** Matches DocumentType.type in the registry, once that lands. */
  docType: string | null;
  /** The extractor's own confidence, which is what a threshold is applied to. */
  confidence: number | null;
  legalEntityId: string | null;
  issueDate: Date | null;
  expiryDate: Date | null;
  renewalDeadline: Date | null;
  /**
   * Exact decimal strings, never floats — money does not survive binary
   * rounding. Independently optional from `currency`: schema.prisma notes a
   * document can be filed before its value is extracted, so an amount without a
   * currency is representable and is ingestion's validation problem.
   */
  amount: string | null;
  vatAmount: string | null;
  currency: string | null;
  referenceNumber: string | null;
  filePath: string | null;
  fileHash: string | null;
}

/** An amount that states its currency and its direction — all three or none. */
export interface SignedAmount {
  amount: string;
  currency: string;
  direction: Direction;
}

/** Filename, mime type and direction are required; everything else is extracted later. */
export type NewDocument = Pick<Document, "filename" | "mimeType" | "direction"> &
  Partial<Omit<Document, "id" | "filename" | "mimeType" | "direction">>;

/**
 * The document's value as money that carries its own direction (rule 6).
 *
 * Null when there is no amount, and equally null when there is an amount but no
 * currency: a bare number means nothing, and defaulting it to a house currency
 * would turn an extraction gap into a wrong figure in a cash forecast. Refusing
 * to answer is the behaviour rule 8 asks for.
 */
export function documentAmount(document: Document): SignedAmount | null {
  if (document.amount === null || document.currency === null) return null;
  return { amount: document.amount, currency: document.currency, direction: document.direction };
}

export { getDocument, listDocuments, recordDocument, updateDocument } from "./repository";
