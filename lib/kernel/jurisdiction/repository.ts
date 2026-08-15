// owns: Jurisdiction, BusinessCalendar, BusinessHoliday
//
// The calendar and its holidays are this component's tables, not a module's:
// the deadline monitor reads them through the interface above rather than
// joining into them (CLAUDE.md rule 1, ADR-021).
import type { Jurisdiction as JurisdictionRow } from "@prisma/client";
import { db } from "@/lib/db";
import type { BusinessCalendar, BusinessHoliday, Jurisdiction } from "./index";
import { isWeekendMask } from "./index";

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

/**
 * Sets the working week and the zone its civil date is read in. Rejects a mask
 * that is not a set of day numbers. `timeZone` is a required argument with no
 * default, for the reason the column has none: a default zone is a UTC-shaped
 * "today" written down once and then trusted.
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
