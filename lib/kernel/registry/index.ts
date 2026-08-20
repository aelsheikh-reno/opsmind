// Document Type Registry — the field schema, the retention policy and (once
// IngestionRule lands) the ingestion rule catalogue for one document type, all
// held as data rather than as code: a statute changing or a new document type
// arriving is a Settings edit, never a release (components-kernel.md,
// data-retention.md, ADR-023).
//
// IngestionRule is deliberately NOT built here. components-kernel.md lists it
// alongside this table — "Field schemas + the ingestion rule catalogue +
// retention policy per type" — but open-items.md records it as one of the
// tables with no field-level shape anywhere in the spec: "A task reaching any
// of these finds a name in one cell of the ownership map and nothing else."
// Inventing a shape for it inside this task is exactly what spec-coverage-audit
// exists to prevent — "no shape is invented by that task, deliberately, so
// that a data model is never designed inside an implementation PR under a
// size budget." It arrives with the ingestion work, against its own card.

/**
 * What the retention clock counts from — it differs per statute, which is why
 * it is stored rather than assumed (data-retention.md).
 */
export type RetentionBasis = "end_of_financial_year" | "end_of_tax_period" | "document_date";

/**
 * How a data-subject erasure request is honoured for this type.
 * `redact_personal` clears the personal fields and leaves the financial
 * record standing — the reconciliation between statutory retention and PDPL
 * erasure; `full_delete` is for types no statute requires keeping. Exactly
 * these two values (ADR-023).
 */
export type ErasureMode = "redact_personal" | "full_delete";

export interface DocumentType {
  id: string;
  /** Matches Document.docType. */
  type: string;
  label: string;
  category: string;
  /**
   * The extraction schema handed to the parser on every call. Deliberately
   * opaque here, the same reasoning Regime.thresholds gives: no document in
   * this build states the shape once and for all, and the kernel guarantees
   * only that it is data on a row.
   */
  fields: unknown;
  retentionYears: number;
  retentionBasis: RetentionBasis;
  /** Blocks the purge job regardless of age, for disputes and investigations. */
  legalHold: boolean;
  erasureMode: ErasureMode;
  /**
   * Who last changed this type, and when. The registry keeps only the latest
   * actor and timestamp — data-retention.md's note explains why it is not
   * versioned instead: the retention policy actually applied to a purge or an
   * erasure is snapshotted onto the AuditEntry that action writes, so the
   * question "what governed this" is answered there, not by a history table
   * here.
   */
  updatedAt: Date;
  updatedByUserId: string | null;
}

/**
 * A type, a label, a category, a field schema, a basis and an erasure mode are
 * required at creation; retentionYears defaults to seven (data-retention.md),
 * legalHold defaults to false, and the actor is filled in as it is known.
 */
export type NewDocumentType = Pick<
  DocumentType,
  "type" | "label" | "category" | "fields" | "retentionBasis" | "erasureMode"
> &
  Partial<Pick<DocumentType, "retentionYears" | "legalHold" | "updatedByUserId">>;

/**
 * The retention deadline for one type, given the calendar date its clock
 * counts from — data-retention.md: "Each document type carries a retention
 * period, the basis it counts from." `basisDate` and the result are civil
 * dates read at UTC midnight, the storage convention data-model.md fixes for
 * every period end and expiry in this build; this is calendar-year addition,
 * not the business-day arithmetic CLAUDE.md rule 9 governs for a filing
 * deadline's distance.
 *
 * `null` while `legalHold` is set: the scheduled purge job that reads this is
 * told to skip the type outright — data-retention.md: "skipping anything
 * under legal hold" — rather than being handed a date it has to remember to
 * ignore.
 */
export function retentionDeadline(
  type: Pick<DocumentType, "retentionYears" | "legalHold">,
  basisDate: Date,
): Date | null {
  if (type.legalHold) return null;
  const deadline = new Date(basisDate);
  deadline.setUTCFullYear(deadline.getUTCFullYear() + type.retentionYears);
  return deadline;
}

export {
  createDocumentType,
  documentTypeByType,
  getDocumentType,
  listDocumentTypes,
  updateDocumentType,
} from "./repository";
