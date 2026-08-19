// owns: Alert, AlertArea, AlertEvent, AlertSource
//
// The only file in this service that reaches the database, and it touches those
// four tables only (CLAUDE.md rules 1 and 3). ADR-039 makes this an importable
// package on the host's storage, so exclusive table ownership — not the
// network — is the whole of its boundary, and the line above declares it.
// The client is imported, never constructed: `lib/db.ts` holds the single
// PrismaClient and therefore the single pool, and a repository that built its
// own would give this service a pool against a database sized for one
// application. Every repository copies that line.
import { db } from "@/lib/db";
import type { $Enums, Prisma } from "@prisma/client";

import type { AlertIdentity, AlertRecord, AlertState } from "./index";

/** An alert as stored: the lifecycle's record, plus the row identity its
 *  append-only events hang off. */
export interface StoredAlert extends AlertRecord {
  id: string;
}

/** One thing that happened to an alert. Keyed by `alertId` rather than by
 *  identity, because an event is written against a row already read. */
export interface NewAlertEvent {
  alertId: string;
  at: Date;
  kind: $Enums.AlertEventKind;
  /** Null where the kind changes no state — a reassert, or a stale flag. */
  fromState?: AlertState | null;
  toState?: AlertState | null;
  /** Null means the source or the engine did it, never a human. */
  actor?: string | null;
  runId?: string | null;
  reason?: string | null;
}

/** A source and its cadence. `expectedEvery` counts no unit yet — see the
 *  schema; nothing supplies a non-null value until one is decided. */
export interface NewAlertSource {
  sourceId: string;
  kind: $Enums.AlertSourceKind;
  expectedEvery?: number | null;
  lastRunAt?: Date | null;
  lastRunId?: string | null;
}

type AlertRow = Prisma.AlertGetPayload<{ include: { areas: true } }>;

// Ordered only so two reads of one alert compare equal; nothing ranks areas.
const withAreas = { areas: { orderBy: { area: "asc" } } } as const;

function toStored(row: AlertRow): StoredAlert {
  return {
    id: row.id,
    sourceId: row.sourceId,
    fingerprint: row.fingerprint,
    state: row.state,
    stale: row.stale,
    severity: row.severity,
    policyId: row.policyId,
    areas: row.areas.map(({ area }) => area),
    context: row.context as Record<string, unknown>,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    resolvedAt: row.resolvedAt,
  };
}

export const prismaAlertStore = {
  /** Idempotent by (sourceId, fingerprint): the unique index IS the dedupe, and
   *  a resolved row is reopened in place rather than replaced. */
  async upsertAlert(record: AlertRecord): Promise<StoredAlert> {
    const { sourceId, fingerprint, areas, context, firstSeenAt, ...rest } = record;
    const fields = { ...rest, context: context as Prisma.InputJsonObject };
    // Nested writes rather than an interactive transaction: they run as one
    // statement group, and a `tx` handle would put these tables outside what
    // scripts/check-boundaries.sh can read against the declaration above.
    const row = await db.alert.upsert({
      where: { sourceId_fingerprint: { sourceId, fingerprint } },
      create: { ...fields, sourceId, fingerprint, firstSeenAt, areas: { create: areas.map((area) => ({ area })) } },
      // firstSeenAt is absent here because it survives re-firing. The area set
      // is replaced rather than accumulated — an alert must not keep claiming a
      // scope it has left, or nothing there can ever resolve it by absence.
      update: {
        ...fields,
        areas: {
          deleteMany: { area: { notIn: [...areas] } },
          createMany: { data: areas.map((area) => ({ area })), skipDuplicates: true },
        },
      },
      include: withAreas,
    });
    return toStored(row);
  },

  /** Null for an identity nothing has raised: resolving an unknown fingerprint
   *  is specified to succeed, so the layer above must be able to ask. */
  async getAlert(identity: AlertIdentity): Promise<StoredAlert | null> {
    const row = await db.alert.findUnique({ where: { sourceId_fingerprint: identity }, include: withAreas });
    return row === null ? null : toStored(row);
  },

  // Ordered by an instant, never by text: a text ordering reads one way on
  // PGlite and another in CI, which ADR-038 spent a whole finding discovering.
  async listAlerts(): Promise<StoredAlert[]> {
    const rows = await db.alert.findMany({ include: withAreas, orderBy: { firstSeenAt: "asc" } });
    return rows.map(toStored);
  },

  // Append only. There is no update and no delete for an event anywhere in this
  // service: the alert row carries current state, and this is why it is trusted.
  recordAlertEvent(event: NewAlertEvent) {
    return db.alertEvent.create({ data: event });
  },

  /** The history of one alert, oldest first. Tied instants are broken by id, so
   *  a log written inside one millisecond still reads back in one order. */
  listAlertEvents(alertId: string) {
    return db.alertEvent.findMany({ where: { alertId }, orderBy: [{ at: "asc" }, { id: "asc" }] });
  },

  /** One row per source, moving when it last spoke in place: a second row would
   *  let one source read as both alive and dark. */
  upsertAlertSource(source: NewAlertSource) {
    const { sourceId, ...rest } = source;
    return db.alertSource.upsert({ where: { sourceId }, create: source, update: rest });
  },

  // Null means no configuration row at all, which is not the same fact as a
  // registered source that has never spoken — that one has a null lastRunAt.
  getAlertSource(sourceId: string) {
    return db.alertSource.findUnique({ where: { sourceId } });
  },
};
