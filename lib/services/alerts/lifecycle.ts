// The alert lifecycle, as values. Every function here takes what it needs and
// returns what it decided: no store, no clock, no client, no I/O. That is what
// lets the rules below be exercised without a database, and it is the same
// split the sources of this engine use internally (ADR-020).
//
// NOTHING IN THIS FILE KNOWS WHAT A CALLER IS WATCHING. Detection is the
// caller's, severity is the caller's, and the scope keys are the caller's own
// vocabulary. This engine is imported into other codebases (ADR-039).

/**
 * The four states, and only these four (ADR-020).
 *
 * There is no fifth for "open but unconfirmed": that is `stale` below, a flag,
 * because an alert is firing AND unconfirmed at once and a fifth state makes
 * that pair unrepresentable.
 */
export type AlertState = "firing" | "acknowledged" | "suppressed" | "resolved";

/** Declared as data so a caller can enumerate the lifecycle without a fifth
 *  member appearing by accident. */
export const ALERT_STATES: readonly AlertState[] = ["firing", "acknowledged", "suppressed", "resolved"];

/**
 * Acknowledged and suppressed are OPEN. Acknowledgement pauses paging and
 * suppression silences it; neither closes the alert and neither resolves it,
 * so only the caller or a logged human resolve ever takes an alert out of this
 * list (flows-alerting.md).
 */
export const OPEN_STATES: readonly AlertState[] = ["firing", "acknowledged", "suppressed"];

export function isOpen(state: AlertState): boolean {
  return OPEN_STATES.includes(state);
}

export function isResolved(state: AlertState): boolean {
  return !isOpen(state);
}

/**
 * The severity scale, least severe first.
 *
 * The engine CONSUMES severity and never judges it — which level a condition
 * deserves is the caller's decision. What the engine owns is the ordering, and
 * only because monotonicity needs one. Adding a level is a migration, not a
 * literal invented here.
 */
export type AlertSeverity = "minor" | "major";

const SEVERITY_ORDER: readonly AlertSeverity[] = ["minor", "major"];

export function isMoreSevere(candidate: AlertSeverity, current: AlertSeverity): boolean {
  return SEVERITY_ORDER.indexOf(candidate) > SEVERITY_ORDER.indexOf(current);
}

/**
 * Severity while an alert is open is monotonic: it rises in place and never
 * falls. A genuine downgrade is a resolve followed by a new alert, because
 * severity is deliberately absent from the identity below — if it were part of
 * it, an escalation would open a second alert for one fact and dedupe would
 * break.
 */
export function raisedSeverity(current: AlertSeverity, incoming: AlertSeverity): AlertSeverity {
  return isMoreSevere(incoming, current) ? incoming : current;
}

/**
 * What happened to an alert, as the append-only log spells it (data-model.md,
 * the AlertEvent card). Declared beside the rules that decide it so nothing
 * here has to reach into a store to name an outcome.
 */
export type AlertEventKind =
  | "raised"
  | "reasserted"
  | "severity_raised"
  | "stale_marked"
  | "stale_cleared"
  | "acknowledged"
  | "suppressed"
  | "unsuppressed"
  | "resolved";

/**
 * An alert's identity: the caller that raised it, and the caller's own
 * deterministic string.
 *
 * THE FINGERPRINT IS OPAQUE AND IS NEVER TAKEN APART. It is compared whole,
 * with `===`, and nothing in this engine separates it into parts. Callers join
 * their parts with a separator and escape that separator inside a part, so a
 * reader that pulled the string apart would cut in the wrong places, merge two
 * identities into one and make an alert not merely wrong but invisible — the
 * exact failure the escaping exists to prevent. Two strings that differ
 * anywhere are two alerts.
 *
 * `sourceId` scopes it, because two callers may legitimately compute the same
 * string about different things.
 */
export interface AlertIdentity {
  sourceId: string;
  fingerprint: string;
}

export function sameIdentity(a: AlertIdentity, b: AlertIdentity): boolean {
  return a.sourceId === b.sourceId && a.fingerprint === b.fingerprint;
}

/**
 * What a caller hands in when it raises. `areas` are the caller's OWN opaque
 * scope keys: the engine compares them and never interprets them, and it never
 * digs one out of `context` — one caller's spelling of a bag key must not
 * become this component's contract (ADR-040, ADR-043).
 */
export interface AlertRaise extends AlertIdentity {
  severity: AlertSeverity;
  /** Recorded verbatim. A policy this engine holds no configuration for is
   *  accepted and kept, never refused: the engine is not the rule book. */
  policyId: string;
  areas: readonly string[];
  /** The caller's own diagnostic payload, carried whole and never read. */
  context: Record<string, unknown>;
}

/** One alert as it stands. `resolvedAt` is null while open, and the record
 *  survives resolution — nothing is deleted to close an alert. */
export interface AlertRecord extends AlertIdentity {
  state: AlertState;
  /** Unconfirmed, not closed: set when a run did not cover this alert's areas,
   *  cleared when one does. Orthogonal to `state` on purpose. */
  stale: boolean;
  severity: AlertSeverity;
  policyId: string;
  areas: readonly string[];
  context: Record<string, unknown>;
  firstSeenAt: Date;
  lastSeenAt: Date;
  resolvedAt: Date | null;
}

/** A first sighting. Nothing about the raise is validated: an unrecognised
 *  policy is data, not an error. */
export function openAlert(raise: AlertRaise, at: Date): AlertRecord {
  return {
    sourceId: raise.sourceId,
    fingerprint: raise.fingerprint,
    state: "firing",
    stale: false,
    severity: raise.severity,
    policyId: raise.policyId,
    areas: [...raise.areas],
    context: raise.context,
    firstSeenAt: at,
    lastSeenAt: at,
    resolvedAt: null,
  };
}

/**
 * The same identity, seen again. One row, never a second: severity rises in
 * place and a lower one is ignored, and `firstSeenAt` survives re-firing.
 *
 * A raise against a resolved alert opens it again as firing and starts it
 * clean — at the incoming severity, since the earlier one closed with the
 * earlier alert, which is what makes resolve-then-reopen the honest way to
 * express a downgrade.
 */
export function reassert(alert: AlertRecord, raise: AlertRaise, at: Date): AlertRecord {
  const reopening = isResolved(alert.state);
  return {
    ...alert,
    state: reopening ? "firing" : alert.state,
    stale: reopening ? false : alert.stale,
    severity: reopening ? raise.severity : raisedSeverity(alert.severity, raise.severity),
    policyId: raise.policyId,
    areas: [...raise.areas],
    context: raise.context,
    lastSeenAt: at,
    resolvedAt: null,
  };
}

/**
 * What one raise amounts to against what is already stored, as a single event.
 * `severity_raised` implies the reassertion it rode in on, so a raise writes
 * one event and never two — a log a reader has to de-duplicate is not a log.
 */
export function raiseKind(current: AlertRecord | null, incoming: AlertSeverity): AlertEventKind {
  if (current === null || isResolved(current.state)) return "raised";
  return isMoreSevere(incoming, current.severity) ? "severity_raised" : "reasserted";
}

/**
 * Pausing paging. Leaves the alert OPEN, so `resolvedAt` stays null and
 * `lastSeenAt` does not move — that timestamp records the caller carrying the
 * alert, and a human acknowledging it is not the caller. An alert already
 * closed has no paging to pause and comes back unchanged.
 */
export function acknowledge(alert: AlertRecord): AlertRecord {
  return isOpen(alert.state) ? { ...alert, state: "acknowledged" } : alert;
}

/** Silencing, on the same terms as acknowledgement: still open, still
 *  addressable, still resolvable only by the caller or a human. */
export function suppress(alert: AlertRecord): AlertRecord {
  return isOpen(alert.state) ? { ...alert, state: "suppressed" } : alert;
}

/** Closing. Idempotent, and the original instant is kept — re-resolving must
 *  not rewrite when the alert actually closed. */
export function resolveAlert(alert: AlertRecord, at: Date): AlertRecord {
  return isResolved(alert.state) ? alert : { ...alert, state: "resolved", stale: false, resolvedAt: at };
}

/**
 * Unconfirmed. `lastSeenAt` does not move either: the run that marks an alert
 * stale is precisely the run that did NOT carry it.
 *
 * THE STATE DOES NOT MOVE: an alert marked here is firing and
 * stale at once, which is the whole reason this is a flag. A caller that has
 * gone quiet can flag its alerts unconfirmed and can never close them.
 */
export function markStale(alert: AlertRecord): AlertRecord {
  return isOpen(alert.state) ? { ...alert, stale: true } : alert;
}

/** Confirmed again by a run that covered it. The state is untouched here too. */
export function clearStale(alert: AlertRecord): AlertRecord {
  return alert.stale ? { ...alert, stale: false } : alert;
}
