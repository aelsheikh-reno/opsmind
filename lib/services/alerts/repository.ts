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

/** An event before the row it hangs off exists: `alertId` is assigned by the
 *  same write, so a caller cannot supply it and cannot get it wrong. */
export type AlertChange = Omit<NewAlertEvent, "alertId">;

/** A source and its cadence. `expectedEvery` counts no unit yet — see the
 *  schema; nothing supplies a non-null value until one is decided. */
export interface NewAlertSource {
  sourceId: string;
  kind: $Enums.AlertSourceKind;
  /**
   * DELIBERATELY UNWRITEABLE UNTIL THE UNIT IS RULED. The card types this
   * `interval` and Prisma has no interval scalar, so the column is an Int with
   * nothing anywhere fixing whether it counts seconds, minutes or hours —
   * service-alerts-source-registry decides that. A comment saying "nothing
   * writes a non-null value yet" is a convention; `null` as the only accepted
   * value is the compiler enforcing it, and widening this line is the one edit
   * that node has to make on purpose.
   */
  expectedEvery?: null;
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

// The arguments only, so the one upsert has one definition and both writers
// below reach the table lexically — a delegate behind a helper's own parameter
// is invisible to scripts/check-boundaries.sh's handle reader.
function alertUpsert(record: AlertRecord) {
  const { sourceId, fingerprint, areas, context, firstSeenAt, ...rest } = record;
  const fields = { ...rest, context: context as Prisma.InputJsonObject };
  return {
    where: { sourceId_fingerprint: { sourceId, fingerprint } },
    create: { ...fields, sourceId, fingerprint, firstSeenAt, areas: { create: areas.map((area) => ({ area })) } },
    // firstSeenAt is absent here because it survives re-firing. The area set is
    // replaced rather than accumulated — an alert must not keep claiming a
    // scope it has left, or nothing there can ever resolve it by absence.
    update: {
      ...fields,
      areas: {
        deleteMany: { area: { notIn: [...areas] } },
        createMany: { data: areas.map((area) => ({ area })), skipDuplicates: true },
      },
    },
    include: withAreas,
  };
}

export const prismaAlertStore = {
  /** Idempotent by (sourceId, fingerprint): the unique index IS the dedupe, and
   *  a resolved row is reopened in place rather than replaced. */
  async upsertAlert(record: AlertRecord): Promise<StoredAlert> {
    // Nested writes rather than an interactive transaction: they run as one
    // statement group, which is all this verb on its own needs.
    const row = await db.alert.upsert(alertUpsert(record));
    return toStored(row);
  },

  /**
   * A state change and the event recording it, committed together or not at all.
   *
   * Two awaits left the alert moved with nothing in the log when the second
   * failed — current state stayed right and the history gained a hole, which for
   * a compliance alert is the evidence gone. The order cannot be reversed
   * instead: the event needs the id the upsert returns.
   */
  async applyAlertChange(record: AlertRecord, change: AlertChange): Promise<StoredAlert> {
    const args = alertUpsert(record);
    return db.$transaction(async (write) => {
      const row = await write.alert.upsert(args);
      await write.alertEvent.create({ data: { ...change, alertId: row.id } });
      return toStored(row);
    });
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
