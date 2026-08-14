// Assertions 1-3 of tasks/backlog.yaml#module-deadlines:
//   1. "Business-day arithmetic uses the Sunday-Thursday Gulf week"
//   2. "A jurisdiction with no BusinessCalendar is an error, never a
//       Saturday-Sunday fallback"
//   3. "A filing due date is periodEnd + Regime.deadlineDays in calendar days,
//       never rolled off a weekend"
//
// The asymmetry between 1 and 3 is the whole point of this file: distance is
// measured in BUSINESS days, the due date itself is CALENDAR arithmetic. The
// last describe block would fail if someone unified them.
//
// Counting convention, stated because an off-by-one here is the defect: the
// distance from `from` to `to` is the number of working days in (from, to] —
// today does not count, the target does. It is forced by the mask being data:
// with an empty weekend mask (a genuine seven-day week) the distance must equal
// the plain calendar difference, which legacy computes as
// `Math.round((d - now) / 86_400_000)` (expiry-reminders/route.ts:10-16).
import { describe, expect, it, vi } from "vitest";
import { generateVatPeriods } from "@/reference/legacy/lib/vat";
import { isWorkingDay, requireCalendar } from "@/lib/modules/deadlines";
import { GULF, WESTERN, businessDays, calendar, calendarFor, d, filingDue, statutoryDue, ymd } from "./surface";

// August 2026, the reference week:
//   Sun 16 · Mon 17 · Tue 18 · Wed 19 · Thu 20 · Fri 21 · Sat 22 · Sun 23 ·
//   Mon 24 · Tue 25 · … · Thu 27 · Fri 28 · Sat 29 · Sun 30 · Mon 31 · Tue Sep 1
const AE = (holidays: string[] = []) => calendar("AE", GULF, holidays);

describe("business-day distance · the Sunday-Thursday Gulf week", () => {
  // components-core-deadline-monitor.md:13 — "Distance is measured in business
  // days against the jurisdiction's calendar — Sunday to Thursday in the Gulf —
  // because 'seven days' that lands on a weekend is not seven working days."
  it.each([
    { from: "2026-08-16", to: "2026-08-20", expected: 4, why: "Sun to Thu — Mon,Tue,Wed,Thu" },
    { from: "2026-08-16", to: "2026-08-23", expected: 5, why: "a full week, less Fri 21 and Sat 22" },
    { from: "2026-08-20", to: "2026-08-23", expected: 1, why: "Thu to Sun is 3 calendar days, 1 working" },
    { from: "2026-08-20", to: "2026-08-22", expected: 0, why: "a Saturday due date is 0 working days off" },
    { from: "2026-08-16", to: "2026-09-01", expected: 12, why: "16 days less Fri/Sat 21,22,28,29" },
    { from: "2026-08-16", to: "2026-08-16", expected: 0, why: "today is not a day remaining" },
  ])("$from to $to is $expected business days ($why)", ({ from, to, expected }) => {
    expect(businessDays(d(from), d(to), AE())).toBe(expected);
  });

  it("counts a date already past as negative, so an expired document stays visible", () => {
    // Legacy daysUntil returns a negative number for a past date
    // (expiry-reminders/route.ts:10-16) and the item is still reported. An
    // expired visa stops an engineer working (spec:7); it must not fall out of
    // the arithmetic by going unsigned or clamping at zero.
    expect(businessDays(d("2026-08-23"), d("2026-08-16"), AE())).toBe(-5);
  });

  it("is antisymmetric, for every pair", () => {
    const days = ["2026-08-16", "2026-08-19", "2026-08-21", "2026-08-22", "2026-09-01"];
    for (const from of days) {
      for (const to of days) {
        // Summed rather than negated: Object.is(0, -0) is false, and a pair of
        // identical dates would fail on the sign of zero rather than on anything real.
        expect(businessDays(d(from), d(to), AE()) + businessDays(d(to), d(from), AE())).toBe(0);
      }
    }
  });
});

describe("the weekend is data on the calendar, not a constant in the code", () => {
  // prisma BusinessCalendar.weekendMask — "Non-working weekdays, encoded as day
  // numbers where 0 = Sunday and 6 = Saturday... No default: a calendar states
  // its own week." Changing the mask must change the answer; that is what
  // proves the arithmetic reads the row.
  const WED_TO_FRI = [d("2026-08-19"), d("2026-08-20"), d("2026-08-21")] as const;

  it("the same span answers differently under a Gulf and a Saturday-Sunday week", () => {
    // Wed 19 -> Fri 21. Gulf: Thu 20 only. Sat-Sun week: Thu 20 and Fri 21.
    const gulf = businessDays(WED_TO_FRI[0], WED_TO_FRI[2], calendar("AE", GULF));
    const western = businessDays(WED_TO_FRI[0], WED_TO_FRI[2], calendar("GB", WESTERN));
    expect(gulf).toBe(1);
    expect(western).toBe(2);
    expect(gulf).not.toBe(western);
  });

  it("a calendar with no weekend at all counts plain calendar days", () => {
    // The definitional check on the mask: an empty mask is a seven-day week, so
    // the business-day distance collapses onto the calendar difference.
    expect(businessDays(d("2026-08-16"), d("2026-08-23"), calendar("XX", []))).toBe(7);
    expect(businessDays(d("2026-08-19"), d("2026-08-21"), calendar("XX", []))).toBe(2);
  });

  it("skips a public holiday from the jurisdiction's own calendar", () => {
    // spec, Owns table:21 — "Sunday-Thursday weeks, per-country holidays from
    // the Jurisdiction calendar". Tue 18 Aug is a holiday in AE only.
    expect(businessDays(d("2026-08-16"), d("2026-08-20"), AE(["2026-08-18"]))).toBe(3);
    expect(businessDays(d("2026-08-16"), d("2026-08-20"), calendar("EG", GULF))).toBe(4);
  });

  it("does not count a holiday that falls on a weekend day twice", () => {
    // Fri 21 is already a non-working day under the Gulf mask; declaring it a
    // holiday as well must not remove a second day from the count.
    expect(businessDays(d("2026-08-16"), d("2026-08-23"), AE(["2026-08-21"]))).toBe(5);
  });

  it("skips several holidays in one span", () => {
    expect(businessDays(d("2026-08-16"), d("2026-08-23"), AE(["2026-08-17", "2026-08-20"]))).toBe(3);
  });
});

describe("a jurisdiction with no BusinessCalendar is an error", () => {
  // tasks/backlog.yaml#module-deadlines assertion 2, and CLAUDE.md rule 9 —
  // "Never do deadline arithmetic in plain UTC days." A silent fallback here is
  // a Saturday-Sunday week applied to five Gulf countries: every answer wrong
  // by up to two days, with nothing on the surface to show it.
  it.each([
    { jurisdiction: "KW", found: null, why: "no row in the database" },
    { jurisdiction: "BH", found: undefined, why: "the row was never fetched" },
  ])("throws for $jurisdiction, naming it, when $why", ({ jurisdiction, found }) => {
    expect(() => calendarFor(jurisdiction, found)).toThrow(new RegExp(jurisdiction));
  });

  it("does not fall back to a Saturday-Sunday week", () => {
    // Belt and braces: if the call ever stops throwing, whatever it hands back
    // must not be a working week — the Sat-Sun fallback answers 2 for
    // Wed -> Fri, the exact wrong answer this assertion exists to forbid.
    let fallback: unknown;
    try {
      fallback = calendarFor("KW", null);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      return;
    }
    expect.fail(`returned ${JSON.stringify(fallback)} for a jurisdiction with no calendar`);
  });
});

describe("a filing due date is calendar arithmetic", () => {
  // data-model.md:89 — "Computed from the regime: `periodEnd +
  // Regime.deadlineDays` in plain **calendar** days, not rolled off a weekend."
  // Legacy: `dueDate.setDate(dueDate.getDate() + filingDeadlineDays)`
  // (reference/legacy/lib/vat.ts:43-44 and lib/tax.ts:35-36).
  it.each([
    { periodEnd: "2026-06-30", days: 28, due: "2026-07-28", why: "UAE VAT, quarterly" },
    { periodEnd: "2026-12-31", days: 28, due: "2027-01-28", why: "across the year boundary" },
    { periodEnd: "2028-01-31", days: 29, due: "2028-02-29", why: "into a leap day" },
    { periodEnd: "2026-06-30", days: 0, due: "2026-06-30", why: "zero days is the period end itself" },
  ])("$periodEnd + $days days is $due ($why)", ({ periodEnd, days, due }) => {
    expect(ymd(statutoryDue(d(periodEnd), days))).toBe(due);
  });

  it("leaves a due date that lands on a Friday exactly where it falls", () => {
    // Thu 30 Apr 2026 + 15 days = Fri 15 May 2026, a Gulf weekend day. Ahmed's
    // decision, 2026-08-14 (prisma/schema.prisma, Regime.deadlineDays): "the
    // statutory deadline is the statutory deadline, and moving it because the
    // office is shut would misreport when the filing is actually late."
    const due = statutoryDue(d("2026-04-30"), 15);
    expect(ymd(due)).toBe("2026-05-15");
    expect(d(ymd(due)).getUTCDay(), "15 May 2026 is a Friday").toBe(5);
    expect(GULF).toContain(d(ymd(due)).getUTCDay());
  });

  it("leaves a due date that lands on a Saturday exactly where it falls", () => {
    const due = statutoryDue(d("2026-01-31"), 28);
    expect(ymd(due)).toBe("2026-02-28");
    expect(d(ymd(due)).getUTCDay(), "28 Feb 2026 is a Saturday").toBe(6);
  });

  it("is not the business-day arithmetic wearing a different name", () => {
    // The unification catcher. 30 Jun 2026 + 28 CALENDAR days is 28 Jul 2026;
    // the same span holds only 20 working days under the Gulf mask (eight
    // Fri/Sat days fall inside it). If someone routes the due date through the
    // calendar, this pins the difference: reading UAE VAT's 28 days as business
    // days lands the filing about twelve days late, which is a penalty.
    const periodEnd = d("2026-06-30");
    const due = statutoryDue(periodEnd, 28);
    expect(ymd(due)).toBe("2026-07-28");
    expect(businessDays(periodEnd, due, AE())).toBe(20);
    expect(businessDays(periodEnd, due, AE())).not.toBe(28);
  });

  it("stays put on a day the same calendar calls a public holiday", () => {
    // prisma Regime.deadlineDays — "module-deadlines should surface that a
    // deadline falls on a non-working day, not silently shift it". Mon 11 May
    // 2026 is declared a holiday here; the 15-day filing deadline still lands
    // on Fri 15 May, and the business-day distance to it is 9, not 15.
    const withHoliday = calendar("AE", GULF, ["2026-05-11"]);
    const due = statutoryDue(d("2026-04-30"), 15);
    expect(ymd(due)).toBe("2026-05-15");
    expect(businessDays(d("2026-04-30"), due, withHoliday)).toBe(9);
    expect(businessDays(d("2026-04-30"), due, AE())).toBe(10);
  });
});

describe("the due date agrees with the legacy oracle", () => {
  // No expected value below is hand-written: legacy generateVatPeriods produces
  // the period ends and the due dates, and the candidate is asked for the same
  // due date from the same period end. reference/legacy/lib/vat.ts:43-44 is the
  // rule being reproduced; lib/tax.ts:35-36 is byte-identical.
  //
  // The legacy generator reads the wall clock (`const now = new Date()`), so
  // the clock is pinned. It also builds LOCAL-midnight dates, while a period
  // end reaching this build comes from Prisma `@db.Date`, i.e. UTC midnight.
  // periodEndOf converts one to the other, so both sides are asked about the
  // same calendar day; without it the comparison measures the runner's UTC
  // offset rather than either implementation's arithmetic.
  const periodEndOf = (period: { periodEnd: Date }): Date => d(ymd(period.periodEnd));
  it("matches every quarterly period it generates for a 28-day deadline", () => {
    vi.useFakeTimers();
    vi.setSystemTime(d("2026-08-14"));
    try {
      const periods = generateVatPeriods(new Date(2024, 0, 1), 3, 1, 28);
      expect(periods.length, "the oracle produced no cases to compare").toBeGreaterThan(4);
      for (const period of periods) {
        expect(ymd(statutoryDue(periodEndOf(period), 28)), `period ending ${ymd(period.periodEnd)}`).toBe(
          ymd(period.dueDate),
        );
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("matches every monthly period it generates for a 15-day deadline", () => {
    vi.useFakeTimers();
    vi.setSystemTime(d("2026-08-14"));
    try {
      const periods = generateVatPeriods(new Date(2025, 5, 1), 1, 1, 15);
      expect(periods.length).toBeGreaterThan(10);
      for (const period of periods) {
        expect(ymd(statutoryDue(periodEndOf(period), 15)), `period ending ${ymd(period.periodEnd)}`).toBe(
          ymd(period.dueDate),
        );
      }
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// isWorkingDay and requireCalendar's success path. Both are exported API and
// both were reaching production untested — requireCalendar only ever exercised
// through its throwing branch, and isWorkingDay not at all, while the module
// header leans on it ("a due date CAN fall on a Friday; the monitor surfaces
// that"). A test that reimplements the check instead of calling it proves the
// test's arithmetic, not the module's.
// ---------------------------------------------------------------------------

describe("isWorkingDay", () => {
  it("is false on the Gulf weekend and true across Sunday to Thursday", () => {
    const cal = calendar("AE", GULF);
    // 2026-08-16 is a Sunday.
    const week = ["2026-08-16", "2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20"];
    for (const day of week) {
      expect(isWorkingDay(cal, d(day)), `${day} is a Gulf working day`).toBe(true);
    }
    expect(isWorkingDay(cal, d("2026-08-21")), "Friday is not a Gulf working day").toBe(false);
    expect(isWorkingDay(cal, d("2026-08-22")), "Saturday is not a Gulf working day").toBe(false);
  });

  it("reads the mask as data — the same day flips under a Saturday-Sunday week", () => {
    // The whole point of the mask being a column: change the row, change the
    // answer, with no code change.
    expect(isWorkingDay(calendar("AE", GULF), d("2026-08-21"))).toBe(false);
    expect(isWorkingDay(calendar("US", WESTERN), d("2026-08-21"))).toBe(true);
  });

  it("is false on a public holiday that falls on a working day", () => {
    const withHoliday = calendar("AE", GULF, ["2026-08-19"]);
    expect(isWorkingDay(withHoliday, d("2026-08-19")), "a holiday is not a working day").toBe(false);
    expect(isWorkingDay(withHoliday, d("2026-08-18")), "the day before still is").toBe(true);
  });

  it("answers false for a filing due date that lands on a Friday", () => {
    // The claim the module header makes: the statutory date is not moved, and
    // the monitor surfaces that it is not a working day. Asserted by calling
    // the function rather than recomputing the weekday in the test.
    const due = statutoryDue(d("2026-04-30"), 15);
    expect(ymd(due)).toBe("2026-05-15");
    expect(isWorkingDay(calendar("AE", GULF), due), "2026-05-15 is a Friday").toBe(false);
  });
});

describe("requireCalendar", () => {
  it("returns the calendar when one exists", () => {
    // Only the throwing branch was covered, so nothing proved the success path
    // returns the row rather than, say, a default.
    const cal = calendar("AE", GULF, ["2026-12-02"]);
    const got = requireCalendar("AE", cal);
    expect(got).toBe(cal);
    expect(got.weekendMask).toEqual([...GULF]);
    expect(got.holidays).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// The statutory date and the date you must file by are two different dates.
// Ahmed's decision, 2026-08-14, reversing the earlier reading that the due date
// is never adjusted: the statute counts CALENDAR days, but it does not require
// filing on a day the portal and the bank are shut.
// ---------------------------------------------------------------------------

describe("filingDueDate rolls a closed day forward", () => {
  it("UAE VAT: a period ending 31 March is statutorily due 28 April", () => {
    // Federal Decree-Law No. 8 of 2017, Article 64 — "the 28th day following
    // the end of the tax period". 31 March + 28 = 28 April, and 28 April 2024
    // is a Sunday, which is a WORKING day in the Gulf week, so nothing moves.
    const statutory = statutoryDue(d("2024-03-31"), 28);
    expect(ymd(statutory)).toBe("2024-04-28");
    expect(statutory.getUTCDay(), "28 April 2024 is a Sunday").toBe(0);
    expect(ymd(filingDue(d("2024-03-31"), 28, calendar("AE", GULF)))).toBe("2024-04-28");
  });

  it("moves a Friday due date to the next working day", () => {
    // 2026-04-30 + 15 = Friday 15 May, which is the Gulf weekend. Sunday 17 May
    // is the next working day.
    const statutory = statutoryDue(d("2026-04-30"), 15);
    expect(ymd(statutory)).toBe("2026-05-15");
    expect(statutory.getUTCDay(), "15 May 2026 is a Friday").toBe(5);
    expect(ymd(filingDue(d("2026-04-30"), 15, calendar("AE", GULF)))).toBe("2026-05-17");
  });

  it("moves a Saturday due date too, and only by one day", () => {
    // 2026-01-31 + 28 = Saturday 28 February. Sunday 1 March is next.
    expect(ymd(statutoryDue(d("2026-01-31"), 28))).toBe("2026-02-28");
    expect(ymd(filingDue(d("2026-01-31"), 28, calendar("AE", GULF)))).toBe("2026-03-01");
  });

  it("steps over a public holiday that follows the weekend", () => {
    // Friday and Saturday closed, then Sunday is a holiday: the next open day
    // is Monday. Holidays come from the jurisdiction's calendar, not a constant.
    const withHoliday = calendar("AE", GULF, ["2026-05-17"]);
    expect(ymd(filingDue(d("2026-04-30"), 15, withHoliday))).toBe("2026-05-18");
  });

  it("reads the weekend from the calendar, so the answer differs by jurisdiction", () => {
    // The same statutory Friday is a working day under a Saturday-Sunday week
    // and is not moved at all.
    expect(ymd(filingDue(d("2026-04-30"), 15, calendar("US", WESTERN)))).toBe("2026-05-15");
    expect(ymd(filingDue(d("2026-04-30"), 15, calendar("AE", GULF)))).toBe("2026-05-17");
  });

  it("leaves a statutory date that already falls on a working day alone", () => {
    // 2026-06-30 + 28 = Tuesday 28 July.
    expect(ymd(filingDue(d("2026-06-30"), 28, calendar("AE", GULF)))).toBe("2026-07-28");
  });

  it("refuses a calendar with no working day rather than looping", () => {
    // A mask closing every day is mis-entered data, not a fortnight of holiday.
    // It must say so and name the jurisdiction, never hang the sweep.
    const closed = calendar("XX", [0, 1, 2, 3, 4, 5, 6]);
    expect(() => filingDue(d("2026-06-30"), 28, closed)).toThrow(/XX/);
    expect(() => filingDue(d("2026-06-30"), 28, closed)).toThrow(/no working day/);
  });
});
