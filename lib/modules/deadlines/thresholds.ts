// Thresholds, severity and fingerprints — the detection half of ADR-020.
//
// Detection owns what counts as a problem and how serious it is; the Alert
// Manager owns everything after. Nothing in this file is a constant: the
// windows and severities arrive as ThresholdTable rows, editable in Settings
// without a deployment, exactly as a SOC tunes detection rules.

/** Mirrors the AlertSeverity enum in the schema; see the comment there. */
export type Severity = "minor" | "major";

/** One ThresholdTable row: at or inside this window, this type is that serious. */
export interface ThresholdRule {
  deadlineType: string;
  businessDaysBefore: number;
  severity: Severity;
}

/** The source id this module reports under, per the spec's reportRun example. */
export const SOURCE_ID = "deadline-monitor";

/** The application segment of a fingerprint (flows-alerting.md). */
export const APP_ID = "opsmind";

/**
 * The deterministic identity of one watched deadline:
 * `{tenant}:{app}:{source}:{entity}:{policy}` (flows-alerting.md), which for
 * this module reads `…:deadline-monitor:document:123:expiry`.
 *
 * Deterministic means the source needs no memory of what it raised — the same
 * registration computes the same string on every run, which is what lets a
 * stateless sweep dedupe and resolve correctly. Severity is deliberately absent:
 * an escalation from minor to major must not change identity, or dedupe breaks.
 * The policy segment is the deadline type rather than a ThresholdTable row id,
 * for the same reason — retuning a window must not reopen the alert.
 */
export function fingerprintFor(tenant: string, entityType: string, entityId: string, deadlineType: string): string {
  return [tenant, APP_ID, SOURCE_ID, entityType, entityId, deadlineType].join(":");
}

/**
 * The severity levels in the order the schema's `AlertSeverity` enum declares
 * them, least severe first. This is the only ordering in the file, and it is
 * schema rather than policy: WHICH window carries WHICH level is a
 * ThresholdTable row, and adding a level is a migration (data-model.md).
 */
const SEVERITY_ORDER: readonly Severity[] = ["minor", "major"];

/** The more severe of two levels. */
function moreSevere(a: Severity, b: Severity): Severity {
  return SEVERITY_ORDER.indexOf(b) > SEVERITY_ORDER.indexOf(a) ? b : a;
}

/**
 * The most severe level this build can express. Used where the answer cannot
 * come from a row: a MISCONFIGURATION — a jurisdiction with no calendar, a type
 * with no threshold row — where by definition no row exists to read a severity
 * from, and an OVERDUE deadline, which takes the top of the scale rather than
 * the top of its own rows (`severityFor`). Derived from the enum rather than
 * written as a literal, so adding a level moves both.
 */
export function highestSeverity(): Severity {
  return SEVERITY_ORDER[SEVERITY_ORDER.length - 1];
}

/**
 * The severity for a deadline that is `businessDaysRemaining` away, or null
 * when no configured window is breached.
 *
 * Where several windows are breached — 30 and 7 both fire at 5 days remaining —
 * the MAXIMUM severity wins, never the tightest window. Rows of
 * `{30 → major, 7 → minor}` report **major** at five days out: a misordered
 * Settings row must not downgrade an urgent deadline, because over-warning is
 * noisy and visible while under-warning is silent, and silence is the failure
 * this module exists to prevent. Escalation is a property of the data, not of
 * row order (spec, Note; Ahmed's decision, 2026-08-14).
 *
 * A window is INCLUSIVE at its bound — exactly seven business days remaining
 * breaches a seven-day window.
 *
 * An OVERDUE deadline, with negative days remaining, takes the highest band the
 * SEVERITY SCALE defines — `highestSeverity()` — and not the highest row present
 * for its type. A type whose Settings rows are all `minor` still reports the top
 * band once it is past due. The oracle is legacy: `reference/legacy/lib/email.ts`
 * partitions every item with `daysLeft < 0` into one `overdue` bucket (:174),
 * renders it as the red "Overdue — action needed now" section ahead of critical
 * (:238-239), and counts all of it into the "urgent" subject line (:260) —
 * regardless of type, because legacy has no per-type severity at all. Reading
 * "configured" as a per-type ceiling capped a minor-only type below the top band
 * however far past due it ran. The oracle settles the SEMANTICS, not a volume
 * comparison: legacy's digest collects nothing already past due except payroll
 * runs (every query is `gte: now`), so on an expired visa it is silent
 * (spec, Note; Ahmed's
 * decision, 2026-08-16, reversing the earlier reading).
 *
 * A type with no rows configured is never breached here, overdue or not. That is
 * a hole, not an answer, so the sweep raises a misconfiguration alert for the
 * type rather than this file inventing a default window — and overdue is not a
 * licence to score a type nobody configured.
 */
export function severityFor(rules: readonly ThresholdRule[], deadlineType: string, businessDaysRemaining: number): Severity | null {
  if (businessDaysRemaining < 0) {
    return isConfigured(rules, deadlineType) ? highestSeverity() : null;
  }
  let worst: Severity | null = null;
  for (const rule of rules) {
    if (rule.deadlineType !== deadlineType) continue;
    if (businessDaysRemaining > rule.businessDaysBefore) continue;
    worst = worst === null ? rule.severity : moreSevere(worst, rule.severity);
  }
  return worst;
}

/** True when any window is configured for this type at all. */
export function isConfigured(rules: readonly ThresholdRule[], deadlineType: string): boolean {
  return rules.some((rule) => rule.deadlineType === deadlineType);
}
