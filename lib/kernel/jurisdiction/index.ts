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
   * And never UTC itself, nor another fixed offset — `isTimeZone` refuses them,
   * because a zone that names no place is that same defect chosen by hand.
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
 * The zone as this runtime resolves it, or null when it cannot resolve it at
 * all. "Etc/UTC" comes back as "UTC" and "US/Eastern" as "America/New_York":
 * `Intl` folds a link onto the zone it points at, which is what makes a check
 * on the answer worth more than a check on the spelling that was typed.
 *
 * Asked of `Intl` rather than of `Intl.supportedValuesOf("timeZone")`, and
 * deliberately: `civilDateIn` reads a calendar's zone through
 * `Intl.DateTimeFormat`, so this constructs the same thing and lets it accept
 * or throw. `supportedValuesOf` returns only canonical names, so it would
 * reject links and aliases that the reader would then go on to resolve without
 * complaint — a validator stricter than the consumer refuses zones that work.
 */
function canonicalTimeZone(zone: string): string | null {
  if (zone.trim() === "") return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: zone }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/**
 * The IANA names that denote an offset instead of a place: the whole `Etc`
 * area — "Etc/UTC", "Etc/GMT", "Etc/Zulu", "Etc/GMT+5", "Etc/GMT-14" — and the
 * bare spellings that link into it: "UTC", "UCT", "GMT", "GMT0", "GMT+0",
 * "GMT-0", "Universal", "Zulu", "Greenwich". Matched case-insensitively,
 * because `Intl` accepts "utc" and "Etc/UtC" as readily as the canonical form.
 *
 * HOW THE BOUNDARY WAS DECIDED, since a list of spellings one hopes is complete
 * is decoration rather than a rule. IANA names a civil zone after the place
 * whose law it encodes — Asia/Dubai, Africa/Cairo — and collects in a single
 * file, `etcetera`, exactly the entries that name no place: UTC, GMT and the
 * fixed offsets, with the single-word forms in `backward` linking into them. So
 * the predicate is "this name denotes an offset, not a place", which is that
 * file and nothing else. It needs no maintenance when tzdata adds an alias, and
 * it does not have to enumerate the seven ways of writing UTC. Every zone that
 * does name a place sits under a geographic area or links to one, and none of
 * those is matched here.
 */
const NAMES_AN_OFFSET_NOT_A_PLACE = /^(etc\/.*|utc|uct|universal|zulu|greenwich|gmt[+-]?\d*)$/i;

/**
 * True when `zone` resolves but carries no civil rules — UTC, GMT, or one of
 * the `Etc/GMT±N` fixed offsets. Resolvable is not the same as usable on a
 * business calendar; see `isTimeZone` for why these are refused.
 *
 * Exported because the write path needs to tell the two refusals apart: a zone
 * nothing can read and a zone that reads fine but is nobody's civil time are
 * different mistakes and deserve different sentences.
 */
export function isFixedOffsetZone(zone: string): boolean {
  const canonical = canonicalTimeZone(zone);
  if (canonical === null) return false;
  // Both the resolved name and the typed one are tested. This runtime folds
  // "Etc/Zulu" onto "UTC", but the fold is ICU's rather than a guarantee, and an
  // ICU that hands back the name it was given must not turn a refusal into an
  // acceptance. Neither test can catch a real civil zone: no zone naming a place
  // is spelled "GMT+0" or sits under `Etc/`.
  return NAMES_AN_OFFSET_NOT_A_PLACE.test(canonical) || NAMES_AN_OFFSET_NOT_A_PLACE.test(zone.trim());
}

/**
 * True when `zone` is one a business calendar may be configured in: an IANA
 * zone this runtime can resolve — "Asia/Dubai", "Africa/Cairo", and links such
 * as "Asia/Calcutta" or "US/Eastern" — that also names a place. An empty string
 * is not one. Neither is "UTC".
 *
 * WHY UTC IS REFUSED, WHICH IS NOT BECAUSE IT IS NOT A ZONE. This column exists
 * because a jurisdiction's CIVIL date decides what "today" means. The deadline
 * sweep fires at 02:00, which in the Gulf is 22:00 the previous UTC day, so a
 * calendar read in UTC warns a day late for the first four hours of every day —
 * every threshold window shifts by one, and on the last night before a filing
 * the following night is already past it. That is the defect the field was
 * added to prevent, and none of the five jurisdictions OpsMind operates in
 * keeps civil time in UTC. A calendar carrying UTC is therefore never a
 * statement about a country: it is the default the column was given none of,
 * typed in by hand, and invisible from that moment on.
 *
 * The fixed offsets go with it. "Etc/GMT-2" matched Cairo's winter offset and
 * was silently an hour out from the day Egypt reintroduced summer time in 2023,
 * which at 02:00 is a day out — an offset has no rules to follow when a country
 * changes its clocks, and a zone's whole value here is that it does.
 *
 * A zone at UTC+0 today is still accepted when it names a place: Africa/Abidjan
 * and Atlantic/Reykjavik are civil zones of somewhere, and the test is the name
 * denoting a place rather than the offset it happens to hold. This refuses a
 * zone for not being civil, never for its arithmetic.
 *
 * Checked on write, for the same reason the weekend mask is, and the refusal
 * names the zone that jurisdiction actually uses — see `setBusinessCalendar`. A
 * calendar carrying a zone nothing can read computes no civil date at all and
 * throws inside the 02:00 sweep, naming the deadline monitor for a row the
 * kernel accepted hours or weeks earlier; a calendar carrying UTC never throws
 * at all, which is worse.
 */
export function isTimeZone(zone: string): boolean {
  return canonicalTimeZone(zone) !== null && !isFixedOffsetZone(zone);
}

// The civil zone of each jurisdiction this build serves, keyed on ISO 3166-1
// alpha-2 — the same five countries, and the same map, that the backfill in
// prisma/migrations/20260815090000_deadline_calendar_timezone states in full. A
// zone is a decision about a country, so it is written out rather than derived.
const CIVIL_ZONE_BY_CODE: Record<string, string> = {
  AE: "Asia/Dubai",
  EG: "Africa/Cairo",
  SA: "Asia/Riyadh",
  KW: "Asia/Kuwait",
  BH: "Asia/Bahrain",
};

/**
 * What to type instead of an offset, for the jurisdiction with this ISO code —
 * or with `null` when the caller could not name it. A refusal that does not say
 * what to type gets worked around, and the way it gets worked around is UTC.
 *
 * Prose rather than a zone, and deliberately: this is the sentence a refusal
 * ends with, not a lookup. Nothing here may fill the column — it has no default
 * precisely so that the zone is a decision somebody made about a country, and a
 * suggestion an administrator types is that decision while one applied on their
 * behalf is the defect the column exists to prevent. Returning a sentence
 * nobody can store keeps the distinction honest.
 *
 * A CODE OUTSIDE THE FIVE IS NAMED, NEVER GUESSED AT. It gets the register and
 * an instruction to choose that country's zone: inventing a sixth jurisdiction's
 * zone is the guess CLAUDE.md rule 8 forbids, because a neighbour's zone looks
 * configured, reads without complaint, and computes every deadline in that
 * country on the wrong civil day. The backfill migration aborts on an unmapped
 * code for the same reason; this is that refusal in the same words. `null` —
 * no such jurisdiction, or a database that did not answer — gets the register
 * too, so a refusal stays actionable even when nothing can be read.
 */
export function civilZoneAdvice(code: string | null): string {
  const zone = code === null ? undefined : CIVIL_ZONE_BY_CODE[code];
  if (zone !== undefined) {
    return `${code} keeps civil time in ${zone}, so that is what this calendar should carry.`;
  }
  const register = Object.entries(CIVIL_ZONE_BY_CODE)
    .map(([isoCode, isoZone]) => `${isoCode} ${isoZone}`)
    .join(", ");
  const missing =
    code === null
      ? "This jurisdiction could not be named here, so neither can its zone"
      : `OpsMind has no civil zone recorded for ${code}`;
  return (
    `${missing}; the ones it serves are ${register}. Choose that country's own zone ` +
    "deliberately — never a neighbour's, and never UTC."
  );
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
