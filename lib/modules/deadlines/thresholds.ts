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
 * One fingerprint segment, with the separator escaped.
 *
 * `:` joins the segments, so a segment that CONTAINS one collides two identities
 * into a single string: `("document", "123:expiry", "renewal")` and
 * `("document", "123", "expiry:renewal")` both read `…:document:123:expiry:renewal`,
 * and the Alert Manager dedupes the second away — an alert that is not merely
 * wrong but invisible, which is the failure mode this module exists to prevent.
 *
 * Escaped rather than rejected at `registerDeadline`, because fingerprints are
 * also computed for jurisdiction ids and policy names (the misconfiguration
 * alerts), and a check on one caller leaves every other caller colliding. The
 * backslash is escaped too, or `a\` + `:b` and `a` + `\:b` would collide in its
 * place.
 *
 * A segment containing neither character is returned byte for byte, so no
 * existing identity moves: the fingerprint IS the alert's identity, and changing
 * one resolves the old alert and reopens it as a new one.
 */
function escapeSegment(segment: string): string {
  return segment.replace(/[\\:]/g, (char) => `\\${char}`);
}

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
  return [tenant, APP_ID, SOURCE_ID, entityType, entityId, deadlineType].map(escapeSegment).join(":");
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
 * The most severe level this build can express. Used only for a
 * MISCONFIGURATION — a jurisdiction with no calendar, a type with no threshold
 * row — where by definition no row exists to read a severity from. Derived from
 * the enum rather than written as a literal, so adding a level moves it.
 *
 * NOT used for an overdue deadline: an overdue deadline has rows, so its ceiling
 * is read from them (`severityFor`). Reaching for this function there would put
 * a type an administrator marked never-urgent at the same band as a lapsed visa.
 */
export function highestSeverity(): Severity {
  return SEVERITY_ORDER[SEVERITY_ORDER.length - 1];
}

/**
 * What a threshold table says about one deadline. THREE outcomes, not two.
 *
 * Returning `null` for both "no window is breached" and "no window is
 * configured" let a caller write `if (severityFor(...) === null) return;` and
 * silently drop an unwatched deadline — a hole read as safety, which is the
 * exact failure this module exists to prevent (spec, Note:46). The two facts are
 * opposite, so the type distinguishes them and the compiler makes the caller
 * say which it meant, rather than trusting it to remember to call `isConfigured`
 * as well.
 */
export type SeverityVerdict =
  | { readonly status: "breached"; readonly severity: Severity }
  | { readonly status: "safe" }
  | { readonly status: "unconfigured" };

/**
 * What this table says about a deadline `businessDaysRemaining` away: breached
 * at some severity, safe inside every configured window, or unconfigured.
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
 * An OVERDUE deadline, with negative days remaining, breaches every window its
 * type has, so it takes the highest severity CONFIGURED FOR ITS TYPE — a
 * per-type ceiling, not the top of the scale. A type whose Settings rows are all
 * `minor` reports `minor` however far past due it runs, because the severity
 * column in Settings is how an administrator says "this type is never urgent",
 * and an overdue stationery order at the same band as a lapsed visa empties the
 * top band of meaning (spec, Note).
 *
 * That low band is NOT silence: the alert still fires, appears in the run and is
 * reported. Severity governs urgency, not visibility.
 *
 * A 2026-08-16 reversal scored overdue at the top of the scale instead. It was
 * made on a false premise and is withdrawn (Ahmed, 2026-08-16): legacy is SILENT
 * on this case rather than louder than this build — its digest collects nothing
 * already past due except payroll runs, every collection query being `gte: now`
 * — so it has no opinion on an expired visa, and there is no legacy oracle for
 * this rule to cite.
 *
 * A type with no rows configured is never scored here, overdue or not: it
 * answers `unconfigured`, which is a hole and not an answer, so the sweep raises
 * a misconfiguration alert for the type rather than this file inventing a
 * default window — and overdue is not a licence to score a type nobody
 * configured.
 */
export function severityFor(
  rules: readonly ThresholdRule[],
  deadlineType: string,
  businessDaysRemaining: number,
): SeverityVerdict {
  const overdue = businessDaysRemaining < 0;
  let worst: Severity | null = null;
  let configured = false;
  for (const rule of rules) {
    if (rule.deadlineType !== deadlineType) continue;
    configured = true;
    if (!overdue && businessDaysRemaining > rule.businessDaysBefore) continue;
    worst = worst === null ? rule.severity : moreSevere(worst, rule.severity);
  }
  if (!configured) return { status: "unconfigured" };
  return worst === null ? { status: "safe" } : { status: "breached", severity: worst };
}

/** True when any window is configured for this type at all. */
export function isConfigured(rules: readonly ThresholdRule[], deadlineType: string): boolean {
  return rules.some((rule) => rule.deadlineType === deadlineType);
}
