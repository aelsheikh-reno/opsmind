// owns: AuditEntry
import { Prisma } from "@prisma/client";
import type { AuditEntry as AuditEntryRow } from "@prisma/client";
import { db } from "@/lib/db";
import { redact } from "./index";
import type { AuditEntry, NewAuditEntry } from "./index";

// No Decimal column on AuditEntry, so the row Prisma returns already has this
// component's shape.
const toAuditEntry = (row: AuditEntryRow): AuditEntry => row;

// Prisma distinguishes "leave this column alone" from "write SQL NULL", and a
// bare null means neither for a JSON column — see Regime.repository's `json`.
const json = (value: unknown) =>
  value === null || value === undefined ? Prisma.DbNull : (value as Prisma.InputJsonValue);

/** Appends one entry. There is no plain update beside redactEntry — the log is append-only. */
export async function recordEntry(input: NewAuditEntry): Promise<AuditEntry> {
  const { details, ...rest } = input;
  const row = await db.auditEntry.create({ data: { ...rest, details: json(details) } });
  return toAuditEntry(row);
}

/** One entity's history, oldest first — the order an in-product timeline reads. */
export async function entriesFor(entityType: string, entityId: string): Promise<AuditEntry[]> {
  const rows = await db.auditEntry.findMany({
    where: { entityType, entityId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toAuditEntry);
}

export async function listEntries(filter: { entityType?: string } = {}): Promise<AuditEntry[]> {
  const rows = await db.auditEntry.findMany({ where: filter, orderBy: { createdAt: "desc" } });
  return rows.map(toAuditEntry);
}

/**
 * The one write an entry may receive after it exists: a PDPL erasure clearing
 * its personal fields in place, per lib/kernel/audit's redact(). Never a
 * delete — the row and its place in the timeline survive (ADR-023,
 * components-kernel.md: "erasure = redaction, not deletion").
 */
export async function redactEntry(
  id: string,
  redactedBy: string,
  redactionReason: string,
): Promise<AuditEntry> {
  const current = toAuditEntry(await db.auditEntry.findUniqueOrThrow({ where: { id } }));
  const redacted = redact(current, redactedBy, redactionReason);
  const row = await db.auditEntry.update({
    where: { id },
    data: {
      entityLabel: redacted.entityLabel,
      details: json(redacted.details),
      actorName: redacted.actorName,
      redactedAt: redacted.redactedAt,
      redactedBy: redacted.redactedBy,
      redactionReason: redacted.redactionReason,
    },
  });
  return toAuditEntry(row);
}
