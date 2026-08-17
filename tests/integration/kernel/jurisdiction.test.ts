// lib/kernel/jurisdiction/repository.ts against a real engine (ADR-038): all
// eight exported functions, the uniqueness the ISO code carries, the orderings
// the file promises, and what a missing row answers.
import { beforeEach, describe, expect, it } from "vitest";
import { integrationDatabase, refusalFrom } from "../support/database";

const db = await integrationDatabase("jurisdiction");
const {
  businessCalendarFor,
  getJurisdiction,
  jurisdictionByCode,
  listHolidays,
  listJurisdictions,
  recordHoliday,
  setBusinessCalendar,
  upsertJurisdiction,
} = await import("@/lib/kernel/jurisdiction");

const day = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

describe("upsertJurisdiction", () => {
  it("creates a jurisdiction and reads it back by id", async () => {
    const created = await upsertJurisdiction({ code: "AE", name: "United Arab Emirates" });
    expect(created).toEqual({ id: expect.any(String), code: "AE", name: "United Arab Emirates" });
    expect(await getJurisdiction(created.id)).toEqual(created);
  });

  it("is keyed on the code, so seeding twice restates one row", async () => {
    const first = await upsertJurisdiction({ code: "EG", name: "Egypt" });
    const second = await upsertJurisdiction({ code: "EG", name: "Arab Republic of Egypt" });
    expect(second.id).toBe(first.id);
    expect(second.name).toBe("Arab Republic of Egypt");
    expect(await listJurisdictions()).toHaveLength(1);
  });

  it("cannot hold two rows for one ISO code", async () => {
    await upsertJurisdiction({ code: "SA", name: "Saudi Arabia" });
    const refusal = await refusalFrom(
      db.jurisdiction.create({ data: { code: "SA", name: "Kingdom of Saudi Arabia" } }),
    );
    expect(refusal).toMatch(/[Uu]nique constraint/);
    expect(await listJurisdictions()).toHaveLength(1);
  });
});

describe("getJurisdiction and jurisdictionByCode", () => {
  it("answer null for an id and a code that name nothing", async () => {
    expect(await getJurisdiction("no-such-jurisdiction")).toBeNull();
    expect(await jurisdictionByCode("ZZ")).toBeNull();
  });

  it("find the same row by id and by code", async () => {
    const created = await upsertJurisdiction({ code: "KW", name: "Kuwait" });
    expect(await jurisdictionByCode("KW")).toEqual(created);
    expect(await getJurisdiction(created.id)).toEqual(created);
  });
});

describe("listJurisdictions", () => {
  it("orders by ISO code ascending, whatever order they arrived in", async () => {
    for (const code of ["SA", "AE", "KW", "BH", "EG"]) {
      await upsertJurisdiction({ code, name: `country ${code}` });
    }
    expect((await listJurisdictions()).map((row) => row.code)).toEqual([
      "AE",
      "BH",
      "EG",
      "KW",
      "SA",
    ]);
  });

  it("is empty rather than an error when nothing is seeded", async () => {
    expect(await listJurisdictions()).toEqual([]);
  });
});

describe("setBusinessCalendar and businessCalendarFor", () => {
  let jurisdictionId = "";

  beforeEach(async () => {
    jurisdictionId = (await upsertJurisdiction({ code: "AE", name: "United Arab Emirates" })).id;
  });

  it("answers null for a jurisdiction that has no calendar", async () => {
    expect(await businessCalendarFor(jurisdictionId)).toBeNull();
  });

  it("stores the Gulf working week and the civil zone it is read in", async () => {
    const calendar = await setBusinessCalendar(jurisdictionId, [5, 6], "Asia/Dubai");
    expect(calendar).toEqual({ jurisdictionId, weekendMask: [5, 6], holidays: [], timeZone: "Asia/Dubai" });
    expect(await businessCalendarFor(jurisdictionId)).toEqual(calendar);
  });

  it("restates the one calendar rather than adding a second", async () => {
    await setBusinessCalendar(jurisdictionId, [5, 6], "Asia/Dubai");
    const changed = await setBusinessCalendar(jurisdictionId, [6], "Asia/Riyadh");
    expect(changed.weekendMask).toEqual([6]);
    expect(changed.timeZone).toBe("Asia/Riyadh");
    expect(await db.businessCalendar.count()).toBe(1);
  });

  it("refuses a mask that is not a set of day numbers, and writes nothing", async () => {
    expect(await refusalFrom(setBusinessCalendar(jurisdictionId, [5, 5], "Asia/Dubai"))).toMatch(
      /not a set of distinct day numbers/,
    );
    expect(await refusalFrom(setBusinessCalendar(jurisdictionId, [7], "Asia/Dubai"))).toMatch(/0-6/);
    expect(await businessCalendarFor(jurisdictionId)).toBeNull();
  });

  it("refuses UTC, and names the zone the jurisdiction actually keeps", async () => {
    // The refusal reaches the database for the ISO code alone, which is the one
    // query any of these make; the verdict was decided from the value.
    expect(await refusalFrom(setBusinessCalendar(jurisdictionId, [5, 6], "UTC"))).toMatch(
      /AE keeps civil time in Asia\/Dubai/,
    );
    expect(await refusalFrom(setBusinessCalendar(jurisdictionId, [5, 6], "Etc/GMT+4"))).toMatch(
      /names an offset, not a civil zone/,
    );
  });

  it("refuses a zone this runtime cannot resolve", async () => {
    expect(await refusalFrom(setBusinessCalendar(jurisdictionId, [5, 6], "Mars/Olympus"))).toMatch(
      /not an IANA zone/,
    );
  });

  it("carries the holidays back with the calendar", async () => {
    await setBusinessCalendar(jurisdictionId, [5, 6], "Asia/Dubai");
    await recordHoliday(jurisdictionId, day("2026-12-02"), "National Day");
    expect((await businessCalendarFor(jurisdictionId))?.holidays).toEqual([day("2026-12-02")]);
  });
});

describe("recordHoliday and listHolidays", () => {
  let jurisdictionId = "";

  beforeEach(async () => {
    jurisdictionId = (await upsertJurisdiction({ code: "AE", name: "United Arab Emirates" })).id;
    await setBusinessCalendar(jurisdictionId, [5, 6], "Asia/Dubai");
  });

  it("orders holidays by date ascending", async () => {
    await recordHoliday(jurisdictionId, day("2026-12-03"), "National Day (second)");
    await recordHoliday(jurisdictionId, day("2026-01-01"), "New Year");
    await recordHoliday(jurisdictionId, day("2026-12-02"), "National Day");
    expect(await listHolidays(jurisdictionId)).toEqual([
      { date: day("2026-01-01"), name: "New Year" },
      { date: day("2026-12-02"), name: "National Day" },
      { date: day("2026-12-03"), name: "National Day (second)" },
    ]);
  });

  it("is idempotent on the day, so a re-imported list cannot double it", async () => {
    await recordHoliday(jurisdictionId, day("2026-12-02"), "Natinal Day");
    await recordHoliday(jurisdictionId, day("2026-12-02"), "National Day");
    expect(await listHolidays(jurisdictionId)).toEqual([
      { date: day("2026-12-02"), name: "National Day" },
    ]);
  });

  it("returns only the jurisdiction asked about", async () => {
    const other = await upsertJurisdiction({ code: "EG", name: "Egypt" });
    await setBusinessCalendar(other.id, [5, 6], "Africa/Cairo");
    await recordHoliday(jurisdictionId, day("2026-12-02"), "National Day");
    await recordHoliday(other.id, day("2026-07-23"), "Revolution Day");
    expect(await listHolidays(other.id)).toEqual([
      { date: day("2026-07-23"), name: "Revolution Day" },
    ]);
  });

  it("refuses a holiday on a jurisdiction with no calendar, rather than inventing a week", async () => {
    const egypt = await upsertJurisdiction({ code: "EG", name: "Egypt" });
    expect(await refusalFrom(recordHoliday(egypt.id, day("2026-07-23"), "Revolution Day"))).toMatch(
      /has no business calendar/,
    );
    expect(await listHolidays(egypt.id)).toEqual([]);
  });
});
