// The deadline monitor's public surface. Everything outside this module reaches
// it through this file and through nothing else (CLAUDE.md rule 4) — the seam
// is the same call whether this is a folder or a container (ADR-021).
//
// Shape, for the six modules that copy it:
//   · pure domain in calendar.ts and thresholds.ts, taking values, not clients;
//   · repository.ts owning this module's two tables and nothing else;
//   · everything the module does NOT own — the Kernel's calendars, the Alert
//     Manager — arriving as a port on DeadlineDeps, so the boundary is a type
//     rather than a habit, and a test needs no database.

import { randomUUID } from "node:crypto";

import {
  businessDaysUntil,
  civilDateIn,
  isWorkingDay,
  requireCalendar,
  type BusinessCalendar,
  type CalendarSource,
} from "./calendar";
import {
  fingerprintFor,
  highestSeverity,
  isConfigured,
  severityFor,
  SOURCE_ID,
  type Severity,
  type ThresholdRule,
} from "./thresholds";

export {
  businessDaysUntil,
  civilDateIn,
  filingDueDate,
  isWorkingDay,
  MissingBusinessCalendarError,
  requireCalendar,
  statutoryDueDate,
} from "./calendar";
export type { BusinessCalendar, CalendarSource } from "./calendar";
export { APP_ID, fingerprintFor, highestSeverity, isConfigured, severityFor, SOURCE_ID } from "./thresholds";
export type { Severity, ThresholdRule } from "./thresholds";
export { prismaDeadlineStore } from "./repository";

/** The arguments of registerDeadline(entityRef, type, dueDate), plus the
 *  jurisdiction whose calendar measures the distance. */
export interface DeadlineRef {
  entityType: string;
  entityId: string;
  deadlineType: string;
}

export interface DeadlineInput extends DeadlineRef {
  dueDate: Date;
  jurisdictionId: string;
}

export interface Registration extends DeadlineInput {
  id: string;
}

/** This module's own tables, behind an interface. repository.ts is the Prisma
 *  implementation; a test supplies its own. */
export interface DeadlineStore {
  upsertRegistration(input: DeadlineInput): Promise<Registration>;
  deleteRegistration(ref: DeadlineRef): Promise<void>;
  listRegistrations(): Promise<Registration[]>;
  listThresholds(): Promise<ThresholdRule[]>;
}

/**
 * One breached deadline, in the shape the Alert Manager takes.
 *
 * `jurisdictionId` is the completeness scope it was scored in (see RunScope).
 * It has to travel with the alert: resolution by absence applies only inside a
 * scope the run declared complete, and a fingerprint —
 * `{tenant}:{app}:{source}:{entity}:{policy}` — carries no jurisdiction segment.
 */
export interface ReportedAlert {
  fingerprint: string;
  severity: Severity;
  jurisdictionId: string;
}

/**
 * One unit of completeness in a run, and whether the run finished it.
 *
 * Completeness is scoped and the scope is declared, because absence from a
 * COMPLETE report is what resolves an alert (flows-alerting.md). The scope here
 * is one jurisdiction: if it has no business calendar, nothing in it can be
 * scored, so the run declares that scope incomplete — its alerts stay open, are
 * marked STALE by the Alert Manager, and are never resolved by absence. The run
 * itself continues; a partial run is reported honestly rather than aborted,
 * because aborting takes every jurisdiction dark for one bad calendar.
 */
export interface RunScope {
  jurisdictionId: string;
  complete: boolean;
  /** The jurisdiction's own civil date, when it was scored. */
  civilDate?: Date;
  /** Why it could not be scored. Absent when complete. */
  reason?: string;
}

/** The Alert Manager's contract (components-services.md, flows-alerting.md).
 *  This module is a source: it decides severity and never touches lifecycle. */
export interface AlertManager {
  reportRun(
    sourceId: string,
    runId: string,
    alerts: ReportedAlert[],
    scopes: readonly RunScope[],
  ): Promise<void>;
  raiseAlert(
    fingerprint: string,
    severity: Severity,
    policyId: string,
    context: Record<string, unknown>,
  ): Promise<void>;
}

export interface DeadlineDeps {
  /** The fingerprint's tenant segment. Configuration, not a guessed constant. */
  tenant: string;
  store: DeadlineStore;
  calendars: CalendarSource;
  alerts: AlertManager;
  /** Injectable so a run is reproducible; defaults to the current instant. */
  now?: () => Date;
  runId?: () => string;
}

/** What one evaluated registration looks like, before it is a breach or not. */
export interface Evaluation {
  fingerprint: string;
  severity: Severity | null;
  businessDaysRemaining: number;
  /** True when the due date itself is a weekend or holiday. Surfaced, never
   *  shifted — the statutory date does not move because the office is shut. */
  dueOnNonWorkingDay: boolean;
}

export interface SweepReport {
  sourceId: string;
  runId: string;
  /** The instant the run fired. Each scope is scored against its own civil
   *  date, which is not the same day everywhere and is never the UTC day. */
  asOf: Date;
  /** How many registrations the run actually scored. Together with `breaches`
   *  and `scopes` this is what makes an empty report meaningful: it says the
   *  run checked everything it declared complete and found nothing, which is
   *  also the liveness signal. */
  evaluated: number;
  breaches: ReportedAlert[];
  scopes: RunScope[];
  /** Registered types with no ThresholdTable row — watched but unwatchable.
   *  Each raises one alert per run (CLAUDE.md rule 8). */
  unconfiguredTypes: string[];
}

/** The two things this module raises about ITSELF rather than about a deadline.
 *  Both mean the same thing: something is registered that nothing can score. */
export const MISSING_CALENDAR_POLICY = "missing-business-calendar";
export const NO_THRESHOLD_POLICY = "no-threshold-configured";

/**
 * A misconfiguration alert: one per subject per run, deduped by fingerprint,
 * never one per affected deadline. Severity comes from the enum's top rather
 * than a ThresholdTable row because the fault IS the absence of the row, and an
 * unwatched deadline is the failure this module exists to prevent.
 */
function raiseMisconfiguration(
  deps: DeadlineDeps,
  entityType: string,
  entityId: string,
  policyId: string,
  context: Record<string, unknown>,
): Promise<void> {
  return deps.alerts.raiseAlert(
    fingerprintFor(deps.tenant, entityType, entityId, policyId),
    highestSeverity(),
    policyId,
    context,
  );
}

function evaluate(
  tenant: string,
  calendar: BusinessCalendar,
  rules: readonly ThresholdRule[],
  registration: DeadlineInput,
  today: Date,
): Evaluation {
  const { entityType, entityId, deadlineType, dueDate } = registration;
  const businessDaysRemaining = businessDaysUntil(calendar, today, dueDate);
  return {
    fingerprint: fingerprintFor(tenant, entityType, entityId, deadlineType),
    severity: severityFor(rules, deadlineType, businessDaysRemaining),
    businessDaysRemaining,
    dueOnNonWorkingDay: !isWorkingDay(calendar, dueDate),
  };
}

/**
 * Register a date to be watched, and score it immediately.
 *
 * Evaluate-on-register: a document ingested when it is already inside a
 * threshold is alerted on now, not left for tonight's sweep. It goes out as
 * raiseAlert rather than reportRun, because reportRun carries a run's COMPLETE
 * breach set and absence from it resolves — a one-item report would resolve
 * every other open deadline in the system. The fingerprint is the same either
 * way, so tonight's sweep either confirms this alert or resolves it.
 *
 * The calendar is resolved before the row is written: a registration whose
 * jurisdiction has no calendar can never be scored, so it is refused rather
 * than stored and silently ignored. Refusing one caller is not the sweep's
 * missing-calendar case — that one continues, because a whole run is at stake.
 */
export async function registerDeadline(
  input: DeadlineInput,
  deps: DeadlineDeps,
): Promise<{ registration: Registration } & Evaluation> {
  const { jurisdictionId } = input;
  const calendar = requireCalendar(jurisdictionId, await deps.calendars.forJurisdiction(jurisdictionId));
  const today = civilDateIn(calendar.timeZone, deps.now?.() ?? new Date());
  const rules = await deps.store.listThresholds();
  const registration = await deps.store.upsertRegistration(input);
  const evaluation = evaluate(deps.tenant, calendar, rules, registration, today);

  if (evaluation.severity !== null) {
    const { businessDaysRemaining, dueOnNonWorkingDay } = evaluation;
    await deps.alerts.raiseAlert(evaluation.fingerprint, evaluation.severity, registration.deadlineType, {
      ...registration,
      businessDaysRemaining,
      dueOnNonWorkingDay,
    });
  }
  return { registration, ...evaluation };
}

/**
 * Stop watching a date. There is no cancel obligation: the alert resolves
 * because the next completed report no longer contains its fingerprint
 * (components-core-deadline-monitor.md), so the missed-cancel failure mode
 * cannot exist here.
 */
export async function deregisterDeadline(ref: DeadlineRef, deps: DeadlineDeps): Promise<void> {
  await deps.store.deleteRegistration(ref);
}

/**
 * The nightly sweep. Stateless by construction: it recomputes distance from
 * today for every registration and remembers nothing about yesterday, so two
 * runs on the same day report identically and a missed night self-heals.
 *
 * It reports the run's COMPLETE breach set, once, at the end — and an empty
 * array is a real report, never a skipped call: "I ran, nothing is breached" is
 * both a resolution signal for everything absent and this source's liveness
 * signal (flows-alerting.md).
 *
 * Jurisdiction by jurisdiction, because completeness is scoped. One with no
 * calendar cannot be scored: that scope is declared incomplete, one
 * misconfiguration alert is raised for it, and the run carries on — the healthy
 * scopes are declared complete and resolve by absence as usual, while nothing
 * in the broken scope is resolved. Aborting instead would take every
 * jurisdiction dark for one bad calendar (Ahmed's decision, 2026-08-14).
 *
 * "Today" is each jurisdiction's own civil date, never the UTC day: the job
 * fires at 02:00, which in the Gulf is 22:00 the UTC day before.
 */
export async function runDeadlineSweep(deps: DeadlineDeps): Promise<SweepReport> {
  const asOf = deps.now?.() ?? new Date();
  const runId = deps.runId?.() ?? randomUUID();
  const [registrations, rules] = await Promise.all([
    deps.store.listRegistrations(),
    deps.store.listThresholds(),
  ]);

  const byJurisdiction = new Map<string, Registration[]>();
  const unconfigured = new Set<string>();
  for (const registration of registrations) {
    const rows = byJurisdiction.get(registration.jurisdictionId) ?? [];
    rows.push(registration);
    byJurisdiction.set(registration.jurisdictionId, rows);
    // Independent of any calendar, so a type in an unscorable jurisdiction is
    // still reported as unconfigured rather than lost with it.
    if (!isConfigured(rules, registration.deadlineType)) unconfigured.add(registration.deadlineType);
  }

  const breaches: ReportedAlert[] = [];
  const scopes: RunScope[] = [];
  let evaluated = 0;

  for (const [jurisdictionId, rows] of byJurisdiction) {
    const calendar = await deps.calendars.forJurisdiction(jurisdictionId);
    if (!calendar) {
      scopes.push({
        jurisdictionId,
        complete: false,
        reason: `no BusinessCalendar for jurisdiction ${jurisdictionId}; its deadlines were not scored`,
      });
      await raiseMisconfiguration(deps, "jurisdiction", jurisdictionId, MISSING_CALENDAR_POLICY, {
        jurisdictionId,
        unscoredRegistrations: rows.length,
        runId,
      });
      continue;
    }
    const civilDate = civilDateIn(calendar.timeZone, asOf);
    for (const registration of rows) {
      const { fingerprint, severity } = evaluate(deps.tenant, calendar, rules, registration, civilDate);
      evaluated += 1;
      if (severity !== null) breaches.push({ fingerprint, severity, jurisdictionId });
    }
    scopes.push({ jurisdictionId, complete: true, civilDate });
  }

  // One alert per unconfigured TYPE per run, not one per deadline: a missing
  // row is a single actionable signal, and silence is not an option.
  for (const deadlineType of unconfigured) {
    await raiseMisconfiguration(deps, "deadline-type", deadlineType, NO_THRESHOLD_POLICY, {
      deadlineType,
      registrations: registrations.filter((row) => row.deadlineType === deadlineType).length,
      runId,
    });
  }

  await deps.alerts.reportRun(SOURCE_ID, runId, breaches, scopes);

  return {
    sourceId: SOURCE_ID,
    runId,
    asOf,
    evaluated,
    breaches,
    scopes,
    unconfiguredTypes: [...unconfigured],
  };
}
