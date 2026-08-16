// Task `module-deadlines-sweep` — test fixtures and ports for the deadline
// monitor. Written from the specification alone.
//
// PROVENANCE. This file is the reconciliation of two halves. The calendar half
// landed with `module-deadlines` and was then extended by
// `module-deadlines-civil-date`, which made `timeZone` a required member of
// BusinessCalendar and gave the fixtures a real zone per jurisdiction. The sweep
// half — the store and alert ports, the `World`, the sweep verbs — was carried
// out of that PR and is folded back in here. Where the two disagreed the LATER
// half won: `ymd` reads UTC parts rather than local ones, which is what stopped
// ten calendar tests from depending on the runner's timezone, and `calendar()`
// keeps the required `timeZone` argument and the jurisdiction zone map rather
// than the sweep half's `"UTC"` default, because a fixture defaulting to UTC is
// the very defect the civil-date node removed.
//
// No file under `lib/modules/deadlines/` was read as implementation. Every
// expected value in this directory comes from
// docs/architecture/components-core-deadline-monitor.md, flows-alerting.md,
// operations-scheduling.md, data-model.md, data-ownership.md,
// prisma/schema.prisma's kernel models, CLAUDE.md or reference/legacy/, cited at
// the test. What WAS read, once and only to bind the calls: the exported
// declarations of index.ts — names, parameter lists and types, no bodies. That
// is the module's public surface, which the task explicitly allows.
//
// Ports rather than a database: the domain functions take values, and
// DeadlineStore / CalendarSource / AlertManager arrive as arguments, so the
// fakes below are the whole environment these tests need (CLAUDE.md rule 3 —
// only repository.ts touches @/lib/db).
//
// TOLERANT PLUMBING, STRICT ASSERTIONS. Two things this node settles have no
// spelling fixed anywhere in the spec: the scope declaration a run attaches to
// its report, and the extra arguments `raiseAlert` takes. The plumbing below
// accepts more than one spelling of each so a naming disagreement between this
// file and the module surfaces as a failing assertion that names the rule,
// rather than as a compile error that takes the whole suite — including the
// calendar tests — down with it. Nothing about WHAT is asserted is relaxed by
// that: the information the spec requires is still required, and every finder
// proves itself non-empty first.
import {
  businessDaysUntil,
  deregisterDeadline as deregister,
  filingDueDate,
  registerDeadline as register,
  requireCalendar,
  runDeadlineSweep,
  statutoryDueDate,
  type BusinessCalendar,
  type CalendarSource,
  type DeadlineDeps,
  type DeadlineStore,
  type Evaluation,
  type Registration,
  type ReportedAlert,
  type Severity,
  type ThresholdRule,
} from "@/lib/modules/deadlines";

export type { BusinessCalendar, Registration, Severity, ThresholdRule };

// ------------------------------------------------------------------ values --

/**
 * A civil date from an ISO day. Built at UTC midnight because that is how this
 * build stores civil dates (data-model.md) and how Prisma `@db.Date` returns
 * them, so a fixture and a production row name the same day.
 */
export const d = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

/**
 * An INSTANT, for the moment a sweep runs. Deliberately a different helper from
 * `d`: the sweep is scheduled "daily 02:00" (operations-scheduling.md:21), which
 * is a moment in time, and the civil day that moment falls on is a question the
 * jurisdiction's calendar answers, not the runner's clock.
 */
export const at = (iso: string): Date => new Date(iso);

/**
 * A civil date as `YYYY-MM-DD`, read in UTC.
 *
 * Civil dates in this build are stored at UTC midnight and never localised
 * (data-model.md), so the day a Date names is its UTC day. Reading LOCAL parts
 * off a UTC-midnight Date is correct only at offsets at or east of UTC — it
 * silently reports the previous day anywhere west, which made ten of these
 * tests fail under America/New_York while passing here and in Dubai. A green
 * suite whose verdict depends on the runner's clock is not a proof.
 *
 * Legacy values are read with this same helper deliberately. Legacy builds
 * period ends from LOCAL midnight, which lands on the previous UTC day at
 * EASTERN offsets and the same UTC day at western ones — the opposite operation
 * to the one above, and easy to transpose. Either way the oracle comparison
 * reads BOTH sides through here, so the shift cancels whichever hemisphere it
 * falls in, and what is compared is the arithmetic: does +28 land where
 * legacy's +28 landed. Mixing the two frames is what broke; using one
 * consistently is what fixes it.
 */
export const ymd = (date: Date): string => date.toISOString().slice(0, 10);

/** Friday and Saturday — the Gulf week (CLAUDE.md rule 9, BusinessCalendar). */
export const GULF: readonly number[] = [5, 6];
/** Saturday and Sunday — the wrong week for all five countries. */
export const WESTERN: readonly number[] = [0, 6];

/**
 * The whole severity vocabulary, weakest first. prisma/schema.prisma's
 * ThresholdTable.severity is a closed enum of exactly `minor` and `major`
 * (tests/modules/deadlines/schema.test.ts), and the spec's own reportRun example
 * uses both and nothing else (components-core-deadline-monitor.md:28-31). The
 * order is what "the MAXIMUM across breached windows" (spec:42) ranks by.
 */
export const SEVERITIES: readonly Severity[] = ["minor", "major"] as Severity[];

/** The stronger of two severities, by the order above. */
export function strongest(severities: readonly Severity[]): Severity | undefined {
  return severities.reduce<Severity | undefined>(
    (best, next) =>
      best === undefined || SEVERITIES.indexOf(next) > SEVERITIES.indexOf(best) ? next : best,
    undefined,
  );
}

/**
 * The IANA zone each jurisdiction in these fixtures is actually in.
 *
 * `module-deadlines-civil-date` made `timeZone` a required member of
 * BusinessCalendar, so a fixture has to carry one. It is inert for everything in
 * calendar.test.ts — business-day distance, the statutory date and the filing
 * date are all arithmetic over civil dates that are handed in already resolved,
 * and none of them converts an instant — but it must still be a truthful value,
 * because a fixture is read as documentation of what a row looks like.
 *
 * `XX` is the invented jurisdiction used for a seven-day working week and for a
 * calendar that closes every day; it is given a real zone rather than `UTC`
 * deliberately. UTC standing in for an unknown zone is the exact defect that
 * node exists to remove, and it should not appear as a habit in the fixtures
 * either.
 */
const FIXTURE_ZONES: Record<string, string> = {
  AE: "Asia/Dubai",
  EG: "Africa/Cairo",
  SA: "Asia/Riyadh",
  KW: "Asia/Kuwait",
  BH: "Asia/Bahrain",
  GB: "Europe/London",
  US: "America/New_York",
};

export function calendar(
  jurisdictionId: string,
  weekendMask: readonly number[],
  holidays: string[] = [],
  timeZone: string = FIXTURE_ZONES[jurisdictionId] ?? "Asia/Dubai",
): BusinessCalendar {
  return { jurisdictionId, weekendMask: [...weekendMask], holidays: holidays.map(d), timeZone };
}

/**
 * What `calendar()` returns.
 *
 * It was `BusinessCalendar & { timeZone?: string }` while the field was still
 * being landed, so that the sweep tests compiled either way. `timeZone` is
 * required on the real type now, so the intersection would only weaken it: an
 * optional member here would let a fixture omit the one field the civil-date
 * tests exist to exercise.
 */
export type TestCalendar = BusinessCalendar;

export function threshold(
  deadlineType: string,
  businessDaysBefore: number,
  severity: Severity,
): ThresholdRule {
  return { deadlineType, businessDaysBefore, severity };
}

/** `entityRef` is the spec's `…document:123:expiry` identity, split at the colon. */
export function deadline(
  entityRef: string,
  deadlineType: string,
  dueDate: Date,
  jurisdictionId = "AE",
): Registration {
  const [entityType, entityId] = entityRef.split(":");
  return {
    id: `${entityRef}:${deadlineType}`,
    entityType,
    entityId,
    deadlineType,
    dueDate,
    jurisdictionId,
  };
}

// ------------------------------------------------ the scope a run declares --

/**
 * Which jurisdictions a run evaluated completely and which it could not.
 *
 * flows-alerting.md:47 — "Completeness is scoped, and the scope is declared. A
 * run may be complete for part of its domain and not the rest… Absence then
 * resolves ONLY within the scopes the run declares complete." A run that
 * declares nothing has said "I checked everything", which is the pre-decision
 * all-or-nothing reading.
 */
export type ScopeDeclaration = { complete: string[]; incomplete: string[] };

const strings = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every((item) => typeof item === "string")
    ? (value as string[])
    : undefined;

/**
 * The scope declaration out of whatever the run attached to its report.
 *
 * The spec fixes the INFORMATION — which scopes are complete — and not its
 * encoding, so the three encodings that carry exactly that information are all
 * read: `{complete, incomplete}`, `{completeScopes, incompleteScopes}`, and a
 * list of `{jurisdictionId, complete}` rows. Anything else reads as "no
 * declaration", which is what makes the scoping tests able to fail.
 */
function readScopes(value: unknown): ScopeDeclaration | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;

  const complete = strings(record.complete) ?? strings(record.completeScopes);
  const incomplete = strings(record.incomplete) ?? strings(record.incompleteScopes);
  if (complete !== undefined || incomplete !== undefined) {
    return { complete: complete ?? [], incomplete: incomplete ?? [] };
  }

  if (record.scopes !== undefined) return readScopes(record.scopes);
  return undefined;
}

/** The declaration, whichever of the extra arguments carries it. */
function scopesIn(extra: readonly unknown[]): ScopeDeclaration | undefined {
  for (const value of extra) {
    if (Array.isArray(value)) {
      const rows = value.filter(
        (row): row is { jurisdictionId: string; complete: boolean } =>
          row !== null &&
          typeof row === "object" &&
          typeof (row as Record<string, unknown>).jurisdictionId === "string" &&
          typeof (row as Record<string, unknown>).complete === "boolean",
      );
      if (rows.length > 0) {
        return {
          complete: rows.filter((row) => row.complete).map((row) => row.jurisdictionId),
          incomplete: rows.filter((row) => !row.complete).map((row) => row.jurisdictionId),
        };
      }
      continue;
    }
    const found = readScopes(value);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * The jurisdiction an alert was scored in.
 *
 * Per-scope resolution is impossible without it: the Alert Manager is asked to
 * resolve absent fingerprints "only within the scopes the run declares complete"
 * (flows-alerting.md:47), and a fingerprint —
 * `{tenant}:{app}:{source}:{entity}:{policy}` (flows-alerting.md:34) — carries
 * no jurisdiction segment. Read defensively so its absence is a failed
 * assertion with a message, not a type error.
 */
export function scopeOf(alert: ReportedAlert): string | undefined {
  const record = alert as unknown as Record<string, unknown>;
  const found = record.jurisdictionId ?? record.scope ?? record.jurisdiction;
  return typeof found === "string" ? found : undefined;
}

// -------------------------------------------------------------- the ports --

export type Report = {
  sourceId: string;
  runId: string;
  alerts: ReportedAlert[];
  /** The completeness the run declared, normalised; undefined when it declared none. */
  scopes: ScopeDeclaration | undefined;
  /** Everything past `alerts`, as passed, for a failure message worth reading. */
  extra: unknown[];
};

export type RaisedAlert = { fingerprint: string; severity: Severity; extra: unknown[] };

/** How an alert stands with the Alert Manager. flows-alerting.md, "The state machine". */
export type AlertStatus = "firing" | "stale" | "resolved";

export type AlertState = {
  fingerprint: string;
  severity: Severity;
  scope: string | undefined;
  status: AlertStatus;
};

/**
 * A stand-in for the Alert Manager that records every call AND models the
 * lifecycle flows-alerting.md gives it, because the load-bearing rules of this
 * task are lifecycle rules and nothing about them is observable from the report
 * payload alone:
 *
 *   :46 "Absence from a completed report resolves."
 *   :47 "Absence then resolves only within the scopes the run declares
 *        complete. Alerts in an incomplete scope stay open, are marked STALE,
 *        and are never resolved by absence."
 *
 * A run that declares no scopes is treated as complete for everything — the
 * reading this node reverses. That direction is deliberate: it means the STALE
 * tests FAIL against a module that forgets to declare its scopes, rather than
 * passing because the fake was generous.
 */
export function fakeAlertManager() {
  const runs: Report[] = [];
  const raised: RaisedAlert[] = [];
  const resolved: string[] = [];
  const board = new Map<string, AlertState>();

  const complete = (scopes: ScopeDeclaration | undefined, scope: string | undefined): boolean => {
    if (scopes === undefined) return true;
    return scope !== undefined && scopes.complete.includes(scope);
  };

  const manager = {
    runs,
    raised,
    resolved,
    /** Every alert the Alert Manager holds, in the order it first heard of it. */
    board: () => [...board.values()],
    stateOf: (fingerprint: string): AlertState | undefined => board.get(fingerprint),

    reportRun(sourceId: string, runId: string, alerts: readonly ReportedAlert[], ...extra: unknown[]) {
      const scopes = scopesIn(extra);
      runs.push({ sourceId, runId, alerts: [...alerts], scopes, extra });

      const reported = new Set(alerts.map((alert) => alert.fingerprint));
      for (const alert of alerts) {
        const known = board.get(alert.fingerprint);
        board.set(alert.fingerprint, {
          fingerprint: alert.fingerprint,
          severity: alert.severity,
          scope: scopeOf(alert) ?? known?.scope,
          status: "firing",
        });
      }
      for (const state of board.values()) {
        if (reported.has(state.fingerprint) || state.status === "resolved") continue;
        state.status = complete(scopes, state.scope) ? "resolved" : "stale";
      }
      return Promise.resolve();
    },

    raiseAlert(fingerprint: string, severity: Severity, ...extra: unknown[]) {
      raised.push({ fingerprint, severity, extra });
      return Promise.resolve();
    },
  };

  // resolveAlert is not a verb a sweep source uses — the spec's Note:50 is that
  // "modules never call cancel". Recorded anyway, so a module that reaches for
  // it is caught rather than silently type-checked away.
  (manager as unknown as Record<string, unknown>).resolveAlert = (fingerprint: string) => {
    resolved.push(fingerprint);
    const state = board.get(fingerprint);
    if (state !== undefined) state.status = "resolved";
    return Promise.resolve();
  };
  return manager;
}

export type AlertFake = ReturnType<typeof fakeAlertManager>;

export type World = {
  /** The civil day, or — where a test is about the timezone — the instant. */
  today: Date;
  /** The instant the sweep runs, when it differs from `today`. */
  at?: Date;
  runId?: string;
  registrations: Registration[];
  thresholds: ThresholdRule[];
  calendars: TestCalendar[];
  alerts: AlertFake;
};

function store(world: World): DeadlineStore {
  const rows = world.registrations;
  const same = (a: { entityType: string; entityId: string; deadlineType: string }, b: typeof a) =>
    a.entityType === b.entityType && a.entityId === b.entityId && a.deadlineType === b.deadlineType;
  return {
    upsertRegistration(input) {
      const row: Registration = {
        id: `${input.entityType}:${input.entityId}:${input.deadlineType}`,
        ...input,
      };
      const at_ = rows.findIndex((existing) => same(existing, input));
      if (at_ === -1) rows.push(row);
      else rows[at_] = row;
      return Promise.resolve(row);
    },
    deleteRegistration(ref) {
      const at_ = rows.findIndex((existing) => same(existing, ref));
      if (at_ !== -1) rows.splice(at_, 1);
      return Promise.resolve();
    },
    listRegistrations: () => Promise.resolve([...rows]),
    listThresholds: () => Promise.resolve([...world.thresholds]),
  };
}

function calendars(world: World): CalendarSource {
  return {
    forJurisdiction: (jurisdictionId) =>
      Promise.resolve(
        world.calendars.find((entry) => entry.jurisdictionId === jurisdictionId) ?? null,
      ),
  };
}

function deps(world: World): DeadlineDeps {
  return {
    tenant: "reno",
    store: store(world),
    calendars: calendars(world),
    alerts: world.alerts,
    now: () => world.at ?? world.today,
    runId: () => world.runId ?? "r9",
  };
}

// -------------------------------------------------------------- the verbs --

/** Business-day distance across a calendar, in the tests' own argument order. */
export function businessDays(from: Date, to: Date, cal: BusinessCalendar): number {
  return businessDaysUntil(cal, from, to);
}

/** The date the LAW names: calendar arithmetic, never adjusted. */
export const statutoryDue = statutoryDueDate;

/** The date you must FILE by: the statutory date rolled off a closed day. */
export const filingDue = filingDueDate;

/** The calendar for a jurisdiction, or the error the spec requires instead. */
export function calendarFor(
  jurisdictionId: string,
  found: BusinessCalendar | null | undefined,
): BusinessCalendar {
  return requireCalendar(jurisdictionId, found);
}

/**
 * One sweep. Returns the report it sent. A run that sends no report at all is
 * an error here, not an empty result: "Every run sends one report", and an
 * empty array is a report (components-core-deadline-monitor.md:25-34).
 */
export async function sweep(world: World): Promise<Report> {
  const before = world.alerts.runs.length;
  await runDeadlineSweep(deps(world));
  return onlyReport(world, before);
}

/**
 * The same sweep as the 02:00 job makes it: no clock and no run id handed in
 * (operations-scheduling.md:21). Pin the system clock around it.
 */
export async function sweepOnTheSystemClock(world: World): Promise<Report> {
  const { tenant, store: rows, calendars: source, alerts } = deps(world);
  const before = world.alerts.runs.length;
  await runDeadlineSweep({ tenant, store: rows, calendars: source, alerts });
  return onlyReport(world, before);
}

function onlyReport(world: World, before: number): Report {
  const sent = world.alerts.runs.length - before;
  if (sent !== 1) {
    throw new Error(
      `the sweep called reportRun ${sent} times; every run sends exactly one report, ` +
        "and an empty breach set is still a report (it is the liveness signal).",
    );
  }
  return world.alerts.runs[world.alerts.runs.length - 1];
}

export function registerDeadline(world: World, entry: Registration) {
  return register(entry, deps(world));
}

export function deregisterDeadline(world: World, entry: Registration) {
  const { entityType, entityId, deadlineType } = entry;
  return deregister({ entityType, entityId, deadlineType }, deps(world));
}

// -------------------------------------------------------------- assertions --

/** Breach identities in a report, sorted, so order is never asserted. */
export function fingerprints(report: Report): string[] {
  return report.alerts.map((alert) => alert.fingerprint).sort();
}

/** The severity a report gave one deadline, or undefined if it reported none. */
export function severityOf(report: Report, entityRef: string, deadlineType: string): Severity | undefined {
  const tail = `${entityRef}:${deadlineType}`;
  return report.alerts.find((alert) => alert.fingerprint.endsWith(tail))?.severity;
}

/**
 * Every alert the module sent the Alert Manager by any route, run alerts and
 * direct raises together.
 *
 * The spec says a misconfiguration "raises" (components-core-deadline-monitor.md:46,
 * flows-alerting.md:48) and does not say through which verb, so the finders
 * below look down both. Which verb it SHOULD be is asserted once, on its own,
 * so a disagreement about the channel fails one test rather than every test
 * about counting and naming.
 */
export function allAlerts(alerts: AlertFake): { fingerprint: string; severity: Severity }[] {
  return [
    ...alerts.raised.map(({ fingerprint, severity }) => ({ fingerprint, severity })),
    ...alerts.runs.flatMap((report) => report.alerts.map(({ fingerprint, severity }) => ({
      fingerprint,
      severity,
    }))),
  ];
}

/** Alerts naming `subject` — a jurisdiction id or a deadline type — anywhere in their identity. */
export function alertsAbout(alerts: AlertFake, subject: string) {
  const needle = subject.toLowerCase();
  return allAlerts(alerts).filter((alert) => alert.fingerprint.toLowerCase().includes(needle));
}

/** True when this identity is the breach of one of these registrations. */
const isBreachOf = (fingerprint: string, registrations: readonly Registration[]): boolean =>
  registrations.some((row) =>
    fingerprint.endsWith(`${row.entityType}:${row.entityId}:${row.deadlineType}`),
  );

/**
 * Alerts that are not the breach of any registration — i.e. the module talking
 * about its own configuration rather than about a deadline.
 *
 * Identified by what they are NOT rather than by which verb carried them, so
 * these counts hold whether a misconfiguration arrives through `raiseAlert` or
 * inside the report. It also keeps them honest if a fingerprint ever grows a
 * jurisdiction segment: a Kuwaiti visa's breach names KW too, and counting by
 * substring alone would read it as a misconfiguration alert.
 */
export function misconfigurations(alerts: AlertFake, registrations: readonly Registration[]) {
  return allAlerts(alerts).filter((alert) => !isBreachOf(alert.fingerprint, registrations));
}

/** The same, restricted to those naming `subject`. */
export function misconfigurationsAbout(
  alerts: AlertFake,
  subject: string,
  registrations: readonly Registration[],
) {
  const needle = subject.toLowerCase();
  return misconfigurations(alerts, registrations).filter((alert) =>
    alert.fingerprint.toLowerCase().includes(needle),
  );
}

/** The same, restricted to what arrived through `raiseAlert`. */
export function raisedAbout(alerts: AlertFake, subject: string): RaisedAlert[] {
  const needle = subject.toLowerCase();
  return alerts.raised.filter((alert) => alert.fingerprint.toLowerCase().includes(needle));
}

/**
 * What registering a deadline scored, or undefined if it scored nothing. The
 * assertion under test is "evaluates immediately"
 * (components-core-deadline-monitor.md:22): an evaluation carrying a severity
 * is an immediate score, and what it must not be is "nothing until the next
 * sweep", which is why the negative case asserts undefined.
 *
 * The severity is read off the verdict rather than off a nullable field: a
 * registration whose type has no threshold row is `unconfigured`, which is not
 * the same fact as "inside every window" and must not be read as one.
 */
export function evaluationOf(
  result: Evaluation,
  alerts: AlertFake,
): { fingerprint: string; severity: Severity } | undefined {
  if (result?.verdict?.status === "breached") {
    return { fingerprint: result.fingerprint, severity: result.verdict.severity };
  }
  const emitted = allAlerts(alerts);
  return emitted[emitted.length - 1];
}
