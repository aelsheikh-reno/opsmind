// Test ports for `deadlines-alert-contract-scope-and-failure` (ADR-040).
//
// WRITTEN FROM THE SPECIFICATION. No file under `lib/modules/deadlines/` was
// read as implementation while this directory's ADR-040 cases were written; the
// pre-change public surface of `index.ts` was read once, from git, only to bind
// the calls (types and parameter lists, no bodies). Every expected value comes
// from docs/architecture/decisions.md (ADR-039, ADR-040),
// docs/architecture/flows-alerting.md or
// docs/architecture/components-core-deadline-monitor.md, cited at the case.
//
// WHY A SECOND SET OF PORTS, beside `./surface`. The fake Alert Manager there
// cannot fail, and every assertion of this node is about what a run does when
// `raiseAlert` does fail. Extending it in place would have changed a fixture
// eight merged test files depend on; this file borrows its VALUE fixtures
// (`d`, `calendar`, `deadline`, `threshold`, `GULF`) and brings its own ports.
//
// THE CONTRACT UNDER TEST, decided in ADR-040 and treated here as spec:
//
//     raiseAlert(
//       fingerprint: string,
//       severity: Severity,
//       policyId: string,
//       areas: readonly string[],   // <- new, and BEFORE context
//       context: Record<string, unknown>,
//     ): Promise<void>
//
// `areas` are opaque scope keys, matching the `area` of `RunScope`. ADR-043
// renamed that field from `jurisdictionId` so the port carries ONE vocabulary
// and none of it is OpsMind's; the values it carries here are still
// jurisdiction ids, because that is what OpsMind puts in them.
//
// TOLERANT PLUMBING, STRICT ASSERTIONS — the same split `./surface` uses. The
// fakes take `...rest: unknown[]` so that a module still on the four-argument
// signature produces a FAILING ASSERTION that names the rule, rather than a
// compile error that takes the calendar and threshold suites down with it.
// Nothing asserted is relaxed by that: `areasOf` reads position 3 and nowhere
// else, because the position is part of the decided contract.
import {
  MISSING_CALENDAR_POLICY,
  NO_THRESHOLD_POLICY,
  registerDeadline as register,
  runDeadlineSweep,
  type AlertManager,
  type BusinessCalendar,
  type CalendarSource,
  type DeadlineDeps,
  type DeadlineStore,
  type Evaluation,
  type Registration,
  type ReportedAlert,
  type RunScope,
  type Severity,
  type SweepReport,
  type ThresholdRule,
} from "@/lib/modules/deadlines";

import { GULF, calendar, d, deadline, threshold } from "./surface";

export { GULF, MISSING_CALENDAR_POLICY, NO_THRESHOLD_POLICY, calendar, d, deadline, threshold };
export type { BusinessCalendar, Registration, ReportedAlert, RunScope, Severity, SweepReport, ThresholdRule };

// ------------------------------------------------------------- what we saw --

/** One `raiseAlert` call, exactly as it arrived. */
export type RaiseCall = {
  fingerprint: string;
  severity: Severity;
  /** Everything after `severity`: `[policyId, areas, context]` under ADR-040. */
  rest: readonly unknown[];
  /** Whether this call's promise rejected (or its body threw). */
  failed: boolean;
};

/** One `reportRun` call. */
export type RunCall = {
  sourceId: string;
  runId: string;
  alerts: ReportedAlert[];
  /** The completeness declaration, or undefined when the run declared none. */
  scopes: RunScope[] | undefined;
  rest: readonly unknown[];
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

/**
 * The `policyId` argument — position 2, the one it has always occupied.
 */
export const policyOf = (call: RaiseCall): string | undefined =>
  typeof call.rest[0] === "string" ? call.rest[0] : undefined;

/**
 * The `areas` argument — position 3, and ONLY position 3.
 *
 * ADR-040(2): "The area is a named argument on `raiseAlert`, not something read
 * back out of `context`." Reading it anywhere else here would let a module that
 * appended the areas after the context bag, or nested them inside it, pass a
 * test whose whole subject is where the scope travels.
 */
export const areasOf = (call: RaiseCall): readonly string[] | undefined =>
  isStringArray(call.rest[1]) ? call.rest[1] : undefined;

/** The `context` bag — position 4, after the areas. */
export const contextOf = (call: RaiseCall): Record<string, unknown> | undefined =>
  call.rest[2] !== null && typeof call.rest[2] === "object" && !Array.isArray(call.rest[2])
    ? (call.rest[2] as Record<string, unknown>)
    : undefined;

/**
 * A failure message worth reading when `areasOf` comes back undefined: it says
 * what the call actually carried, and where a string list turned up if one did.
 */
export function describeCall(call: RaiseCall): string {
  const found = call.rest.findIndex(isStringArray);
  const where =
    found === -1
      ? "no argument was a list of strings at all"
      : `a list of strings arrived at argument ${found + 3} instead of argument 4`;
  return (
    `raiseAlert("${call.fingerprint}", "${call.severity}", ${call.rest
      .map((value) => JSON.stringify(value))
      .join(", ")}) — ${where}. ADR-040(2): the area is the fourth argument, before context.`
  );
}

/** The areas of `call`, or a named failure rather than an undefined deref. */
export function requireAreas(call: RaiseCall): readonly string[] {
  const areas = areasOf(call);
  if (areas === undefined) throw new Error(describeCall(call));
  return areas;
}

/** Sorted, so no case ever asserts the order the module happened to emit. */
export const sorted = (values: Iterable<string>): string[] => [...values].sort();

// ------------------------------------------------------- the Alert Manager --

/** How an alert stands with the engine. flows-alerting.md, "The state machine". */
export type AlertStatus = "firing" | "stale" | "resolved";

export type AlertState = {
  fingerprint: string;
  severity: Severity;
  /** The scope it was reported in — `ReportedAlert.area` (ADR-043). */
  scope: string | undefined;
  status: AlertStatus;
};

/** Which `raiseAlert` calls this engine refuses, and how it refuses them. */
export type FailurePlan = {
  /** Policy ids whose alert call fails. */
  policies?: readonly string[];
  /** `reject` returns a rejected promise; `throw` throws before returning one.
   *  Both are real client failure modes and a `.catch()` only survives the first. */
  mode?: "reject" | "throw";
  /** Dropped entirely, to stand in for an engine that never parses a caller's
   *  context bag (ADR-039). Nothing about scoping may depend on this. */
  blindToContext?: boolean;
};

/**
 * A stand-in for the Alert Manager that records every call, models the
 * resolution lifecycle, and can be told to fail.
 *
 * The lifecycle model is the one flows-alerting.md:46-47 fixes, and it is
 * modelled here rather than asserted on the payload because assertions 3 and 4
 * of this node are lifecycle claims: whether absence resolves. An alert absent
 * from a report resolves only if its scope was declared COMPLETE; in an
 * incomplete scope it stays open and is marked STALE.
 *
 * A run that declares no scopes at all is treated as complete for everything —
 * the pre-2026-08-14 reading. That direction is deliberate: it makes the STALE
 * cases fail against a module that forgets to declare a scope, rather than pass
 * because the fake was generous.
 */
export function alertEngine(plan: FailurePlan = {}) {
  const raised: RaiseCall[] = [];
  const runs: RunCall[] = [];
  const resolved: string[] = [];
  const board = new Map<string, AlertState>();
  const failing = new Set(plan.policies ?? []);

  const scopeIsComplete = (scopes: RunScope[] | undefined, scope: string | undefined): boolean => {
    if (scopes === undefined) return true;
    return scopes.some((row) => row.area === scope && row.complete);
  };

  const engine = {
    raised,
    runs,
    resolved,
    /** Every alert the engine holds, in the order it first heard of each. */
    board: () => [...board.values()],
    stateOf: (fingerprint: string): AlertState | undefined => board.get(fingerprint),

    reportRun(sourceId: string, runId: string, alerts: readonly ReportedAlert[], ...rest: unknown[]) {
      const scopes = readScopes(rest);
      runs.push({ sourceId, runId, alerts: [...alerts], scopes, rest });

      const reported = new Set(alerts.map((alert) => alert.fingerprint));
      for (const alert of alerts) {
        const known = board.get(alert.fingerprint);
        board.set(alert.fingerprint, {
          fingerprint: alert.fingerprint,
          severity: alert.severity,
          scope: alert.area ?? known?.scope,
          status: "firing",
        });
      }
      for (const state of board.values()) {
        if (reported.has(state.fingerprint) || state.status === "resolved") continue;
        state.status = scopeIsComplete(scopes, state.scope) ? "resolved" : "stale";
      }
      return Promise.resolve();
    },

    raiseAlert(fingerprint: string, severity: Severity, ...rest: unknown[]) {
      const kept = plan.blindToContext === true ? rest.slice(0, 2) : rest;
      const policy = typeof rest[0] === "string" ? rest[0] : "";
      const fails = failing.has(policy);
      raised.push({ fingerprint, severity, rest: kept, failed: fails });
      if (!fails) return Promise.resolve();

      const boom = new Error(`the Alert Manager refused the ${policy} alert`);
      // A client that throws before it ever returns a promise is a different
      // code path from one that returns a rejected promise: `.catch()` on the
      // call survives only the second. Both must leave the run standing.
      if (plan.mode === "throw") throw boom;
      return Promise.reject(boom);
    },
  };

  // Not a verb a sweep source uses — "modules never call cancel"
  // (components-core-deadline-monitor.md). Recorded so that a module reaching
  // for it is caught rather than silently type-checked away.
  (engine as unknown as Record<string, unknown>).resolveAlert = (fingerprint: string) => {
    resolved.push(fingerprint);
    const state = board.get(fingerprint);
    if (state !== undefined) state.status = "resolved";
    return Promise.resolve();
  };
  return engine;
}

export type AlertEngine = ReturnType<typeof alertEngine>;

const isRunScope = (value: unknown): value is RunScope =>
  value !== null &&
  typeof value === "object" &&
  typeof (value as RunScope).area === "string" &&
  typeof (value as RunScope).complete === "boolean";

/**
 * The `RunScope[]` a run declared. `reportRun(sourceId, runId, alerts, scopes)`
 * already carries it on the merged module, so this reads the argument in place
 * and returns undefined for anything that is not a list of scope rows — which
 * is what lets the completeness cases fail rather than silently read nothing.
 */
function readScopes(rest: readonly unknown[]): RunScope[] | undefined {
  const value = rest[0];
  if (!Array.isArray(value)) return undefined;
  return value.every(isRunScope) ? (value as RunScope[]) : undefined;
}

// ---------------------------------------------------------------- the world --

export type Scenario = {
  /** The civil day the run is scored against. */
  today: Date;
  /** The instant the sweep fires, when it differs from `today`. */
  at?: Date;
  runId?: string;
  registrations: Registration[];
  thresholds: ThresholdRule[];
  calendars: BusinessCalendar[];
  alerts: AlertEngine;
};

function store(scenario: Scenario): DeadlineStore {
  const rows = scenario.registrations;
  const same = (a: { entityType: string; entityId: string; deadlineType: string }, b: typeof a) =>
    a.entityType === b.entityType && a.entityId === b.entityId && a.deadlineType === b.deadlineType;
  return {
    upsertRegistration(input) {
      const row: Registration = {
        id: `${input.entityType}:${input.entityId}:${input.deadlineType}`,
        ...input,
      };
      const index = rows.findIndex((existing) => same(existing, input));
      if (index === -1) rows.push(row);
      else rows[index] = row;
      return Promise.resolve(row);
    },
    deleteRegistration(ref) {
      const index = rows.findIndex((existing) => same(existing, ref));
      if (index !== -1) rows.splice(index, 1);
      return Promise.resolve();
    },
    listRegistrations: () => Promise.resolve([...rows]),
    listThresholds: () => Promise.resolve([...scenario.thresholds]),
  };
}

function calendars(scenario: Scenario): CalendarSource {
  return {
    forJurisdiction: (jurisdictionId) =>
      Promise.resolve(
        scenario.calendars.find((entry) => entry.jurisdictionId === jurisdictionId) ?? null,
      ),
  };
}

function deps(scenario: Scenario): DeadlineDeps {
  return {
    tenant: "reno",
    store: store(scenario),
    calendars: calendars(scenario),
    alerts: scenario.alerts as unknown as AlertManager,
    now: () => scenario.at ?? scenario.today,
    runId: () => scenario.runId ?? "r9",
  };
}

// ---------------------------------------------------------------- the verbs --

/**
 * One sweep, returning whatever it returned.
 *
 * Deliberately NOT the `./surface` helper, which throws when a run sends no
 * report: assertion 2 of this node is precisely "a sweep whose alert call
 * rejects still reaches reportRun", and a helper that throws first would turn
 * that failure into a thrown fixture rather than a named assertion. Cases here
 * assert `runsSince(...)` themselves.
 */
export function sweep(scenario: Scenario): Promise<SweepReport> {
  return runDeadlineSweep(deps(scenario));
}

/** The reports sent since `before`, so a case can assert how many there were. */
export const runsSince = (alerts: AlertEngine, before: number): RunCall[] =>
  alerts.runs.slice(before);

/** The one report a run sends. Asserts the count first, with the reason why. */
export function onlyRun(alerts: AlertEngine, before = 0): RunCall {
  const sent = runsSince(alerts, before);
  if (sent.length !== 1) {
    throw new Error(
      `the sweep called reportRun ${sent.length} times; every run sends exactly one report, ` +
        "and a run whose alert call failed still reaches it (ADR-040(3)).",
    );
  }
  return sent[0];
}

/** Register a deadline against this scenario, scoring it inline. */
export function registerDeadline(
  scenario: Scenario,
  entry: Registration,
): Promise<{ registration: Registration } & Evaluation> {
  return register(entry, deps(scenario));
}

// ----------------------------------------------------------- reading a run --

/** The scope row a run declared for `area`, if it declared one. */
export const scopeFor = (run: RunCall, area: string): RunScope | undefined =>
  run.scopes?.find((row) => row.area === area);

/** Every area the run declared a scope for, in emission order. The helper keeps
 *  its name: the FIELD is `area` (ADR-043), and what OpsMind puts in it is still
 *  a jurisdiction id — the port stopped naming the noun, OpsMind did not. */
export const scopedJurisdictions = (run: RunCall): string[] =>
  (run.scopes ?? []).map((row) => row.area);

/** True when the run reported a breach whose identity ends `tail`. */
export const reportedBreach = (run: RunCall, tail: string): boolean =>
  run.alerts.some((alert) => alert.fingerprint.endsWith(tail));

/** Raise calls carrying `policyId`. */
export const raisesFor = (alerts: AlertEngine, policyId: string): RaiseCall[] =>
  alerts.raised.filter((call) => policyOf(call) === policyId);

/** The single raise for `policyId`, asserted to be single before it is read. */
export function onlyRaiseFor(alerts: AlertEngine, policyId: string): RaiseCall {
  const calls = raisesFor(alerts, policyId);
  if (calls.length !== 1) {
    throw new Error(
      `expected exactly one ${policyId} alert, saw ${calls.length}: ` +
        JSON.stringify(alerts.raised.map((call) => ({ fingerprint: call.fingerprint, rest: call.rest }))),
    );
  }
  return calls[0];
}

// ----------------------------------------------------------- the fixtures --

/** A Sunday — the first working day of the Gulf week. */
export const TODAY = d("2026-08-16");

export const AE = calendar("AE", GULF);
export const KW = calendar("KW", GULF);
export const BH = calendar("BH", GULF);
export const SA = calendar("SA", GULF);

/** `expiry` is watched; every other type in these fixtures is not. */
export const WATCHED = "expiry";
/** A registered type with no ThresholdTable row — watched by nobody. */
export const UNWATCHED = "trade-licence";

export const THRESHOLDS: ThresholdRule[] = [threshold(WATCHED, 10, "major")];

/** Four business days out under the Gulf week — inside the ten-day window. */
export const breaching = (ref: string, jurisdictionId: string): Registration =>
  deadline(ref, WATCHED, d("2026-08-20"), jurisdictionId);

/** Months out under any reading — scored, and clear. */
export const clear = (ref: string, jurisdictionId: string): Registration =>
  deadline(ref, WATCHED, d("2026-12-31"), jurisdictionId);

/** A registration of the type nobody configured a threshold for. */
export const unwatched = (ref: string, jurisdictionId: string): Registration =>
  deadline(ref, UNWATCHED, d("2026-08-20"), jurisdictionId);

/** A scenario with the standard thresholds and a fresh engine. */
export function scenario(
  registrations: Registration[],
  calendarRows: BusinessCalendar[],
  alerts: AlertEngine = alertEngine(),
): Scenario {
  return { today: TODAY, runId: "r9", registrations, thresholds: THRESHOLDS, calendars: calendarRows, alerts };
}
