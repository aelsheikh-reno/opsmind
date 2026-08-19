// The Alert Manager's public surface. Everything outside this service reaches
// it through this file and through nothing else (CLAUDE.md rule 4) — the seam
// is the same call whether this is a folder or a container (ADR-021), and it
// STAYS a function call: the reuse target is an importable package, not a
// deployment, so there is no HTTP client here and no token to rotate (ADR-039).
//
// Shape: pure domain in lifecycle.ts taking values rather than clients, this
// file the only thing a caller may import. The store arrives later, as a port,
// which is what keeps a test of the rules free of a database.

import type { AlertSeverity } from "./lifecycle";

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
  reassert,
  resolveAlert,
  sameIdentity,
  suppress,
} from "./lifecycle";
export type { AlertIdentity, AlertRaise, AlertRecord, AlertSeverity, AlertState } from "./lifecycle";

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
 * rather than draft: the two verbs below are the ones a caller can use before
 * a store exists.
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
}

/**
 * The client, bound to its type with an explicit annotation and NO CAST, so
 * the shape is fixed by the compiler rather than by convention. The two sides
 * of the port are checked against each other where they meet — this engine
 * imports nothing from a caller, and a structural disagreement is a red
 * typecheck rather than a surprise at 02:00.
 *
 * IT RECORDS NOTHING YET, deliberately: the store lands as a port in the next
 * node and there is nowhere to put a raise until it does. Both verbs are
 * therefore total and cannot fail, which matters more than it looks — a caller
 * awaits them mid-run without a guard, so a throw from here would end that run
 * before it reported anything at all (ADR-040).
 *
 * Neither body NAMES a parameter, and a shorter list still satisfies the port.
 * That is worth the oddity: an implementation that cannot reach `context` is a
 * stronger guarantee than one that promises not to read it (ADR-040, ADR-039).
 */
export function createAlertManager(): AlertManagerClient {
  const client: AlertManagerClient = {
    reportRun() {
      return Promise.resolve();
    },
    raiseAlert() {
      return Promise.resolve();
    },
  };
  return client;
}
