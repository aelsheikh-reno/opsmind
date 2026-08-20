// The Alert Manager's public surface. Everything outside this service reaches
// it through this file and through nothing else (CLAUDE.md rule 4) — the seam
// is the same call whether this is a folder or a container (ADR-021), and it
// STAYS a function call: the reuse target is an importable package, not a
// deployment, so there is no HTTP client here and no token to rotate (ADR-039).
//
// Shape: pure domain in lifecycle.ts taking values rather than clients, this
// file the only thing a caller may import, and the store arriving as a port.

import { isResolved, openAlert, raiseKind, reassert, resolveAlert as closeAlert } from "./lifecycle";
import type { AlertIdentity, AlertRaise, AlertRecord, AlertSeverity } from "./lifecycle";
import type { AlertChange, NewAlertEvent, StoredAlert } from "./repository";

export {
  acknowledge,
  ALERT_STATES,
  clearStale,
  isMoreSevere,
  isOpen,
  isResolved,
  markStale,
  OPEN_STATES,
  openAlert,
  raisedSeverity,
  raiseKind,
  reassert,
  resolveAlert,
  sameIdentity,
  suppress,
} from "./lifecycle";
export type {
  AlertEventKind,
  AlertIdentity,
  AlertRaise,
  AlertRecord,
  AlertSeverity,
  AlertState,
} from "./lifecycle";

/** The Prisma store, for a host to bind. Nothing outside this service reaches
 *  repository.ts directly (CLAUDE.md rule 4); this line is how it is offered. */
export { prismaAlertStore } from "./repository";
export type { AlertChange, NewAlertEvent, NewAlertSource, StoredAlert } from "./repository";

/**
 * One condition a repeating caller found, inside the one run that found it.
 *
 * `area` travels with the alert because resolution by absence is only sound
 * inside a scope the run declared checked, and the fingerprint carries no
 * scope. It is the CALLER'S key, in the caller's own vocabulary: this engine
 * compares it and never interprets it, and it deliberately spells nothing this
 * application happens to scope by (ADR-043).
 */
export interface ReportedAlert {
  fingerprint: string;
  severity: AlertSeverity;
  area: string;
}

/**
 * One unit of completeness in a run, and whether the run finished it.
 *
 * Absence from a COMPLETE report is what resolves; absence from an incomplete
 * one resolves nothing and marks the alerts in that scope unconfirmed. A run
 * may be complete for part of its work and not the rest, and reporting the
 * healthy scopes while naming the broken one beats taking everything dark.
 */
export interface RunScope {
  area: string;
  complete: boolean;
  /** Why the run did not finish it. Absent when complete; it becomes the
   *  recorded reason an alert in this scope was flagged unconfirmed. */
  reason?: string;
}

/**
 * The port. This is the shape callers already compile against, so it is fixed
 * rather than draft: the first two verbs are the merged pair a caller is
 * already calling, and `resolveAlert` is the third of the contract's five.
 *
 * `areas` on a raise are the caller's own opaque scope keys, in the SAME
 * vocabulary as RunScope — one contract, not two. An alert closes only inside
 * an area some run declared checked, so a raise that named no area could never
 * be resolved by absence, which is why the area is an argument and is never
 * read back out of `context` (ADR-040). It is a list because one fault can
 * legitimately affect several scopes at once, and those areas name where the
 * IMPACT is rather than where the fault is (ADR-044).
 *
 * `policyId` is recorded whatever it says. This engine holds no rule book, so
 * a policy it has never heard of is data and not an error — refusing one would
 * mean a caller's condition is detected and then discarded, which is the
 * failure the caller was built to prevent, moved one layer down.
 */
export interface AlertManagerClient {
  reportRun(
    sourceId: string,
    runId: string,
    alerts: readonly ReportedAlert[],
    scopes: readonly RunScope[],
  ): Promise<void>;
  raiseAlert(
    fingerprint: string,
    severity: AlertSeverity,
    policyId: string,
    areas: readonly string[],
    context: Record<string, unknown>,
  ): Promise<void>;
  /** Idempotent, and total: an identity nothing ever raised resolves quietly.
   *  A caller cannot know what is open, so asking is not an error. */
  resolveAlert(fingerprint: string): Promise<void>;
}

/**
 * The store, as a port, so the rules above stay exercisable without one.
 * `prismaAlertStore` satisfies it structurally and is what a host binds; the
 * unique index behind `getAlert`/`upsertAlert` IS the dedupe (data-model.md).
 */
export interface AlertStore {
  getAlert(identity: AlertIdentity): Promise<StoredAlert | null>;
  upsertAlert(record: AlertRecord): Promise<StoredAlert>;
  /** The return is unread: an event is appended, never consulted afterwards. */
  recordAlertEvent(event: NewAlertEvent): Promise<unknown>;
  /**
   * The pair above as ONE unit, and the only way this engine moves an alert.
   *
   * The two verbs stay on the port because a caller may write a row or append
   * an event alone; a STATE CHANGE is never one of those cases, because a row
   * that moved with nothing in the log is the evidence gone (data-model.md, the
   * AlertEvent card).
   */
  applyAlertChange(record: AlertRecord, change: AlertChange): Promise<StoredAlert>;
}

// Compared whole and never split, so the two halves are joined by a byte a
// fingerprint cannot contain rather than by the separator callers escape.
const keyOf = (identity: AlertIdentity): string => `${identity.sourceId}\u0000${identity.fingerprint}`;

/**
 * An in-memory store. NOT DURABLE, and it keeps no history — an event is
 * accepted and dropped, because with no read back nothing could ever see one.
 * A host that needs either binds `prismaAlertStore`; this is only the default.
 */
export function createMemoryAlertStore(): AlertStore {
  const alerts = new Map<string, StoredAlert>();
  let issued = 0;

  const store: AlertStore = {
    getAlert: (identity) => Promise.resolve(alerts.get(keyOf(identity)) ?? null),
    upsertAlert: (record) => {
      const key = keyOf(record);
      const current = alerts.get(key);
      // firstSeenAt is taken from the stored row for the same reason the Prisma
      // upsert leaves it out of its update: it survives re-firing.
      issued += current === undefined ? 1 : 0;
      const stored: StoredAlert = {
        ...record,
        id: current?.id ?? `alert-${issued}`,
        areas: [...record.areas],
        firstSeenAt: current?.firstSeenAt ?? record.firstSeenAt,
      };
      alerts.set(key, stored);
      return Promise.resolve(stored);
    },
    recordAlertEvent: (event) => Promise.resolve(event),
    // Its own two verbs rather than a copy of them, so both stay live. There is
    // nothing to roll back here: this store drops the event and keeps no
    // history, so no partial write it could leave behind exists.
    applyAlertChange: async (record, change) => {
      const stored = await store.upsertAlert(record);
      await store.recordAlertEvent({ ...change, alertId: stored.id });
      return stored;
    },
  };
  return store;
}

/**
 * What a client is bound to. `sourceId` is REQUIRED and has no default: the
 * port gives `raiseAlert` no source, identity is (sourceId, fingerprint), and a
 * default would silently split an out-of-band raise from the run reporting it.
 */
export interface AlertManagerDeps {
  sourceId: string;
  /** Defaults to `createMemoryAlertStore()`, which keeps nothing across a
   *  process. A host binds `prismaAlertStore`. */
  store?: AlertStore;
  /** Injectable so a run is reproducible; defaults to the current instant. */
  now?: () => Date;
}

/**
 * The client, bound to its type with an explicit annotation and NO CAST, so
 * the shape is fixed by the compiler rather than by convention. The two sides
 * of the port are checked against each other where they meet — this engine
 * imports nothing from a caller, and a structural disagreement is a red
 * typecheck rather than a surprise at 02:00.
 *
 * WHERE THE LINE ON THROWING IS DRAWN, and it is drawn tightly. Nothing a
 * caller can put in an argument is refused: an unrecognised `policyId`, an
 * empty `context`, an empty `areas`, a fingerprint nothing has ever raised.
 * All four are DATA, and the engine holds no rule book to judge them against —
 * refusing one would detect a condition and then discard it, which is the
 * failure the caller was built to prevent moved one layer down (ADR-040,
 * flows-alerting.md). What is left to throw for is the store failing, which is
 * not a fact about the alert and cannot be recorded instead of raised. A caller
 * guards these calls (ADR-040), so a throw no longer ends its run — but the
 * areas that alert named are then reported incomplete, and nothing in them
 * resolves that night, so it is survivable rather than free.
 */
export function createAlertManager(deps: AlertManagerDeps): AlertManagerClient {
  const { sourceId, store = createMemoryAlertStore(), now = () => new Date() } = deps;

  // One raise, recorded as one row and one event. Read-then-write rather than
  // a compare-and-set: the store's unique index is what makes the write
  // idempotent, so a concurrent second raise updates the same row.
  async function raise(input: AlertRaise, at: Date): Promise<void> {
    const current = await store.getAlert({ sourceId: input.sourceId, fingerprint: input.fingerprint });
    const kind = raiseKind(current, input.severity);
    const next = current === null ? openAlert(input, at) : reassert(current, input, at);
    // One unit, not two awaits: a raise that moved the row and then failed to
    // log it left no trace that the state had changed at all.
    // fromState/toState are both null unless the state actually moved — a
    // reassert and a severity rise change none (data-model.md, AlertEvent).
    await store.applyAlertChange(next, {
      at,
      kind,
      fromState: kind === "raised" ? (current?.state ?? null) : null,
      toState: kind === "raised" ? next.state : null,
    });
  }

  // The resolution is written as an event before anything can reopen the row,
  // which is what leaves it in the record when a later raise fires again.
  async function close(fingerprint: string, at: Date): Promise<void> {
    const current = await store.getAlert({ sourceId, fingerprint });
    if (current === null || isResolved(current.state)) return;
    await store.applyAlertChange(closeAlert(current, at), {
      at,
      kind: "resolved",
      fromState: current.state,
      toState: "resolved",
    });
  }

  const client: AlertManagerClient = {
    // STILL RECORDS NOTHING: resolution by absence is service-alerts-report-run,
    // and half of it — resolving what a complete scope did not carry — would
    // close alerts wrongly if it landed before the scope rules do.
    reportRun() {
      return Promise.resolve();
    },
    // `context` and `areas` are handed on whole. Nothing here reads either: a
    // scope is never dug out of the bag, and the bag is never interpreted.
    raiseAlert(fingerprint, severity, policyId, areas, context) {
      return raise({ sourceId, fingerprint, severity, policyId, areas, context }, now());
    },
    resolveAlert(fingerprint) {
      return close(fingerprint, now());
    },
  };
  return client;
}
