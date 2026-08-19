// Plumbing for tasks/backlog.yaml#service-alerts-raise, against a real engine.
//
// WRITTEN FROM THE SPECIFICATION. The author of these tests read no line of the
// working-tree lib/services/alerts/index.ts. Every expected value in this
// directory's raise/resolve files comes from
//
//   · the node in tasks/backlog.yaml, including its corrected note;
//   · docs/architecture/flows-alerting.md — the three verbs, the state machine,
//     the resolution semantics;
//   · the "Alert Manager" section of docs/architecture/data-model.md — the
//     Alert, AlertArea, AlertEvent and AlertSource cards;
//   · ADR-020 (four states, severity monotonic while open), ADR-039 (importable
//     package on the host's storage), ADR-040 (`areas` is an argument and is
//     never read out of `context`; a failed alert never ends the run), ADR-043
//     (`area`, never an OpsMind noun), ADR-044 (impact, not fault);
//   · lib/services/alerts/lifecycle.ts and repository.ts AS MERGED AT HEAD, the
//     two layers this node sits between;
//   · lib/modules/deadlines/index.ts AS MERGED AT HEAD — the caller.
//
// ---------------------------------------------------------------------------
// TOLERANT PLUMBING, STRICT ASSERTIONS — the bargain tests/services/alerts/
// surface.ts struck for the previous node, and it applies here for one more
// reason than it did there.
//
// The specification fixes the VERBS — `raiseAlert(fingerprint, severity,
// policyId, areas, context)` and `resolveAlert(fingerprint)` — and fixes
// nothing about how the engine is handed its store or its clock. It cannot: the
// two verbs above carry no `sourceId` while `Alert` is keyed by
// `(sourceId, fingerprint)`, so a client is necessarily BOUND to a source
// somewhere, and no document says where. `createAlertManager()` took no
// argument at all at HEAD.
//
// So this file DISCOVERS the wiring and asserts nothing about it: it tries the
// defensible constructions in turn and keeps the first one whose `raiseAlert`
// actually lands a row in the database. A construction that is merely
// well-shaped is rejected — that is the whole point of the node ("a test that
// passes while the alert never lands is the worst possible outcome"), and the
// HEAD client, which resolves a promise and records nothing, is exactly the
// shape that would otherwise sail through.
//
// Nothing about WHAT is asserted is relaxed by that. Every case in this
// directory reads the row back out of PostgreSQL, and when no construction
// lands a row the failure names every one that was tried.
//
// EVERY LOOKUP IS BY FINGERPRINT ALONE, never by (sourceId, fingerprint). The
// engine chooses the source a raise is filed under and the specification does
// not; the assertion that matters is "ONE row for this fact", and a raise filed
// under one source while the same fact is reported under another is two rows,
// which is the defect assertion 6 exists to catch. Asking by fingerprint sees
// that; asking by the pair would hide it.
// ---------------------------------------------------------------------------
import type { AlertSeverity } from "@/lib/services/alerts";

/** The client the repositories under test hold, typed without importing it. */
type Database = (typeof import("@/lib/db"))["db"];

/** The source id the merged deadline monitor reports under (its `SOURCE_ID`). */
export const SOURCE_ID = "deadline-monitor";

/** One breached condition, in the shape the port takes (ADR-043: `area`). */
export interface ReportedAlertLike {
  fingerprint: string;
  severity: AlertSeverity;
  area: string;
}

/** One unit of completeness in a run (ADR-043: `area`). */
export interface RunScopeLike {
  area: string;
  complete: boolean;
  reason?: string;
}

/** The port shape `DeadlineDeps.alerts` requires, so the merged module can be
 *  driven against the real engine with no adapter in between. */
export interface AlertPort {
  reportRun(
    sourceId: string,
    runId: string,
    alerts: ReportedAlertLike[],
    scopes: readonly RunScopeLike[],
  ): Promise<void>;
  raiseAlert(
    fingerprint: string,
    severity: AlertSeverity,
    policyId: string,
    areas: readonly string[],
    context: Record<string, unknown>,
  ): Promise<void>;
}

export interface AlertEngine extends AlertPort {
  /** Which construction landed a row, for a failure message worth reading. */
  how: string;
  /** Whether the engine took the injected clock. Decides how `tick` works. */
  clockHonoured: boolean;
  /** The instant the engine will stamp, when it took the clock. */
  now(): Date;
  /** Move time on, by whichever mechanism this engine actually respects. */
  tick(ms?: number): Promise<void>;
  /** flows-alerting.md's third verb. Idempotent, and takes a fingerprint. */
  resolveAlert(fingerprint: string): Promise<void>;
}

const isFunction = (value: unknown): value is (...args: never[]) => unknown =>
  typeof value === "function";

const looksLikeClient = (value: unknown): boolean =>
  value !== null &&
  typeof value === "object" &&
  isFunction((value as Record<string, unknown>).raiseAlert) &&
  isFunction((value as Record<string, unknown>).reportRun);

/** The fixed instant the clock probe uses. Distant from now, so "the engine
 *  took the clock" cannot be confused with "the engine called `new Date()`". */
const CLOCK_PROBE_AT = new Date("2026-01-02T03:04:05.678Z");

/**
 * The store the engine must be writing through.
 *
 * From the service's own surface when it publishes one — every other module in
 * this build re-exports its store from `index.ts` (`prismaDeadlineStore`) — and
 * from the repository otherwise. Both are imported dynamically: `integration
 * Database` swaps DATABASE_URL and evicts the cached client, and a static
 * import would bind the client built for whatever the variable held before.
 */
async function prismaStore(service: Record<string, unknown>): Promise<unknown> {
  const published = service.prismaAlertStore ?? service.alertStore ?? service.store;
  if (published !== undefined && published !== null) return published;
  const repository = (await import("@/lib/services/alerts/repository")) as Record<string, unknown>;
  return repository.prismaAlertStore ?? repository.alertStore ?? repository.default;
}

interface Attempt {
  how: string;
  build: () => unknown;
}

/**
 * The three verbs off a candidate client.
 *
 * `resolveAlert` is looked for on the CLIENT first, because that is where
 * flows-alerting.md puts all five verbs and where the previous node's
 * `surface.ts` reads them from. A module-level fallback exists only because
 * `resolveAlert` is also the name of the merged pure lifecycle function
 * `(alert, at) => AlertRecord`, so a caller reaching for the module export
 * could get either — the fallback is taken only when the export answers a
 * single fingerprint with a promise, which the pure function never does.
 */
function verbs(
  candidate: Record<string, unknown>,
  service: Record<string, unknown>,
): { resolve: (fingerprint: string) => Promise<void> } | undefined {
  for (const name of ["resolveAlert", "resolve"]) {
    const found = candidate[name];
    if (isFunction(found)) {
      return { resolve: (fingerprint) => Promise.resolve((found as (fp: string) => unknown)(fingerprint)) as Promise<void> };
    }
  }
  const moduleLevel = service.resolveAlert;
  if (isFunction(moduleLevel)) {
    const answer = (moduleLevel as (fp: string) => unknown)("__opsmind_probe_never_raised__");
    if (answer !== null && typeof answer === "object" && isFunction((answer as { then?: unknown }).then)) {
      return { resolve: (fingerprint) => Promise.resolve((moduleLevel as (fp: string) => unknown)(fingerprint)) as Promise<void> };
    }
  }
  return undefined;
}

/**
 * An Alert Manager wired to the real store, or a failure naming what was tried.
 *
 * The probe is the whole reason this function exists rather than a one-line
 * `createAlertManager()`: a candidate is accepted only when a raise through it
 * is READABLE AS A ROW afterwards. Nothing here asserts — a rejected candidate
 * simply is not the wiring — and the assertions live in the *.test.ts files
 * beside this one.
 */
export async function alertEngine(db: Database): Promise<AlertEngine> {
  const service = (await import("@/lib/services/alerts")) as Record<string, unknown>;
  const store = await prismaStore(service);

  let current = CLOCK_PROBE_AT;
  const now = (): Date => current;

  const factoryName = ["createAlertManager", "createAlertEngine", "createAlerts", "makeAlertManager"].find((name) =>
    isFunction(service[name]),
  );
  const direct = ["alerts", "alertManager"].map((name) => service[name]).find(looksLikeClient);

  const deps = { sourceId: SOURCE_ID, source: SOURCE_ID, store, alerts: store, repository: store, now, clock: now };
  const attempts: Attempt[] = [];
  if (direct !== undefined) attempts.push({ how: "the client the service publishes as a value", build: () => direct });
  if (factoryName !== undefined) {
    const factory = service[factoryName] as (...args: unknown[]) => unknown;
    attempts.push(
      { how: `${factoryName}({ sourceId, store, now })`, build: () => factory(deps) },
      { how: `${factoryName}(sourceId, { store, now })`, build: () => factory(SOURCE_ID, deps) },
      { how: `${factoryName}(store, { sourceId, now })`, build: () => factory(store, deps) },
      { how: `${factoryName}(store, now)`, build: () => factory(store, now) },
      { how: `${factoryName}(store)`, build: () => factory(store) },
      { how: `${factoryName}(sourceId, store, now)`, build: () => factory(SOURCE_ID, store, now) },
      { how: `${factoryName}()`, build: () => factory() },
    );
  }

  const rejected: string[] = [];
  for (const attempt of attempts) {
    let candidate: unknown;
    try {
      candidate = attempt.build();
    } catch (cause) {
      rejected.push(`${attempt.how}: threw — ${String(cause)}`);
      continue;
    }
    if (!looksLikeClient(candidate)) {
      rejected.push(`${attempt.how}: returned no raiseAlert/reportRun pair`);
      continue;
    }
    const client = candidate as Record<string, unknown>;
    const bound = verbs(client, service);
    if (bound === undefined) {
      rejected.push(`${attempt.how}: publishes no resolveAlert(fingerprint)`);
      continue;
    }

    const probe = `__opsmind_probe__:${attempt.how}`;
    let landed: { firstSeenAt: Date } | null = null;
    try {
      current = CLOCK_PROBE_AT;
      // The most innocuous raise there is: a policy, one area and an empty bag.
      // Deliberately not an edge case — this probe discovers the WIRING, and an
      // engine that refuses odd data must be caught by the cases that assert so
      // and named there, not turned into a collection failure here.
      await (client.raiseAlert as AlertPort["raiseAlert"])(probe, "minor", "__probe__", ["__probe__"], {});
      landed = await db.alert.findFirst({ where: { fingerprint: probe }, select: { firstSeenAt: true } });
    } catch (cause) {
      rejected.push(`${attempt.how}: raiseAlert threw — ${String(cause)}`);
      continue;
    } finally {
      // Restrict, not Cascade, on AlertEvent.alert: the history goes first.
      await db.alertEvent.deleteMany({ where: { alert: { fingerprint: probe } } }).catch(() => undefined);
      await db.alert.deleteMany({ where: { fingerprint: probe } }).catch(() => undefined);
    }
    if (landed === null) {
      rejected.push(`${attempt.how}: raiseAlert resolved but no Alert row exists afterwards`);
      continue;
    }

    const clockHonoured = landed.firstSeenAt.getTime() === CLOCK_PROBE_AT.getTime();
    return {
      how: attempt.how,
      clockHonoured,
      now,
      // A fake clock the engine reads, or real elapsed time when it does not.
      // Either way a caller gets a LATER instant than the one before, which is
      // all any case here needs — no case asserts a specific wall-clock value.
      tick: async (ms = 60_000) => {
        if (clockHonoured) {
          current = new Date(current.getTime() + ms);
          return;
        }
        await new Promise((done) => setTimeout(done, 25));
      },
      raiseAlert: (fingerprint, severity, policyId, areas, context) =>
        (client.raiseAlert as AlertPort["raiseAlert"])(fingerprint, severity, policyId, areas, context),
      reportRun: (sourceId, runId, alerts, scopes) =>
        (client.reportRun as AlertPort["reportRun"])(sourceId, runId, alerts, scopes),
      resolveAlert: bound.resolve,
    };
  }

  throw new Error(
    "No Alert Manager from lib/services/alerts could be wired to the store, so nothing below " +
      "would have measured a raise that LANDS — which is the whole of " +
      "tasks/backlog.yaml#service-alerts-raise. flows-alerting.md fixes the verbs at " +
      "raiseAlert(fingerprint, severity, policyId, areas, context) and resolveAlert(fingerprint); " +
      "how the engine is handed its store and its clock is not specified, so these were tried:\n  " +
      (rejected.join("\n  ") || "nothing — the service publishes no client and no factory") +
      `\nThe service exports: ${Object.keys(service).sort().join(", ") || "nothing"}.`,
  );
}

// -------------------------------------------------------------- reading back --

/** Every column of the one alert this fingerprint names, areas and all.
 *  Null when nothing carries it — which `resolveAlert` on an unknown
 *  fingerprint must leave true (assertion 3). */
export async function alertFor(db: Database, fingerprint: string) {
  const rows = await db.alert.findMany({ where: { fingerprint }, include: { areas: true } });
  if (rows.length > 1) {
    throw new Error(
      `${rows.length} Alert rows carry the fingerprint ${fingerprint}. One fingerprint is one ` +
        "fact and one row: `@@unique([sourceId, fingerprint])` IS the dedupe (data-model.md), " +
        "and two rows mean one condition would be chased twice. Sources on those rows: " +
        rows.map((row) => JSON.stringify(row.sourceId)).join(", "),
    );
  }
  return rows[0] ?? null;
}

/** How many alerts carry this fingerprint, without the guard above — used where
 *  the COUNT is the assertion rather than the row. */
export const alertCountFor = (db: Database, fingerprint: string) =>
  db.alert.count({ where: { fingerprint } });

/** The scope keys stored against an alert, as a set: no card promises an order,
 *  and asserting one would assert something PostgreSQL never said (ADR-038). */
export const areasOf = (row: { areas: { area: string }[] } | null): Set<string> =>
  new Set((row?.areas ?? []).map(({ area }) => area));

/** The caller's own diagnostic payload, as a plain bag. Read here only so a
 *  case can assert what is IN it; nothing in the engine may do the same. */
export const bag = (row: { context: unknown }): Record<string, unknown> =>
  row.context as Record<string, unknown>;

/** One alert's history, oldest first, with ties broken by id so a log written
 *  inside a millisecond still reads back in one order. */
export const eventsFor = (db: Database, alertId: string) =>
  db.alertEvent.findMany({ where: { alertId }, orderBy: [{ at: "asc" }, { id: "asc" }] });
