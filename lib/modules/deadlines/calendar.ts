// Business-day arithmetic for the deadline monitor.
//
// Two kinds of date maths live here and they are deliberately NOT the same:
//
//   DISTANCE — how much time is left — is counted in WORKING days against the
//   jurisdiction's calendar, because "seven days" that lands on a weekend is
//   not seven working days. The working week is read from
//   BusinessCalendar.weekendMask (the Gulf mask is [5, 6], Friday+Saturday) and
//   is never hardcoded (CLAUDE.md rule 9).
//
//   A FILING DUE DATE is plain CALENDAR arithmetic: periodEnd +
//   Regime.deadlineDays, then rolled forward off a closed day. UAE VAT's 28 days
//   read as business days would land about twelve days late, which is a filing
//   penalty. Ahmed's decision, 2026-08-14, matching legacy lib/tax.ts:35 and
//   lib/vat.ts:44. A due date CAN fall on a Friday; the monitor surfaces that
//   (`isWorkingDay` is false for it) rather than shifting the statutory date.
//
// Do not unify the two.

/** One jurisdiction's working week and holidays, as the Kernel holds them. */
export interface BusinessCalendar {
  jurisdictionId: string;
  /** Non-working weekdays, 0 = Sunday … 6 = Saturday. The Gulf mask is [5, 6]. */
  weekendMask: readonly number[];
  /** Public holidays, as civil dates. */
  holidays: readonly Date[];
}

/**
 * How this module reaches a calendar. The Kernel owns BusinessCalendar, so the
 * deadline monitor never queries that table (CLAUDE.md rule 1) — it is handed
 * the calendar through this port, which the kernel module's public interface
 * implements. Returning null means "no calendar", which is an error here, not a
 * default: see MissingBusinessCalendarError.
 */
export interface CalendarSource {
  forJurisdiction(jurisdictionId: string): Promise<BusinessCalendar | null>;
}

/**
 * Thrown when a jurisdiction has no BusinessCalendar. Failing loudly is the
 * point: a silent Saturday-Sunday fallback would measure a Gulf deadline
 * against the wrong week and report the wrong number of days remaining, which
 * is the exact defect CLAUDE.md rule 9 exists to prevent. During a sweep this
 * aborts the run before anything is reported — see runDeadlineSweep for why a
 * partial report would be worse than no report.
 */
export class MissingBusinessCalendarError extends Error {
  readonly jurisdictionId: string;

  constructor(jurisdictionId: string) {
    super(
      `No BusinessCalendar for jurisdiction ${jurisdictionId}. Deadline distance cannot be measured ` +
        `without that jurisdiction's working week, and this module will not fall back to Saturday-Sunday.`,
    );
    this.name = "MissingBusinessCalendarError";
    this.jurisdictionId = jurisdictionId;
  }
}

/** Asserts a calendar was found, naming the jurisdiction when it was not. */
export function requireCalendar(
  jurisdictionId: string,
  calendar: BusinessCalendar | null | undefined,
): BusinessCalendar {
  if (!calendar) throw new MissingBusinessCalendarError(jurisdictionId);
  return calendar;
}

const DAY_MS = 86_400_000;

// The civil date of an instant, as whole days since the epoch. Dates read from
// a `@db.Date` column arrive at UTC midnight, so the UTC calendar day IS the
// civil day; reading local parts would shift the day for anyone running outside
// UTC. This is a day-identity helper, not deadline arithmetic in UTC days —
// which weekdays are working days still comes from the calendar below.
function dayNumber(date: Date): number {
  return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / DAY_MS);
}

// 1970-01-01 was a Thursday, so epoch day 0 is weekday 4.
function weekdayOf(dayNum: number): number {
  return (((dayNum + 4) % 7) + 7) % 7;
}

/** True when the jurisdiction works that day: not a weekend, not a holiday. */
export function isWorkingDay(calendar: BusinessCalendar, date: Date): boolean {
  const day = dayNumber(date);
  if (calendar.weekendMask.includes(weekdayOf(day))) return false;
  return !calendar.holidays.some((holiday) => dayNumber(holiday) === day);
}

/**
 * Working days remaining from `from` until `to`, against this calendar.
 *
 * Counted over the half-open interval (earlier, later], so a deadline due today
 * is 0 and one due on the next working day is 1. Negative when `to` is in the
 * past — an overdue deadline keeps counting, it does not clamp at zero.
 *
 * A due date on a non-working day is naturally more urgent under this
 * definition: the Thursday before a Friday deadline already reads 0, because
 * there are no working days left in which to act.
 */
export function businessDaysUntil(calendar: BusinessCalendar, from: Date, to: Date): number {
  const start = dayNumber(from);
  const end = dayNumber(to);
  const [lo, hi] = start <= end ? [start, end] : [end, start];

  const weekend = new Set(calendar.weekendMask);
  const holidays = new Set(calendar.holidays.map(dayNumber));

  let working = 0;
  for (let day = lo + 1; day <= hi; day++) {
    if (!weekend.has(weekdayOf(day)) && !holidays.has(day)) working++;
  }
  return start <= end ? working : -working;
}

/**
 * The statutory due date: periodEnd + Regime.deadlineDays in plain CALENDAR
 * days, before any adjustment. Takes no calendar, because the statute counts
 * calendar days — UAE VAT is "the 28th day following the end of the tax
 * period" (Federal Decree-Law No. 8 of 2017, Article 64), so a period ending
 * 31 March is 28 April and nothing about the working week enters that sum.
 *
 * This is the date the law names. `filingDueDate` below is the date you must
 * actually file by, which is not always the same one.
 */
export function statutoryDueDate(periodEnd: Date, deadlineDays: number): Date {
  return new Date((dayNumber(periodEnd) + deadlineDays) * DAY_MS);
}

/**
 * The due date to file by: the statutory date, moved to the next working day if
 * it lands on a weekend or a public holiday.
 *
 * Ahmed's decision, 2026-08-14, reversing an earlier reading. The statute fixes
 * the count in calendar days; it does not require filing on a day the portal
 * and the bank are shut. Rolling FORWARD is the safe direction — rolling back
 * would file early against a statutory date that has not arrived, and treating
 * a closed Friday as the deadline would report a filing late that was not.
 *
 * The two functions are kept apart deliberately. `statutoryDueDate` is what the
 * law says and what a differential test compares against legacy; this is what a
 * human must act on. Collapsing them would lose the distinction exactly where
 * someone needs to explain which date they mean.
 */
export function filingDueDate(
  periodEnd: Date,
  deadlineDays: number,
  calendar: BusinessCalendar,
): Date {
  let day = dayNumber(statutoryDueDate(periodEnd, deadlineDays));
  const weekend = new Set(calendar.weekendMask);
  const holidays = new Set(calendar.holidays.map(dayNumber));
  // Bounded: a run of non-working days longer than a fortnight is a calendar
  // someone has mis-entered, and looping forever on it would hang the sweep
  // rather than say so.
  for (let step = 0; step <= 14; step++) {
    if (!weekend.has(weekdayOf(day)) && !holidays.has(day)) return new Date(day * DAY_MS);
    day++;
  }
  throw new Error(
    `${calendar.jurisdictionId}: no working day within 14 days of the statutory due date ` +
      `${statutoryDueDate(periodEnd, deadlineDays).toISOString().slice(0, 10)} — check the ` +
      "weekend mask and holidays for this jurisdiction.",
  );
}
