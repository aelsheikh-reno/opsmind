// Assertions 1, 3, 4 and 5 of tasks/backlog.yaml#module-deadlines-civil-date:
//   1. "BusinessCalendar carries the jurisdiction's IANA zone, required and with
//       no default"
//   3. "civilDateIn returns the civil date in the given zone, as a Date at UTC
//       midnight"
//   4. "An instant falling on a different calendar day in the zone than in UTC
//       resolves to the zone's day"
//   5. "An unknown IANA zone throws, naming it, rather than falling back to UTC"
//
// ASSERTION 2 IS NOT IN THIS FILE, DELIBERATELY. "The kernel's BusinessCalendar
// satisfies the deadline monitor's CalendarSource port" is already pinned by
// tests/kernel/kernel-entities.test.ts, "hands the deadline monitor the shape it
// already expects": it reads the port's member list out of lib/modules/deadlines
// and fails when the kernel's calendar is missing any of them. A `timeZone` on
// the port and not on the kernel fails there. Restating it here would give the
// same claim two homes and let one rot green while the other moved.
//
// WHY THIS NODE EXISTS, because it is the shape of every case below.
// operations-scheduling.md:21 schedules the deadline sweep "daily 02:00" and
// states no zone. 02:00 in the Gulf is 22:00 the PREVIOUS UTC day, so a run that
// asks UTC what today is scores every deadline one day early — every threshold
// window shifts by one, and on the last night before a filing the following
// night is already after the deadline. Ahmed, 2026-08-14: the jurisdiction's
// civil date defines today, and the timezone lives on BusinessCalendar beside
// the weekend mask and holidays. CLAUDE.md rule 9 — "Never do deadline
// arithmetic in plain UTC days."
//
// PROVENANCE OF THE EXPECTED VALUES. No file under `lib/modules/deadlines/` or
// `lib/kernel/jurisdiction/` was read by the author of this file, and neither was
// prisma/schema.prisma: a test written after the code describes the code,
// including its bugs. The civil-time facts below (Dubai is UTC+4 all year; Cairo
// keeps +2 in winter and +3 under summer time; New York is behind UTC; Kathmandu
// is +05:45) are properties of the IANA time zone database, which is the
// specification for what a zone's civil date is. They were confirmed against
// that database, never against this build.
//
// The structural claims are read by the TEST PROCESS at run time — the Prisma
// schema through tests/kernel/prisma-schema, the port's declared members through
// the TypeScript compiler API in tests/kernel/kernel-source. Same readers
// tests/modules/deadlines/schema.test.ts and tests/kernel/kernel-entities.test.ts
// already use. Neither reads a function body.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { civilDateIn, type BusinessCalendar } from "@/lib/modules/deadlines";
import {
  SCHEMA_PATH,
  fieldNamed,
  hasAttribute,
  loadSchema,
  locate,
  type PrismaBlock,
  type PrismaField,
} from "@/tests/kernel/prisma-schema";
import { REPO_ROOT, exportedTypeBlocks, type TypeBlock } from "@/tests/kernel/kernel-source";
import { GULF, ymd } from "./surface";

// ------------------------------------------------------------------ values --

/** An instant. Always written with an explicit `Z`, so the case is about the zone. */
function at(iso: string): Date {
  if (!/Z$/.test(iso)) throw new Error(`${iso} is not an absolute instant — write it with a Z`);
  return new Date(iso);
}

/** A regex that matches a zone name literally, `/` and `+` included. */
const naming = (zone: string): RegExp => new RegExp(zone.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"));

/**
 * The civil day a zone is on at an instant, `YYYY-MM-DD`, read out of the IANA
 * database through the platform's copy of it.
 *
 * Used ONLY by the property test at the end, and it is worth saying what it does
 * and does not prove. It is not this build's arithmetic reimplemented: what a
 * zone's civil date is at an instant is not a thing this build gets to decide,
 * it is a fact the IANA database states, and `Intl` is where Node keeps that
 * database. Agreement with it means the zone was consulted. A UTC default, a
 * fixed offset table, a `getDay()` on the runner's own clock, or an offset
 * applied in the wrong direction all disagree with it, and those are the four
 * ways this goes wrong. The hand-written cases above it stand on their own.
 *
 * Assembled from parts rather than formatted with a locale, so the answer does
 * not depend on which locale data the runner shipped.
 */
function ianaCivilDay(timeZone: string, instant: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const part = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year").padStart(4, "0")}-${part("month")}-${part("day")}`;
}

// ---------------------------------------------------------------------------
// Assertion 1 — the zone is a column on the calendar, required, with no default.
// ---------------------------------------------------------------------------

describe("BusinessCalendar carries the jurisdiction's IANA zone", () => {
  const schema = loadSchema();

  /**
   * The calendar model: whichever model carries the weekend mask. Found by the
   * mask rather than by name because the assertion is about where the zone
   * lives — "beside the weekend mask and holidays" (the node, quoting Ahmed
   * 2026-08-14) — and naming the model would make this test pass a schema that
   * put the zone on a `BusinessCalendar` while the mask sat somewhere else.
   */
  function calendarModel(): PrismaBlock {
    const found = schema.models.find((model) => fieldNamed(model, "weekendMask") !== undefined);
    if (found === undefined) {
      throw new Error(
        `no model in ${SCHEMA_PATH} carries weekendMask, so there is no business calendar to ` +
          `put a zone on. Models: ${schema.models.map((m) => m.name).join(", ")}`,
      );
    }
    return found;
  }

  /** The zone column, however it is spelled. Fails loudly, listing what is there. */
  function zoneField(): PrismaField {
    const model = calendarModel();
    const found = model.fields.find((field) => /^(time.?zone|iana.?zone|tz)$/i.test(field.name));
    if (found === undefined) {
      throw new Error(
        `${model.name} carries no timezone column. Fields: ${model.fields
          .map((field) => field.name)
          .join(", ")}. Without one the 02:00 sweep has no zone to ask and falls back to UTC, ` +
          "which in the Gulf is the previous day.",
      );
    }
    return found;
  }

  it("sits on the same model as the weekend mask and the holidays", () => {
    // "Jurisdiction is identity, BusinessCalendar is the civil-time rules"
    // (tasks/backlog.yaml#module-deadlines-civil-date). The mask, the holidays
    // and the zone are one answer to one question — what does a working day mean
    // here — and splitting them lets a jurisdiction have a calendar with no zone.
    const model = calendarModel();
    expect(model.fields.map((field) => field.name)).toEqual(
      expect.arrayContaining(["weekendMask", "holidays", zoneField().name]),
    );
  });

  it("holds an IANA zone name, which is a string", () => {
    // "Asia/Dubai", not an offset. An offset cannot express Cairo, which is +2
    // for part of the year and +3 for the rest; an Int column of hours is the
    // same bug with a different type, and it is wrong for +05:45 zones besides.
    const zone = zoneField();
    expect(zone.type, locate(calendarModel(), zone)).toBe("String");
    expect(zone.list, "a calendar is in one zone").toBe(false);
  });

  it("is required — a calendar cannot exist without saying what today means there", () => {
    // The assertion, first half. An optional column is the UTC fallback wearing a
    // different hat: every reader has to invent a zone when the column is null,
    // and the invented one is UTC. data-model.md:226 settles the analogous case
    // for the mask — "a jurisdiction with no calendar is an error, never a
    // Saturday-Sunday fallback" — and the zone is the same kind of fact.
    const zone = zoneField();
    expect(zone.optional, `${locate(calendarModel(), zone)} is nullable`).toBe(false);
  });

  it("carries no default, so no row can quietly be in the wrong zone", () => {
    // The assertion, second half, and the defect named in the node: "a UTC
    // default warns a day late". A default is worse than a null — a null at
    // least announces itself at the read, while a defaulted row looks like a
    // deliberately configured calendar and is silently a day out. That holds for
    // `@default("UTC")` and equally for `@default("Asia/Dubai")`: Egypt is not
    // the UAE, and five countries share this table.
    const zone = zoneField();
    expect(
      hasAttribute(zone, "default"),
      `${locate(calendarModel(), zone)} — a defaulted zone is a guess that reads as a decision`,
    ).toBe(false);
  });
});

describe("the deadline monitor's calendar port declares the zone too", () => {
  // Rule 4 — "A module's public surface is its `index.ts`" — makes the exported
  // `BusinessCalendar` the contract every caller and the kernel are held to. A
  // column that the port does not declare cannot be read by the sweep, and an
  // OPTIONAL member on the port re-opens the fallback the schema just closed:
  // `cal.timeZone ?? "UTC"` type-checks the moment the member can be absent.

  /** The exported `BusinessCalendar` block, wherever in the module it is declared. */
  function port(): TypeBlock {
    const dir = path.join(REPO_ROOT, "lib", "modules", "deadlines");
    const files = readdirSync(dir).filter((name) => name.endsWith(".ts"));
    expect(files.length, `no TypeScript under ${dir}`).toBeGreaterThan(0);
    const blocks = files.flatMap((name) => {
      const file = path.join(dir, name);
      return exportedTypeBlocks({
        path: file,
        relative: path.relative(REPO_ROOT, file),
        module: "deadlines",
        name,
        source: readFileSync(file, "utf8"),
      });
    });
    const found = blocks.find((block) => block.name === "BusinessCalendar");
    if (found === undefined) {
      throw new Error(
        `lib/modules/deadlines declares no exported BusinessCalendar. Exported types: ${
          blocks.map((block) => block.name).join(", ") || "none"
        }`,
      );
    }
    return found;
  }

  const zoneMember = () => {
    const found = port().members.find((member) => /^(time.?zone|iana.?zone|tz)$/i.test(member.name));
    if (found === undefined) {
      throw new Error(
        `BusinessCalendar declares no zone. Members: ${port()
          .members.map((member) => member.name)
          .join(", ")}`,
      );
    }
    return found;
  };

  it("declares the zone as a required string", () => {
    const zone = zoneMember();
    expect(zone.type, `${zone.name} is declared \`${zone.type}\``).toMatch(/\bstring\b/);
    expect(zone.optional, `${zone.name} is optional on the port`).toBe(false);
    expect(
      /\bnull\b|\bundefined\b/.test(zone.type),
      `${zone.name} is \`${zone.type}\` — an absent zone is the UTC fallback by another route`,
    ).toBe(false);
  });

  it("will not type-check a calendar built without a zone", () => {
    // The same claim as the line above, made the way a caller would meet it. If
    // the member ever becomes optional this line stops being an error and tsc
    // fails on the unused expectation, so the claim cannot rot green.
    // @ts-expect-error a BusinessCalendar with no zone must not compile
    const withoutZone: BusinessCalendar = { jurisdictionId: "AE", weekendMask: [...GULF], holidays: [] };
    expect(withoutZone.jurisdictionId).toBe("AE");
  });

  it("hands civilDateIn a zone it can actually use", () => {
    // The column and the function are two halves of one answer, and nothing else
    // in this file makes them meet. A calendar as the sweep will hold one, asked
    // the question the sweep asks at 02:00 local.
    const ae: BusinessCalendar = {
      jurisdictionId: "AE",
      weekendMask: [...GULF],
      holidays: [],
      timeZone: "Asia/Dubai",
    };
    expect(ymd(civilDateIn(ae.timeZone, at("2026-08-15T22:00:00Z")))).toBe("2026-08-16");
  });
});

// ---------------------------------------------------------------------------
// Assertion 3 — the shape of the answer: a civil date, at UTC midnight.
// ---------------------------------------------------------------------------

describe("civilDateIn returns a civil date at UTC midnight", () => {
  // data-model.md:19 and tests/modules/deadlines/surface.ts — civil dates in this
  // build are stored at UTC midnight and name a calendar day, which is how
  // Prisma `@db.Date` hands one back. A result carrying an hour is not a civil
  // date: it would sit a different distance from a due date than another result
  // for the same day, and businessDaysUntil would answer differently for two
  // instants on one morning.

  const cases = [
    { zone: "Asia/Dubai", instant: "2026-08-15T22:00:00Z", day: "2026-08-16" },
    { zone: "Asia/Dubai", instant: "2026-08-16T04:00:00Z", day: "2026-08-16" },
    { zone: "Africa/Cairo", instant: "2026-01-15T22:00:00Z", day: "2026-01-16" },
    { zone: "UTC", instant: "2026-08-15T22:00:00Z", day: "2026-08-15" },
    { zone: "America/New_York", instant: "2026-08-15T03:00:00Z", day: "2026-08-14" },
  ] as const;

  it.each(cases)("$zone at $instant is the civil day $day", ({ zone, instant, day }) => {
    expect(ymd(civilDateIn(zone, at(instant)))).toBe(day);
  });

  it.each(cases)("$zone at $instant carries no time of day", ({ zone, instant }) => {
    // Zero on all four, in UTC. `new Date(y, m, d)` — local midnight — passes a
    // getUTCHours check only on a runner that happens to sit at UTC, so this is
    // the assertion that keeps the answer from depending on where CI runs.
    const civil = civilDateIn(zone, at(instant));
    expect(civil).toBeInstanceOf(Date);
    expect(Number.isNaN(civil.getTime()), "an Invalid Date is not a civil date").toBe(false);
    expect(
      [civil.getUTCHours(), civil.getUTCMinutes(), civil.getUTCSeconds(), civil.getUTCMilliseconds()],
      `${civil.toISOString()} is not at UTC midnight`,
    ).toEqual([0, 0, 0, 0]);
    expect(civil.getTime() % 86_400_000, "a civil date is a whole number of UTC days").toBe(0);
  });

  it("agrees with the convention the rest of the module already uses", () => {
    // The point of "at UTC midnight" is that the answer is interchangeable with
    // a date built the way every other fixture and every `@db.Date` column
    // builds one. Compared by time value, not by string, because that is what
    // businessDaysUntil will subtract.
    expect(civilDateIn("Asia/Dubai", at("2026-08-15T22:00:00Z")).getTime()).toBe(
      new Date("2026-08-16T00:00:00Z").getTime(),
    );
  });

  it("returns a new Date and leaves the instant it was given alone", () => {
    // A sweep asks for several jurisdictions' today from one `new Date()`.
    // Mutating it, or handing back the same object, makes the second answer
    // depend on the first — and the bug would only show with more than one
    // jurisdiction configured, which is to say in production.
    const instant = at("2026-08-15T22:00:00Z");
    const before = instant.toISOString();
    const civil = civilDateIn("Asia/Dubai", instant);
    expect(civil).not.toBe(instant);
    expect(instant.toISOString(), "the instant was mutated").toBe(before);
    civil.setUTCFullYear(1999);
    expect(instant.toISOString(), "the result aliases the instant").toBe(before);
  });

  it("answers the same for the same instant, however many times it is asked", () => {
    // The run is "stateless: it recomputes distance from today"
    // (components-core-deadline-monitor.md:13). Two identical questions in one
    // run must not give two answers.
    const instant = at("2026-08-15T22:00:00Z");
    const first = civilDateIn("Asia/Dubai", instant);
    const second = civilDateIn("Asia/Dubai", instant);
    expect(second.getTime()).toBe(first.getTime());
  });
});

// ---------------------------------------------------------------------------
// Assertion 4 — the zone's day, not UTC's. This is the defect.
// ---------------------------------------------------------------------------

describe("an instant on a different day in the zone resolves to the zone's day", () => {
  it("the 02:00 sweep in Dubai is the previous day in UTC, and today is the Dubai day", () => {
    // operations-scheduling.md:21 — "Deadline sweep | daily 02:00". 02:00 in
    // Dubai is 22:00Z the day before. Both halves are asserted: the UTC day is
    // genuinely the 15th, so the case is not vacuous, and the answer is the 16th.
    const sweep = at("2026-08-15T22:00:00Z");
    expect(sweep.toISOString().slice(0, 10), "the instant is the 15th in UTC").toBe("2026-08-15");
    expect(ymd(civilDateIn("Asia/Dubai", sweep))).toBe("2026-08-16");
  });

  it("the same instant is two different days in Dubai and in UTC", () => {
    // The defect in one line. If these two ever agree, the zone is not being
    // read, and every threshold window in the Gulf is off by one day.
    const sweep = at("2026-08-15T22:00:00Z");
    expect(ymd(civilDateIn("Asia/Dubai", sweep))).not.toBe(ymd(civilDateIn("UTC", sweep)));
    expect(ymd(civilDateIn("UTC", sweep))).toBe("2026-08-15");
  });

  it("all five countries are ahead of UTC at 02:00 local, not one of them behind", () => {
    // Kuwait, Bahrain and Riyadh are +3, Dubai +4, Cairo +2 or +3. The sweep hour
    // is inside the window where UTC is still on yesterday for every one of them,
    // which is why this is a five-country defect and not a UAE one.
    const zones = ["Asia/Dubai", "Asia/Riyadh", "Asia/Kuwait", "Asia/Bahrain", "Africa/Cairo"];
    const sweep = at("2026-08-15T22:00:00Z");
    for (const zone of zones) {
      expect(ymd(civilDateIn(zone, sweep)), `${zone} at 22:00Z`).toBe("2026-08-16");
    }
  });

  it("rolls at the zone's midnight, not one millisecond earlier or later", () => {
    // The boundary, both sides. Dubai is +4, so its midnight is 20:00Z. The first
    // instant of a civil day belongs to that day; the last millisecond of the day
    // before does not. An off-by-one here is a whole day of deadlines.
    expect(ymd(civilDateIn("Asia/Dubai", at("2026-08-15T19:59:59.999Z")))).toBe("2026-08-15");
    expect(ymd(civilDateIn("Asia/Dubai", at("2026-08-15T20:00:00.000Z")))).toBe("2026-08-16");
  });

  it("resolves to the PREVIOUS day in a zone behind UTC", () => {
    // Both directions, so the arithmetic cannot be "add the offset" with a sign
    // nobody checked. 03:00Z is 23:00 the evening before in New York. No
    // jurisdiction here is west of UTC today; a signed offset that only works
    // eastward is a bug waiting for the first one that is.
    const instant = at("2026-08-15T03:00:00Z");
    expect(instant.toISOString().slice(0, 10), "the instant is the 15th in UTC").toBe("2026-08-15");
    expect(ymd(civilDateIn("America/New_York", instant))).toBe("2026-08-14");
  });

  it("reads Cairo's summer time, so the same UTC time of day lands on two different days", () => {
    // Egypt observes summer time; the Gulf states do not. At 21:30Z Cairo is on
    // the 16th in July (+03) and still on the 15th in January (+02). A fixed
    // offset per country — the obvious wrong implementation, and the one an
    // offset column would force — gets one of these two wrong whichever offset
    // it picks.
    expect(ymd(civilDateIn("Africa/Cairo", at("2026-07-15T21:30:00Z")))).toBe("2026-07-16");
    expect(ymd(civilDateIn("Africa/Cairo", at("2026-01-15T21:30:00Z")))).toBe("2026-01-15");
  });

  it("puts Cairo and Dubai on different days at the same instant, in winter", () => {
    // 22:30Z: Dubai (+4) is on the 16th, Cairo (+2) is still on the 15th. Two
    // jurisdictions, one sweep, two answers — which is the reason the zone is a
    // column on the calendar rather than a constant in the sweep.
    const instant = at("2026-01-15T22:30:00Z");
    expect(ymd(civilDateIn("Asia/Dubai", instant))).toBe("2026-01-16");
    expect(ymd(civilDateIn("Africa/Cairo", instant))).toBe("2026-01-16");
    const earlier = at("2026-01-15T21:00:00Z");
    expect(ymd(civilDateIn("Asia/Dubai", earlier))).toBe("2026-01-16");
    expect(ymd(civilDateIn("Africa/Cairo", earlier))).toBe("2026-01-15");
  });

  it("handles a zone whose offset is not a whole number of hours", () => {
    // Kathmandu is +05:45. An implementation carrying offsets in whole hours
    // answers the 15th for the first of these. No jurisdiction here is on a
    // 45-minute offset, but the arithmetic must not assume none ever is.
    expect(ymd(civilDateIn("Asia/Kathmandu", at("2026-08-15T18:15:00Z")))).toBe("2026-08-16");
    expect(ymd(civilDateIn("Asia/Kathmandu", at("2026-08-15T18:14:59.999Z")))).toBe("2026-08-15");
  });

  it.each([
    { instant: "2026-02-28T20:00:00Z", day: "2026-03-01", why: "the end of a short month" },
    { instant: "2028-02-28T20:00:00Z", day: "2028-02-29", why: "into a leap day" },
    { instant: "2026-12-31T20:00:00Z", day: "2027-01-01", why: "across the year boundary" },
  ])("carries the roll into the next day past $why", ({ instant, day }) => {
    // Dubai's midnight is 20:00Z, so each of these crosses a month, a year or a
    // leap day at the same time as it crosses midnight. Adding four hours to a
    // date and then taking its UTC parts gets these right; adding one to a day
    // number does not.
    expect(ymd(civilDateIn("Asia/Dubai", at(instant)))).toBe(day);
  });

  it("never lands more than one day from the UTC day, for any zone", () => {
    // The invariant that holds for every zone in the database: IANA offsets run
    // from -12:00 to +14:00, so the civil day is the UTC day, the one before, or
    // the one after — never further. A result two days out is an offset applied
    // twice, or applied in milliseconds where hours were meant.
    const zones = [
      "Asia/Dubai",
      "Africa/Cairo",
      "Asia/Riyadh",
      "Pacific/Kiritimati",
      "Etc/GMT+12",
      "UTC",
    ];
    const instants = [
      "2026-08-15T00:00:00Z",
      "2026-08-15T11:00:00Z",
      "2026-08-15T20:00:00Z",
      "2026-08-15T23:59:59.999Z",
      "2026-03-01T10:30:00Z",
    ];
    for (const zone of zones) {
      for (const iso of instants) {
        const instant = at(iso);
        const utcDay = new Date(`${instant.toISOString().slice(0, 10)}T00:00:00Z`);
        const drift = civilDateIn(zone, instant).getTime() - utcDay.getTime();
        expect(Math.abs(drift), `${zone} at ${iso} is ${drift / 86_400_000} days from the UTC day`)
          .toBeLessThanOrEqual(86_400_000);
      }
    }
  });

  it("never goes backwards as the clock moves forward, in the zones this build serves", () => {
    // Later instant, same or later civil day. Restricted to the five Gulf zones
    // on purpose: they keep one offset all year, so the property is absolute
    // there. It is NOT claimed for every zone — a jurisdiction whose summer time
    // ends at midnight genuinely repeats a civil day, and asserting otherwise
    // would be asserting something false about the world. Cairo ends its summer
    // time at 24:00 local, which falls back to 23:00 the same day and so does not
    // repeat a date, but that is a fact about one year's rule rather than a
    // property, so it is left out.
    const zones = ["Asia/Dubai", "Asia/Riyadh", "Asia/Kuwait", "Asia/Bahrain", "Asia/Qatar"];
    for (const zone of zones) {
      let previous = -Infinity;
      for (let hour = 0; hour < 24 * 8; hour += 1) {
        const instant = new Date(Date.parse("2026-08-15T00:00:00Z") + hour * 3_600_000);
        const day = civilDateIn(zone, instant).getTime();
        expect(day, `${zone} went backwards at ${instant.toISOString()}`).toBeGreaterThanOrEqual(
          previous,
        );
        previous = day;
      }
    }
  });

  it("agrees with the IANA database across zones, seasons and times of day", () => {
    // A property rather than another example: 600 instant-and-zone pairs against
    // the database that defines the answer. See ianaCivilDay above for what this
    // does and does not prove. Deterministic seed, so a failure is reproducible;
    // xorshift32 because the classic multiply-and-modulo generator degenerates
    // in JavaScript past 2^53 (kernel-entities.test.ts hit exactly that).
    const zones = [
      "Asia/Dubai",
      "Africa/Cairo",
      "Asia/Riyadh",
      "Asia/Kuwait",
      "Asia/Bahrain",
      "Europe/London",
      "America/New_York",
      "Asia/Kathmandu",
      "Pacific/Kiritimati",
      "Etc/GMT+12",
    ];
    let seed = 20260815 >>> 0;
    const random = (bound: number): number => {
      seed ^= seed << 13;
      seed >>>= 0;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      seed >>>= 0;
      return seed % bound;
    };
    // Three years from 2025-01-01, to the minute, so every season and both sides
    // of every transition in that window get sampled.
    const start = Date.parse("2025-01-01T00:00:00Z");
    const minutes = 3 * 365 * 24 * 60;
    let differed = 0;
    for (let trial = 0; trial < 600; trial += 1) {
      const zone = zones[random(zones.length)];
      const instant = new Date(start + random(minutes) * 60_000);
      const expected = ianaCivilDay(zone, instant);
      expect(ymd(civilDateIn(zone, instant)), `${zone} at ${instant.toISOString()}`).toBe(expected);
      if (expected !== instant.toISOString().slice(0, 10)) differed += 1;
    }
    // Without this the whole property could be satisfied by returning the UTC
    // day, if every sampled instant happened to fall mid-UTC-day. It does not,
    // but a test that could pass that way proves nothing about assertion 4.
    expect(differed, "no sampled instant fell on a different day in its zone than in UTC")
      .toBeGreaterThan(20);
  });
});

// ---------------------------------------------------------------------------
// Assertion 5 — an unknown zone is an error, not a fallback.
// ---------------------------------------------------------------------------

describe("an unknown IANA zone throws, naming it", () => {
  // Rule 8 — "Never guess when confidence is low." A zone the database does not
  // know is mis-entered data, and the guess available is UTC, which is the exact
  // wrong answer this node exists to remove. Same shape as
  // tests/modules/deadlines/calendar.test.ts on a jurisdiction with no calendar:
  // refuse, and name the offender so the row can be found.
  //
  // The message is asserted to CONTAIN the zone and nothing more. The wording of
  // a RangeError from Intl is a Node version detail, and pinning it would break
  // on an upgrade for no gain.

  const instant = at("2026-08-15T22:00:00Z");

  it.each([
    { zone: "Mars/Olympus_Mons", why: "a zone that does not exist" },
    { zone: "Asia/Dubay", why: "a typo in a real zone" },
    { zone: "Gulf Standard Time", why: "a Windows zone name, which is not IANA" },
    { zone: "UTC+4", why: "an offset written as a zone" },
    { zone: "Dubai", why: "a city with no region" },
  ])("refuses $zone and says so ($why)", ({ zone }) => {
    expect(() => civilDateIn(zone, instant)).toThrow(naming(zone));
  });

  it("refuses an empty zone", () => {
    // A blank column, or a string trimmed to nothing on the way in. There is no
    // name to quote back, so this asserts only the refusal.
    expect(() => civilDateIn("", instant)).toThrow();
  });

  it("does not fall back to UTC", () => {
    // Belt and braces, the same way calendar.test.ts guards the missing-calendar
    // fallback: if the call ever stops throwing, whatever comes back must be
    // reported rather than quietly accepted. A returned 2026-08-15 here is the
    // defect — the Dubai answer is the 16th, and the sweep would warn a day late
    // with nothing on the surface to show it.
    let fallback: unknown;
    try {
      fallback = civilDateIn("Mars/Olympus_Mons", instant);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(String((error as Error).message)).toMatch(naming("Mars/Olympus_Mons"));
      return;
    }
    expect.fail(
      `returned ${
        fallback instanceof Date ? fallback.toISOString() : JSON.stringify(fallback)
      } for an unknown zone instead of refusing it`,
    );
  });

  it("still answers for zones that are real, so the check is not simply refusing everything", () => {
    // The other side of the boundary. A guard written too wide — rejecting
    // anything not on a hard-coded list of five — takes the product out with it.
    for (const zone of ["Asia/Dubai", "Africa/Cairo", "Asia/Riyadh", "Asia/Kuwait", "Asia/Bahrain", "UTC"]) {
      expect(() => civilDateIn(zone, instant), `${zone} is a real zone`).not.toThrow();
    }
  });
});
