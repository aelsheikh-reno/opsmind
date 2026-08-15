// Assertions 9 and 10 of tasks/backlog.yaml#module-deadlines-sweep:
//   9.  "Severity is the maximum across breached windows, never the tightest"
//   10. "A deadline type with no threshold row raises one misconfiguration
//        alert per run, not silence"
//
// and the two rules that sit with them in the same Note:
//   · "A threshold is inclusive at its bound — exactly seven business days
//     remaining breaches a seven-day window"
//   · "an overdue deadline, with negative days remaining, reports the highest
//     configured severity"
//
// All four are Ahmed's decisions of 2026-08-14, written into
// components-core-deadline-monitor.md:42-48. They were the four business rules
// that shipped uncovered when this node was split, so nothing here is derived
// from thresholds.ts: every expected value is read off those lines of spec.
//
// There is no legacy oracle for any of this. reference/legacy's sweep
// (app/api/cron/expiry-reminders/route.ts:37) has ONE window, hardcoded at 90
// calendar days, and no notion of severity at all — it sorts by `daysLeft` and
// emails the list. Severity, bands and misconfiguration are new, so the spec is
// the only source, and it is cited case by case.
import { describe, expect, it } from "vitest";
import {
  GULF,
  type Registration,
  type Severity,
  type ThresholdRule,
  type World,
  businessDays,
  calendar,
  d,
  deadline,
  fakeAlertManager,
  fingerprints,
  misconfigurations,
  misconfigurationsAbout,
  raisedAbout,
  severityOf,
  strongest,
  sweep,
  threshold,
} from "./surface";

const TODAY = d("2026-08-16"); // Sunday, the first working day of the Gulf week
const AE = calendar("AE", GULF);

/**
 * Due dates at a known business-day distance from TODAY under the Gulf mask.
 * Every test that uses one asserts the distance through businessDays() before
 * asserting anything about severity, so a wrong date in this table fails as a
 * wrong date rather than as a wrong severity.
 *
 *   Sun 16 · Mon 17 · Tue 18 · Wed 19 · Thu 20 · [Fri 21 Sat 22] · Sun 23 …
 */
const AT: Record<number, string> = {
  [-3]: "2026-08-11",
  [-2]: "2026-08-12",
  [-1]: "2026-08-13",
  0: "2026-08-16",
  1: "2026-08-17",
  2: "2026-08-18",
  3: "2026-08-19",
  4: "2026-08-20",
  5: "2026-08-23",
  6: "2026-08-24",
  7: "2026-08-25",
  8: "2026-08-26",
  9: "2026-08-27",
  10: "2026-08-30",
  12: "2026-09-01",
  20: "2026-09-13",
};

/** A registration `distance` business days from TODAY, with its distance checked. */
function dueIn(distance: number, deadlineType = "expiry", entityRef = "document:1"): Registration {
  const iso = AT[distance];
  if (iso === undefined) throw new Error(`no due date tabulated at ${distance} business days`);
  const registration = deadline(entityRef, deadlineType, d(iso));
  const measured = businessDays(TODAY, registration.dueDate, AE);
  if (measured !== distance) {
    throw new Error(
      `the fixture table says ${iso} is ${distance} business days from ${TODAY.toISOString()}, ` +
        `but the calendar makes it ${measured}. Fix the table, not the expectation.`,
    );
  }
  return registration;
}

function world(registrations: Registration[], thresholds: ThresholdRule[]): World {
  return {
    today: TODAY,
    runId: "r9",
    registrations,
    thresholds,
    calendars: [AE],
    alerts: fakeAlertManager(),
  };
}

/** The severity a table gives one deadline, or undefined when it reported none. */
async function scored(
  distance: number,
  thresholds: ThresholdRule[],
): Promise<Severity | undefined> {
  const registration = dueIn(distance);
  const report = await sweep(world([registration], thresholds));
  return severityOf(report, "document:1", "expiry");
}

// ---------------------------------------------------------------------------
// spec:42 — "Severity is the maximum across breached windows, never the
// tightest one. Where several threshold windows are breached at once, the
// reported severity is the highest of them, not the severity of the nearest
// window. A misordered Settings row must never downgrade an urgent deadline:
// rows of {30 days → major, 7 days → minor} report major at five days out.
// Over-warning is noisy and visible; under-warning is silent, and silence is
// the failure this module exists to prevent."
// ---------------------------------------------------------------------------

describe("severity is the maximum across breached windows, never the tightest", () => {
  // The spec's own rows, by name. This is the case the decision was written
  // around and the one that fails loudly if anyone reverts to tightest-wins:
  // at five days out both windows are breached, the NEAREST of them is the
  // 7-day minor, and the answer is nevertheless major.
  const MISORDERED = [threshold("expiry", 30, "major"), threshold("expiry", 7, "minor")];

  it("reports major at five days out for rows of {30 → major, 7 → minor}", async () => {
    const registration = dueIn(5);
    expect(businessDays(TODAY, registration.dueDate, AE), "the case is five days out").toBe(5);

    const report = await sweep(world([registration], MISORDERED));
    expect(report.alerts, "the deadline was not reported at all").toHaveLength(1);
    expect(report.alerts[0].severity).toBe("major");
  });

  it("gives the same answer with the rows entered the other way round", async () => {
    // spec:44 — "correctness must not depend on entry order". Same two rows,
    // reversed; an implementation that takes the first or the last matching row
    // rather than the maximum answers differently here.
    expect(await scored(5, MISORDERED)).toBe("major");
    expect(await scored(5, [...MISORDERED].reverse())).toBe("major");
  });

  it("does not downgrade as the deadline gets closer", async () => {
    // The shape of the defect the decision describes: under tightest-wins, a
    // deadline crossing from 8 days to 5 days moves from major to minor — it
    // gets quieter as it gets more urgent. Severity is monotonic while an alert
    // is open (flows-alerting.md:34), so a downgrade here would also force the
    // Alert Manager into a resolve-then-reopen it has no reason to perform.
    const far = await scored(20, MISORDERED); // inside 30 only
    const near = await scored(6, MISORDERED); // inside 30 and 7
    const nearest = await scored(0, MISORDERED); // due today
    expect([far, near, nearest]).toEqual(["major", "major", "major"]);
  });

  it("still reports minor when only a minor window is breached", async () => {
    // The other half, without which "always major" would pass everything above.
    expect(await scored(6, MISORDERED)).toBe("major"); // 30 and 7 breached
    expect(await scored(6, [threshold("expiry", 7, "minor")])).toBe("minor");
    expect(await scored(20, [threshold("expiry", 30, "minor")])).toBe("minor");
  });

  it("takes the maximum across three bands, whatever order they arrive in", async () => {
    const bands = [
      threshold("expiry", 14, "minor"),
      threshold("expiry", 30, "major"),
      threshold("expiry", 7, "minor"),
    ];
    expect(await scored(5, bands)).toBe("major");
    expect(await scored(5, [...bands].reverse())).toBe("major");
  });

  it("is the maximum over breached windows at every distance, for every table", async () => {
    // The invariant behind the four cases above, stated once and checked over
    // the whole grid rather than at the points someone thought to pick. The
    // expected value is computed from the spec sentence — "the reported
    // severity is the highest of [the breached windows]", inclusive at the
    // bound (:48) — and from nothing else.
    const tables: ThresholdRule[][] = [
      [threshold("expiry", 7, "minor")],
      [threshold("expiry", 30, "major"), threshold("expiry", 7, "minor")],
      [threshold("expiry", 7, "major"), threshold("expiry", 30, "minor")],
      [threshold("expiry", 10, "minor"), threshold("expiry", 5, "major")],
      [threshold("expiry", 0, "major")],
      [threshold("expiry", 3, "minor"), threshold("expiry", 6, "minor"), threshold("expiry", 9, "minor")],
      [threshold("expiry", 12, "major")],
    ];
    const distances = [-3, -1, 0, 1, 3, 5, 6, 7, 8, 9, 10, 12, 20];

    let breached = 0;
    let quiet = 0;
    for (const table of tables) {
      for (const distance of distances) {
        const expected = strongest(
          table.filter((row) => distance <= row.businessDaysBefore).map((row) => row.severity),
        );
        const actual = await scored(distance, table);
        expect(
          actual,
          `${distance} business days out, table ${JSON.stringify(
            table.map((row) => [row.businessDaysBefore, row.severity]),
          )}`,
        ).toBe(expected);
        if (expected === undefined) quiet += 1;
        else breached += 1;
      }
    }
    // Non-vacuity: the grid has to contain both outcomes, or the loop above
    // proves only that the module is silent, or only that it is loud.
    expect(breached, "no case in the grid breached").toBeGreaterThan(20);
    expect(quiet, "no case in the grid stayed inside every window").toBeGreaterThan(5);
  });
});

// ---------------------------------------------------------------------------
// spec:48 — "A threshold is inclusive at its bound — exactly seven business
// days remaining breaches a seven-day window — and an overdue deadline, with
// negative days remaining, reports the highest configured severity."
// ---------------------------------------------------------------------------

describe("a threshold is inclusive at its bound", () => {
  it("breaches at exactly seven business days and not at eight", async () => {
    // The exact sentence, at the exact number it names.
    expect(await scored(7, [threshold("expiry", 7, "major")])).toBe("major");
    expect(await scored(8, [threshold("expiry", 7, "major")])).toBeUndefined();
  });

  it("counts (from, to], so a deadline due today is zero days out and breaches a zero-day window", async () => {
    // The counting convention this node settles: "business-day distance counts
    // (from, to]" (tasks/backlog.yaml#module-deadlines note) — today does not
    // count, the target does. A zero-day window is the tightest a Settings row
    // can express, and "due today" has to be inside it or the tightest window
    // configurable is one that can never fire on the day it matters.
    expect(businessDays(TODAY, d(AT[0]), AE)).toBe(0);
    expect(businessDays(TODAY, d(AT[1]), AE)).toBe(1);
    expect(await scored(0, [threshold("expiry", 0, "major")])).toBe("major");
    expect(await scored(1, [threshold("expiry", 0, "major")])).toBeUndefined();
  });

  it("puts a deadline falling on the Gulf weekend at the distance of the last working day before it", async () => {
    // CLAUDE.md rule 9 and spec:13. Thu 20, Fri 21 and Sat 22 August are all
    // four business days from Sunday 16th, because there are no working days
    // left in which to act after Thursday. A four-day window therefore catches
    // the Friday and Saturday deadlines too — the case plain UTC arithmetic
    // gets wrong in the direction that matters, by reporting them as five and
    // six days away and staying quiet.
    const friday = deadline("document:2", "expiry", d("2026-08-21"));
    const saturday = deadline("document:3", "expiry", d("2026-08-22"));
    expect(businessDays(TODAY, friday.dueDate, AE), "21 Aug 2026 is a Friday").toBe(4);
    expect(businessDays(TODAY, saturday.dueDate, AE), "22 Aug 2026 is a Saturday").toBe(4);

    const report = await sweep(world([friday, saturday], [threshold("expiry", 4, "major")]));
    expect(fingerprints(report)).toHaveLength(2);
  });
});

describe("an overdue deadline takes the highest configured severity", () => {
  it("reports major when major is configured for the type", async () => {
    expect(await scored(-1, [threshold("expiry", 30, "major"), threshold("expiry", 7, "minor")])).toBe("major");
    expect(await scored(-3, [threshold("expiry", 5, "minor"), threshold("expiry", 10, "major")])).toBe("major");
  });

  it("reports minor when minor is the highest configured for the type", async () => {
    // "the highest CONFIGURED severity", not "major". A type whose Settings
    // rows only ever say minor does not acquire a severity nobody entered — the
    // table is data (spec:20), and inventing a level above it is the same
    // failure as hardcoding a window.
    expect(await scored(-1, [threshold("expiry", 7, "minor")])).toBe("minor");
    expect(await scored(-3, [threshold("expiry", 3, "minor"), threshold("expiry", 9, "minor")])).toBe("minor");
  });

  it("never falls out of the window by going more overdue", async () => {
    // An expired visa stops an engineer working (spec:7). Distance keeps
    // counting negative rather than clamping (calendar.ts's stated contract),
    // so a document three days past must not drop out of a three-day window
    // through arithmetic that only compares magnitudes.
    for (const distance of [-1, -2, -3]) {
      expect(await scored(distance, [threshold("expiry", 3, "major")]), `${distance} days`).toBe("major");
    }
  });

  it("is what the maximum rule already says, and is pinned separately anyway", async () => {
    // An overdue deadline is inside every window, so "the maximum across
    // breached windows" and "the highest configured severity" are the same
    // number for it. Ahmed named both, so both are asserted: if someone
    // implements overdue as a special case, this is where the special case has
    // to agree with the general one.
    const table = [threshold("expiry", 4, "minor"), threshold("expiry", 11, "major")];
    const highestConfigured = strongest(table.map((row) => row.severity));
    expect(highestConfigured).toBe("major");
    expect(await scored(-2, table)).toBe(highestConfigured);
  });
});

// ---------------------------------------------------------------------------
// spec:46 — "A deadline type with no configured threshold raises, rather than
// never reporting… It raises ONE alert per unconfigured type per run, not one
// per deadline, so a missing row produces a single actionable signal rather
// than a flood."
// ---------------------------------------------------------------------------

describe("a deadline type with no threshold row raises, and does not go quiet", () => {
  const UNCONFIGURED = [
    deadline("document:11", "trade_licence", d("2026-08-17")),
    deadline("document:12", "trade_licence", d("2026-08-18")),
    deadline("document:13", "trade_licence", d("2026-12-31")),
    deadline("person:21", "residency", d("2026-08-19")),
    deadline("person:22", "residency", d("2027-06-30")),
  ];
  const ONLY_EXPIRY = [threshold("expiry", 30, "major")];

  it("raises one alert per unconfigured type, not one per deadline", async () => {
    const state = world(UNCONFIGURED, ONLY_EXPIRY);
    const report = await sweep(state);
    expect(report.alerts, "an unconfigured type cannot breach a window nobody set").toEqual([]);

    // With no breaches in the report, everything the Alert Manager heard is a
    // misconfiguration alert, so this count is unambiguous.
    expect(
      misconfigurations(state.alerts, UNCONFIGURED),
      "five deadlines, two unconfigured types",
    ).toHaveLength(2);
    expect(misconfigurationsAbout(state.alerts, "trade_licence", UNCONFIGURED)).toHaveLength(1);
    expect(misconfigurationsAbout(state.alerts, "residency", UNCONFIGURED)).toHaveLength(1);
  });

  it("raises again on the next run, because the row is still missing", async () => {
    // "one alert per unconfigured type per RUN". The run is stateless
    // (spec:13): it does not remember having complained, and the fingerprint is
    // deterministic so the Alert Manager dedupes rather than the source.
    const state = world(UNCONFIGURED, ONLY_EXPIRY);
    await sweep(state);
    const afterOne = misconfigurations(state.alerts, UNCONFIGURED).map((alert) => alert.fingerprint);
    await sweep(state);
    const afterTwo = misconfigurations(state.alerts, UNCONFIGURED).map((alert) => alert.fingerprint);

    expect(afterOne, "nothing was raised on the first run").toHaveLength(2);
    expect(afterTwo).toHaveLength(4);
    expect(afterTwo.slice(2)).toEqual(afterOne);
  });

  it("names the type in the alert, so the missing row is actionable", async () => {
    // "a single actionable signal". An alert that does not say which type has
    // no row leaves an operator to diff Settings against the registrations.
    const state = world(UNCONFIGURED, ONLY_EXPIRY);
    await sweep(state);
    const about = misconfigurationsAbout(state.alerts, "trade_licence", UNCONFIGURED);
    expect(about, "no alert names the unconfigured type").toHaveLength(1);
    expect(about[0].fingerprint).toContain("trade_licence");
  });

  it("raises nothing when every registered type has a row", async () => {
    // The negative half. Without it, "raises on a missing row" is satisfied by
    // a module that raises on every run regardless.
    const state = world(
      [deadline("document:31", "expiry", d("2026-08-20")), deadline("document:32", "expiry", d("2026-12-31"))],
      ONLY_EXPIRY,
    );
    const report = await sweep(state);
    expect(report.alerts, "the near one should still breach").toHaveLength(1);
    expect(state.alerts.raised, "nothing is misconfigured here").toEqual([]);
  });

  it("raises nothing for a type whose row exists but whose deadlines are all far away", async () => {
    // The distinction the decision turns on: "silence must never be
    // indistinguishable from 'nothing is wrong'." A configured type with
    // nothing near IS nothing wrong, and must stay silent, or the signal is
    // worthless.
    const state = world([deadline("document:41", "expiry", d("2027-12-31"))], ONLY_EXPIRY);
    const report = await sweep(state);
    expect(report.alerts).toEqual([]);
    expect(state.alerts.raised).toEqual([]);
  });

  it("raises it as an alert about the configuration, not as a member of the breach set", async () => {
    // The one contested detail, kept in its own case so a disagreement about
    // the channel fails here alone. reportRun's array is defined as "the run's
    // complete breach set" (flows-alerting.md:24) and a missing Settings row is
    // not a breached deadline; the engine reporting on its own inputs is the
    // raiseAlert shape flows-alerting.md:49 uses for the source-dark alarm.
    const state = world(UNCONFIGURED, ONLY_EXPIRY);
    const report = await sweep(state);
    expect(report.alerts).toEqual([]);
    expect(raisedAbout(state.alerts, "trade_licence"), "not raised through raiseAlert").toHaveLength(1);
  });

  it("keeps scoring the types that are configured while another type has no row", async () => {
    // A missing row for one type must not take the rest of the sweep with it —
    // the same shape as the missing calendar (flows-alerting.md:48), one level
    // down. This is the case that fails if the module throws on an unconfigured
    // type instead of raising.
    const state = world(
      [dueIn(4, "expiry", "document:51"), deadline("document:52", "trade_licence", d("2026-08-17"))],
      ONLY_EXPIRY,
    );
    const report = await sweep(state);
    expect(fingerprints(report)).toHaveLength(1);
    expect(report.alerts[0].fingerprint.endsWith("document:51:expiry")).toBe(true);
    expect(misconfigurationsAbout(state.alerts, "trade_licence", state.registrations)).toHaveLength(1);
  });
});
