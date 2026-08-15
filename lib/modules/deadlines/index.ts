// The deadline monitor's public surface. Everything outside this module reaches
// it through this file and through nothing else (CLAUDE.md rule 4) — the seam
// is the same call whether this is a folder or a container (ADR-021).
//
// This node lands the two tables, the business-calendar date rules, and the
// threshold semantics that decide how serious a remaining distance is.
// Registration, the nightly sweep, the store port and the alert contract land
// with module-deadlines-sweep — absent here, not stubbed. Threshold semantics
// were settled by Ahmed 2026-08-14 and are written into
// components-core-deadline-monitor.md, so this half builds to a spec.

export { businessDaysUntil, filingDueDate, statutoryDueDate, isWorkingDay, MissingBusinessCalendarError, requireCalendar } from "./calendar";
export type { BusinessCalendar, CalendarSource } from "./calendar";
export { APP_ID, fingerprintFor, highestSeverity, isConfigured, severityFor, SOURCE_ID } from "./thresholds";
export type { Severity, ThresholdRule } from "./thresholds";
