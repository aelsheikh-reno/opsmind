// Task `module-deadlines` — test fixtures. Written from the specification alone.
//
// No file under `lib/modules/deadlines/` was read as implementation, and
// `prisma/migrations/` was not read at all: the module was written in parallel
// with these tests, and a test retrofitted to an implementation describes what
// was written rather than what the spec requires. Every expected value in this
// directory comes from docs/architecture/components-core-deadline-monitor.md,
// flows-alerting.md, data-model.md, prisma/schema.prisma's kernel models,
// CLAUDE.md or reference/legacy/, cited at the test.
//
// What WAS read, once the module landed and only to bind the calls: the
// exported declarations of index.ts and calendar.ts — names, parameter lists
// and types, no bodies. That is the module's public surface, which the task
// explicitly allows. It changed the plumbing in this file (the order of
// businessDaysUntil's arguments) and not one assertion or expected value.
//
// Scope note: this node was split after these were written. thresholds.ts, the
// store and alert ports, and the sweep fixtures that used them went to
// module-deadlines-sweep along with the tests that exercise them. What remains
// here is the calendar half — pure functions over values, no fakes needed,
// because nothing left in this node reaches a database or an alert manager.

import {
  businessDaysUntil,
  filingDueDate,
  statutoryDueDate,
  requireCalendar,
  type BusinessCalendar,
} from "@/lib/modules/deadlines";

export type { BusinessCalendar };

// ------------------------------------------------------------------ values --

/**
 * A civil date from an ISO day. Built at UTC midnight because that is how this
 * build stores civil dates (data-model.md) and how Prisma `@db.Date` returns
 * them, so a fixture and a production row name the same day.
 */
export const d = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

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

export function calendar(
  jurisdictionId: string,
  weekendMask: readonly number[],
  holidays: string[] = [],
): BusinessCalendar {
  return { jurisdictionId, weekendMask: [...weekendMask], holidays: holidays.map(d) };
}

/** `entityRef` is the spec's `…document:123:expiry` identity, split at the colon. */

/**
 * A stand-in for the Alert Manager that records every call. The verbs are
 * flows-alerting.md's contract; `runs`, `raised` and `resolved` are what the
 * tests assert on, because "The run reports its complete breach set to the
 * Alert Manager" makes the call itself the observable outcome.
 */

// -------------------------------------------------------------- the verbs --

/** Business-day distance across a calendar, in the tests' own argument order. */
export function businessDays(from: Date, to: Date, cal: BusinessCalendar): number {
  return businessDaysUntil(cal, from, to);
}

/** periodEnd + Regime.deadlineDays, in plain calendar days. */
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

/**
 * The same sweep as the 02:00 job makes it: no clock and no run id handed in
 * (operations-scheduling.md:21). Pin the system clock around it.
 */

// -------------------------------------------------------------- assertions --

