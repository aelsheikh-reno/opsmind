// Audit — the append-only activity log read back by in-product timelines
// (components-kernel.md). Nothing in this build ever deletes or amends an
// entry in the ordinary sense: a redaction clears the personal fields on a
// surviving row and records that it happened, so the row and its place in the
// timeline never disappear (ADR-023, data-retention.md — "The audit log stays
// append-only; redaction inside entries resolves the deletion/immutability
// tension").
//
// The public surface says so directly: there is no generic "update" here,
// only recordEntry, which appends, and redactEntry, which is the one write a
// row may receive after it exists — and whose shape this file decides, not a
// caller's.
import type { ErasureMode, RetentionBasis } from "@/lib/kernel/registry";

export interface AuditEntry {
  id: string;
  createdAt: Date;
  /** What happened, and to what. */
  action: string;
  entityType: string;
  entityId: string | null;
  entityLabel: string | null;
  details: unknown;
  /**
   * The actor, copied rather than joined: an entry must still read correctly
   * after the account is deactivated, and no foreign key may put the log at
   * the mercy of another row's deletion.
   */
  actorUserId: string | null;
  actorName: string | null;
  /**
   * The retention policy actually applied, snapshotted at the moment a purge
   * or an erasure ran — null on every other kind of entry. data-retention.md's
   * note explains why DocumentType is not versioned instead: the question
   * "what policy governed this action" is answered by what is copied here,
   * not by a history table on the registry.
   */
  appliedRetentionYears: number | null;
  appliedRetentionBasis: RetentionBasis | null;
  appliedErasureMode: ErasureMode | null;
  /** Set once this entry has been redacted; null means it is still intact. */
  redactedAt: Date | null;
  redactedBy: string | null;
  redactionReason: string | null;
}

/**
 * action and entityType are required on every entry; a new entry cannot
 * already be redacted, so the three redaction fields are not accepted here —
 * they exist only on the write redactEntry makes.
 */
export type NewAuditEntry = Pick<AuditEntry, "action" | "entityType"> &
  Partial<
    Omit<
      AuditEntry,
      "id" | "createdAt" | "action" | "entityType" | "redactedAt" | "redactedBy" | "redactionReason"
    >
  >;

/**
 * The write a PDPL erasure request makes on one entry: personal fields
 * cleared, the redaction itself recorded, everything else left standing.
 * schema.prisma's AuditEntry states exactly which three columns this is —
 * "erasure request has redacted entityLabel, details and actorName" — so
 * `action`, `entityType`, `entityId` and the applied-policy columns survive
 * and the entry still reads as an entry rather than a hole in the timeline.
 *
 * `actorUserId` is deliberately NOT cleared: it is an id with no foreign key,
 * kept for the audit trail's own integrity, and clearing it would make a
 * redacted entry indistinguishable from one nobody ever attributed.
 */
export function redact(
  entry: AuditEntry,
  redactedBy: string,
  redactionReason: string,
  redactedAt: Date = new Date(),
): AuditEntry {
  return {
    ...entry,
    entityLabel: null,
    details: null,
    actorName: null,
    redactedAt,
    redactedBy,
    redactionReason,
  };
}

export { entriesFor, listEntries, recordEntry, redactEntry } from "./repository";
