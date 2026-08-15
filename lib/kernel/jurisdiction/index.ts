// Jurisdiction — the country, and the working week every deadline is measured
// against. Reference data: the kernel says what a jurisdiction IS, never what a
// module does with one (components-kernel.md).
//
// The calendar is first-class here because deadline maths cannot be plain UTC
// arithmetic (CLAUDE.md rule 9). The working week is Sunday-Thursday in the
// Gulf and is not the same list in every country the consultancy operates in,
// so it is a column — nothing in this component names a weekend day.

/** A country. `code` is ISO 3166-1 alpha-2: "AE", "EG", "SA", "KW", "BH". */
export interface Jurisdiction {
  id: string;
  code: string;
  name: string;
}

/**
 * One jurisdiction's working week and its non-working days.
 *
 * The shape matches the `BusinessCalendar` the deadline monitor consumes
 * through its `CalendarSource` port, so `businessCalendarFor` can be handed to
 * it directly — but this file does not import that module. The kernel's
 * dependency arrow only ever points inward: modules depend on the kernel and
 * never the reverse, so the compatibility is structural and deliberate rather
 * than a dependency.
 */
export interface BusinessCalendar {
  jurisdictionId: string;
  /** Non-working weekdays, 0 = Sunday … 6 = Saturday. The Gulf mask is [5, 6]. */
  weekendMask: readonly number[];
  /** Public holidays as civil dates, at UTC midnight — a day, not an instant. */
  holidays: readonly Date[];
  /**
   * The IANA zone whose civil date is "today" here — "Asia/Dubai". Required,
   * with no default: the deadline sweep runs at 02:00, which in the Gulf is
   * 22:00 the previous UTC day, so a run scored against UTC warns a day late.
   */
  timeZone: string;
}

/** A public holiday with the name a human recognises it by. */
export interface BusinessHoliday {
  date: Date;
  name: string;
}

/**
 * True when every entry is a distinct day number. A mask holding 7, or holding
 * Friday twice, is a mis-entered calendar, and the deadline arithmetic it feeds
 * would silently count the wrong number of working days remaining. Checked on
 * write rather than trusted, because the damage shows up as a missed filing
 * weeks later and nowhere near the calendar that caused it.
 *
 * An empty mask is valid: a jurisdiction that works seven days a week states
 * that by having no weekend, and refusing it would be inventing a rule.
 */
export function isWeekendMask(mask: readonly number[]): boolean {
  return (
    mask.every((day) => Number.isInteger(day) && day >= 0 && day <= 6) &&
    new Set(mask).size === mask.length
  );
}

/**
 * True when `zone` is an IANA zone this runtime can actually resolve —
 * "Asia/Dubai", "Africa/Cairo". An empty string is not one.
 *
 * Asked of `Intl` rather than of `Intl.supportedValuesOf("timeZone")`, and
 * deliberately: `civilDateIn` reads a calendar's zone through
 * `Intl.DateTimeFormat`, so this constructs the same thing and lets it accept
 * or throw. `supportedValuesOf` returns only canonical names, so it would
 * reject links and aliases that the reader would then go on to resolve without
 * complaint — a validator stricter than the consumer refuses zones that work.
 *
 * Checked on write for the same reason the weekend mask is: a calendar carrying
 * a zone nothing can read computes no civil date at all, and the throw surfaces
 * in the 02:00 sweep, naming the deadline monitor for a row the kernel accepted
 * hours or weeks earlier.
 */
export function isTimeZone(zone: string): boolean {
  if (zone.trim() === "") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export {
  businessCalendarFor,
  getJurisdiction,
  jurisdictionByCode,
  listHolidays,
  listJurisdictions,
  recordHoliday,
  setBusinessCalendar,
  upsertJurisdiction,
} from "./repository";
