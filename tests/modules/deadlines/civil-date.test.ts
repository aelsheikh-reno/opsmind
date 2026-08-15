// Assertion 7 of tasks/backlog.yaml#module-deadlines-sweep:
//   "The sweep scores against the jurisdiction's civil date, not UTC"
//
// The defect this exists to prevent, from that node verbatim: "The sweep is
// scheduled 02:00 with no timezone stated anywhere; in the Gulf that is 22:00
// the previous UTC day, so a UTC default warns a day late. Ahmed 2026-08-14: the
// jurisdiction's civil date defines today, and the timezone lives on
// BusinessCalendar beside the weekend mask and holidays — Jurisdiction is
// identity, BusinessCalendar is the civil-time rules."
//
// "A day late" is not a rounding error here. Every window in the threshold table
// shifts by one, so a deadline that should breach a three-day window on the day
// it enters it is reported the following night instead — and on the last night
// before a filing, the following night is after the deadline.
//
// Legacy has the same bug in its own frame and is not an oracle for this:
// expiry-reminders/route.ts:10-16 takes `new Date()` and calls
// `setHours(0,0,0,0)`, which is midnight in the SERVER's timezone, so its answer
// depends on where the process runs rather than on where the deadline is.
//
// The instants below are chosen so that Asia/Dubai (UTC+4 year-round, no DST)
// and UTC fall on different calendar days. Nothing here depends on a DST rule.
import { describe, expect, it, vi } from "vitest";
import {
  GULF,
  type Registration,
  type ThresholdRule,
  type World,
  at,
  businessDays,
  calendar,
  d,
  deadline,
  fakeAlertManager,
  fingerprints,
  sweep,
  sweepOnTheSystemClock,
  threshold,
} from "./surface";

// 02:00 on Monday 17 August 2026 in the Gulf. In UTC it is still Sunday the
// 16th — the exact hour operations-scheduling.md:21 schedules the sweep at.
const SWEEP_TIME = at("2026-08-16T22:00:00Z");
// The same civil day in both frames: 14:00 Dubai, 10:00 UTC, Sunday the 16th.
const MIDDAY = at("2026-08-16T10:00:00Z");

const DUBAI = calendar("AE", GULF, [], "Asia/Dubai");
const UTC = calendar("AE", GULF, [], "UTC");
const CAIRO = calendar("EG", GULF, [], "Africa/Cairo");

// Thursday 20 August 2026. Three business days from Monday the 17th, four from
// Sunday the 16th, under the Gulf mask — so a three-day window separates the two
// readings of "today" and nothing else does.
const FILING = deadline("filing:44", "due", d("2026-08-20"), "AE");
const THREE_DAYS: ThresholdRule[] = [threshold("due", 3, "major")];

function world(registrations: Registration[], calendars = [DUBAI], instant = SWEEP_TIME): World {
  return {
    today: d("2026-08-16"),
    at: instant,
    runId: "r9",
    registrations,
    thresholds: THREE_DAYS,
    calendars,
    alerts: fakeAlertManager(),
  };
}

describe("the two readings of today are one business day apart", () => {
  it("is what makes every case below able to fail", () => {
    // The premise, asserted rather than assumed. If these two distances were
    // ever equal, every test in this file would pass whichever civil date the
    // module used.
    expect(businessDays(d("2026-08-17"), FILING.dueDate, DUBAI), "from Monday the 17th").toBe(3);
    expect(businessDays(d("2026-08-16"), FILING.dueDate, DUBAI), "from Sunday the 16th").toBe(4);
    expect(SWEEP_TIME.toISOString(), "22:00Z is 02:00 the next day at UTC+4").toBe(
      "2026-08-16T22:00:00.000Z",
    );
  });
});

describe("the sweep scores against the jurisdiction's civil date", () => {
  it("reports a Gulf deadline that is inside the window on the Gulf's day", async () => {
    // 02:00 Monday in Dubai: the filing is three business days away and the
    // three-day window has been entered. This is the alert that arrives on time.
    const state = world([FILING]);
    const report = await sweep(state);
    expect(
      fingerprints(report),
      "scored against the UTC day, this warns tomorrow — one night before a filing",
    ).toHaveLength(1);
    expect(report.alerts[0].fingerprint.endsWith("filing:44:due")).toBe(true);
  });

  it("does not report it yet at midday, when both frames agree it is the 16th", async () => {
    // The control. Without it, the case above passes for a module that reports
    // everything, or one that is simply a day early in every frame.
    const report = await sweep(world([FILING], [DUBAI], MIDDAY));
    expect(report.alerts, "four business days out is outside a three-day window").toEqual([]);
  });

  it("warns a day late when the calendar says its civil time is UTC", async () => {
    // The defect named in the task node, reproduced as data: the same instant,
    // the same registration, the same threshold, one field different.
    const utc = await sweep(world([FILING], [UTC]));
    const dubai = await sweep(world([FILING], [DUBAI]));
    expect(utc.alerts, "at 22:00Z a UTC calendar is still on the 16th").toEqual([]);
    expect(dubai.alerts).toHaveLength(1);
  });

  it("reads the timezone from the calendar row, per jurisdiction, not once for the run", async () => {
    // Two jurisdictions, one sweep, one instant. At 20:30Z Dubai (UTC+4) has
    // turned over to Monday at 00:30 and Cairo has not — Egypt is UTC+3 in
    // August and would be UTC+2 without summer time, so it reads 23:30 or 22:30
    // on Sunday either way and this case does not rest on a DST rule. The same
    // due date is therefore three business days away in one jurisdiction and
    // four in the other. A run that computes "today" once and applies it
    // everywhere cannot produce that answer, and neither can one that takes it
    // from the process clock.
    const egyptian = deadline("filing:88", "due", d("2026-08-20"), "EG");
    const state = world([FILING, egyptian], [DUBAI, CAIRO], at("2026-08-16T20:30:00Z"));
    const report = await sweep(state);

    expect(fingerprints(report), "expected the Gulf filing and only the Gulf filing").toHaveLength(1);
    expect(report.alerts[0].fingerprint.endsWith("filing:44:due")).toBe(true);
  });

  it("makes a filing due on the jurisdiction's today zero days out, not one", async () => {
    // The tightest boundary the two rules share. Distance counts (from, to], so
    // a deadline due today is 0 and one due on the next working day is 1
    // (tasks/backlog.yaml#module-deadlines). At 02:00 Monday in Dubai a filing
    // due Monday is due TODAY and breaches a zero-day window; read in UTC it is
    // still tomorrow's problem, and tomorrow is when the portal closes.
    const dueMonday = deadline("filing:45", "due", d("2026-08-17"), "AE");
    const sameDay = [threshold("due", 0, "major")];

    const dubai = await sweep({ ...world([dueMonday]), thresholds: sameDay });
    const utc = await sweep({ ...world([dueMonday], [UTC]), thresholds: sameDay });

    expect(businessDays(d("2026-08-17"), dueMonday.dueDate, DUBAI), "due today").toBe(0);
    expect(businessDays(d("2026-08-16"), dueMonday.dueDate, DUBAI), "due tomorrow").toBe(1);
    expect(dubai.alerts, "a filing due today was not reported as due today").toHaveLength(1);
    expect(utc.alerts).toEqual([]);
  });

  it("takes the same view when the 02:00 job hands it no clock at all", async () => {
    // operations-scheduling.md:21 — the cron passes nothing; the run reads the
    // system clock. Pinned to the same instant, the answer must be the same one:
    // the civil date is the jurisdiction's business, not the caller's.
    vi.useFakeTimers();
    vi.setSystemTime(SWEEP_TIME);
    try {
      const state = world([FILING]);
      const report = await sweepOnTheSystemClock(state);
      expect(fingerprints(report)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives the same answer twice at the same instant", async () => {
    // Statelessness, in the frame where a clock is involved: a run that cached
    // "today" from the first call would answer the second differently only by
    // accident, so this is cheap and catches the accident.
    const state = world([FILING]);
    const first = await sweep(state);
    const second = await sweep(state);
    expect(fingerprints(second)).toEqual(fingerprints(first));
  });
});
