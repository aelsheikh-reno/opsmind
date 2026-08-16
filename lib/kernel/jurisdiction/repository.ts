// owns: Jurisdiction, BusinessCalendar, BusinessHoliday
//
// The calendar and its holidays are this component's tables, not a module's:
// the deadline monitor reads them through the interface above rather than
// joining into them (CLAUDE.md rule 1, ADR-021).
import type { Jurisdiction as JurisdictionRow } from "@prisma/client";
import { db } from "@/lib/db";
import type { BusinessCalendar, BusinessHoliday, Jurisdiction } from "./index";
import { isFixedOffsetZone, isTimeZone, isWeekendMask } from "./index";

const toJurisdiction = ({ id, code, name }: JurisdictionRow): Jurisdiction => ({ id, code, name });

const toCalendar = (row: {
  jurisdictionId: string;
  weekendMask: number[];
  timeZone: string;
  holidays: { date: Date }[];
}): BusinessCalendar => ({
  jurisdictionId: row.jurisdictionId,
  weekendMask: row.weekendMask,
  holidays: row.holidays.map((holiday) => holiday.date),
  timeZone: row.timeZone,
});

export async function getJurisdiction(id: string): Promise<Jurisdiction | null> {
  const row = await db.jurisdiction.findUnique({ where: { id } });
  return row && toJurisdiction(row);
}

export async function jurisdictionByCode(code: string): Promise<Jurisdiction | null> {
  const row = await db.jurisdiction.findUnique({ where: { code } });
  return row && toJurisdiction(row);
}

export async function listJurisdictions(): Promise<Jurisdiction[]> {
  const rows = await db.jurisdiction.findMany({ orderBy: { code: "asc" } });
  return rows.map(toJurisdiction);
}

/** Keyed on the ISO code, so seeding the five countries twice is harmless. */
export async function upsertJurisdiction(input: { code: string; name: string }): Promise<Jurisdiction> {
  const row = await db.jurisdiction.upsert({
    where: { code: input.code },
    create: input,
    update: { name: input.name },
  });
  return toJurisdiction(row);
}

/**
 * The jurisdiction's working week and holidays, or null when it has none.
 *
 * Null is an answer, not a default: the caller decides what a missing calendar
 * means, and the deadline monitor treats it as an error precisely so that no
 * Gulf deadline is ever measured against a Saturday-Sunday week nobody works.
 */
export async function businessCalendarFor(jurisdictionId: string): Promise<BusinessCalendar | null> {
  const row = await db.businessCalendar.findUnique({
    where: { jurisdictionId },
    include: { holidays: true },
  });
  return row && toCalendar(row);
}

// The civil zone of each jurisdiction this build serves, keyed on ISO 3166-1
// alpha-2 — the same five countries, and the same map, that the backfill in
// prisma/migrations/20260815090000_deadline_calendar_timezone states in full.
//
// It is the text of an error message and nothing else. Nothing reads it to fill
// the column: it is not exported, no default is derived from it, and a calendar
// still carries only the zone somebody chose for it. That distinction is the
// entire reason the column has no default — a suggestion an administrator has
// to accept is a decision; one applied on their behalf is the defect.
const CIVIL_ZONE_BY_CODE: Record<string, string> = {
  AE: "Asia/Dubai",
  EG: "Africa/Cairo",
  SA: "Asia/Riyadh",
  KW: "Asia/Kuwait",
  BH: "Asia/Bahrain",
};

/**
 * What to type instead, for this jurisdiction. A refusal that does not say gets
 * worked around, and the way it gets worked around is UTC.
 *
 * Names the one zone when the jurisdiction is one of the five and its row can be
 * read. FOR ANYTHING ELSE — a sixth country, an id with no row, a database that
 * does not answer — it names the whole register and says the zone has to be
 * chosen for that country. Inventing a zone for a jurisdiction nobody has
 * mapped is the guess CLAUDE.md rule 8 forbids: a neighbour's zone looks
 * configured, reads without complaint, and computes every deadline in that
 * country on the wrong civil day. The migration aborts on an unmapped code for
 * the same reason; this is the same refusal in the same words.
 *
 * The read is best-effort by design. The refusal has already been decided from
 * the value alone, before any query — this only makes it actionable, so a
 * database that is unreachable must not turn "UTC is not a civil zone" into a
 * connection error naming neither.
 */
async function civilZoneAdvice(jurisdictionId: string): Promise<string> {
  // null = there is no such jurisdiction; undefined = the read did not answer.
  // Told apart because an error message that says "no zone is recorded for this
  // country" when the database was simply unreachable sends the reader after the
  // wrong thing.
  const code = await db.jurisdiction
    .findUnique({ where: { id: jurisdictionId }, select: { code: true } })
    .then(
      (row) => row?.code ?? null,
      () => undefined,
    );
  const zone = code == null ? undefined : CIVIL_ZONE_BY_CODE[code];
  if (zone !== undefined) {
    return `${code} keeps civil time in ${zone}, so that is what this calendar should carry.`;
  }
  const register = Object.entries(CIVIL_ZONE_BY_CODE)
    .map(([isoCode, isoZone]) => `${isoCode} ${isoZone}`)
    .join(", ");
  const missing =
    code == null
      ? `No jurisdiction row could be read for ${jurisdictionId}, so this cannot name its zone`
      : `OpsMind has no civil zone recorded for ${code} (jurisdiction ${jurisdictionId})`;
  return (
    `${missing}; the ones it serves are ${register}. Choose that country's own zone ` +
    "deliberately — never a neighbour's, and never UTC."
  );
}

/**
 * Sets the working week and the zone its civil date is read in. Rejects a mask
 * that is not a set of day numbers, a zone `Intl` cannot resolve, and UTC or
 * another fixed offset, which resolve perfectly well and are the civil time of
 * nowhere. `timeZone` is a required argument with no default, for the reason
 * the column has none: a default zone is a UTC-shaped "today" written down once
 * and then trusted.
 *
 * Both zone refusals happen here, where the value enters, rather than in
 * `civilDateIn` where it is read. An unreadable zone throws in the 02:00 sweep
 * against a row accepted weeks earlier; UTC never throws anywhere, and reports
 * a day late for four hours of every day instead.
 */
export async function setBusinessCalendar(
  jurisdictionId: string,
  weekendMask: readonly number[],
  timeZone: string,
): Promise<BusinessCalendar> {
  if (!isWeekendMask(weekendMask)) {
    throw new Error(
      `weekendMask ${JSON.stringify(weekendMask)} is not a set of distinct day numbers 0-6 ` +
        "(0 = Sunday). The Gulf working week is Sunday-Thursday, so its mask is [5, 6].",
    );
  }
  if (isFixedOffsetZone(timeZone)) {
    throw new Error(
      `timeZone ${JSON.stringify(timeZone)} names an offset, not a jurisdiction's civil zone, and ` +
        'a business calendar may not be configured in one ("UTC", "Etc/GMT", "Etc/GMT+4" and the ' +
        'other spellings of the same thing). "Today" on this calendar is the civil date in that ' +
        "country: the deadline sweep fires at 02:00, which in the Gulf is 22:00 the previous UTC " +
        `day, so a calendar read in UTC warns a day late for four hours of every day. ` +
        `${await civilZoneAdvice(jurisdictionId)}`,
    );
  }
  if (!isTimeZone(timeZone)) {
    throw new Error(
      `timeZone ${JSON.stringify(timeZone)} is not an IANA zone this runtime can resolve ` +
        '("Asia/Dubai", "Africa/Cairo"). Rejected here, where the value enters: a stored zone ' +
        "nothing can read throws hours later inside the deadline sweep, which then names the " +
        "monitor for a calendar row this function accepted.",
    );
  }
  const mask = [...weekendMask];
  const row = await db.businessCalendar.upsert({
    where: { jurisdictionId },
    create: { jurisdictionId, weekendMask: mask, timeZone },
    update: { weekendMask: mask, timeZone },
    include: { holidays: true },
  });
  return toCalendar(row);
}

export async function listHolidays(jurisdictionId: string): Promise<BusinessHoliday[]> {
  const rows = await db.businessHoliday.findMany({
    where: { calendar: { jurisdictionId } },
    orderBy: { date: "asc" },
    select: { date: true, name: true },
  });
  return rows;
}

/**
 * Records one public holiday, idempotently — the same day published twice is
 * one row, not two, so re-running an import cannot double a non-working day.
 * A jurisdiction with no calendar throws: a holiday hanging off no working week
 * cannot be interpreted, and creating an empty calendar to hold it would invent
 * a weekend for that country.
 */
export async function recordHoliday(jurisdictionId: string, date: Date, name: string): Promise<void> {
  const calendar = await db.businessCalendar.findUnique({ where: { jurisdictionId } });
  if (!calendar) {
    throw new Error(
      `Jurisdiction ${jurisdictionId} has no business calendar; set its working week before recording holidays.`,
    );
  }
  await db.businessHoliday.upsert({
    where: { calendarId_date: { calendarId: calendar.id, date } },
    create: { calendarId: calendar.id, date, name },
    update: { name },
  });
}
