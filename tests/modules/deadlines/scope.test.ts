// Assertions 3, 4, 5 and 6 of tasks/backlog.yaml#module-deadlines-sweep:
//   3. "A jurisdiction with no BusinessCalendar errors for THAT jurisdiction
//       only; the run continues"
//   4. "Completeness is reported per jurisdiction; absence resolves only inside
//       a scope declared complete"
//   5. "An incomplete jurisdiction's alerts stay open, are marked STALE, and are
//       never resolved by absence"
//   6. "A missing calendar raises one misconfiguration alert"
//
// THIS FILE EXISTS BECAUSE THE CARRIED TESTS PINNED THE OPPOSITE. monitor.test.ts
// asserted `await expect(sweep(...)).rejects.toThrow(/KW/)` — one missing
// BusinessCalendar row aborted the entire sweep, no report was sent, and every
// healthy jurisdiction went dark with it. Ahmed reversed that on 2026-08-14 and
// flows-alerting.md:47-48 now carries both halves:
//
//   :47 "Completeness is scoped, and the scope is declared. A run may be
//        complete for part of its domain and not the rest. The deadline monitor
//        evaluates jurisdiction by jurisdiction: if one jurisdiction has no
//        business calendar it cannot be scored, and the run continues without
//        it. Absence then resolves only within the scopes the run declares
//        complete. Alerts in an incomplete scope stay open, are marked STALE,
//        and are never resolved by absence — the run did not look, and not
//        looking is not the same as finding nothing."
//   :48 "A partial run is never presented as whole. The alternative — aborting
//        so the report is either total or absent — takes every jurisdiction
//        dark for one bad calendar, which is a larger failure than the one it
//        avoids. Reporting the healthy scopes and naming the broken one is the
//        honest shape, and the missing calendar raises its own misconfiguration
//        alert so the gap is visible rather than merely survivable."
//
// What did NOT change: module-deadlines' assertion "a jurisdiction with no
// BusinessCalendar is an error, never a Saturday-Sunday fallback". Erroring for
// that jurisdiction is not the same as aborting the run; a fallback week is
// still what CLAUDE.md rule 9 forbids, and calendar.test.ts still pins
// requireCalendar throwing. Both paths are tested here.
import { describe, expect, it } from "vitest";
import {
  GULF,
  type Registration,
  type Report,
  type ThresholdRule,
  type World,
  calendar,
  d,
  deadline,
  fakeAlertManager,
  fingerprints,
  misconfigurationsAbout,
  raisedAbout,
  scopeOf,
  sweep,
  threshold,
} from "./surface";

const TODAY = d("2026-08-16"); // Sunday
const AE = calendar("AE", GULF);
const KW = calendar("KW", GULF);
const BH = calendar("BH", GULF);

const THRESHOLDS: ThresholdRule[] = [threshold("expiry", 10, "major")];

// Four business days from TODAY, so each is inside the 10-day window.
const UAE_VISA = deadline("document:123", "expiry", d("2026-08-20"), "AE");
const UAE_LICENCE = deadline("document:124", "expiry", d("2026-08-20"), "AE");
const KUWAIT_VISA = deadline("document:111", "expiry", d("2026-08-20"), "KW");
const KUWAIT_LICENCE = deadline("document:112", "expiry", d("2026-08-20"), "KW");
const KUWAIT_PERMIT = deadline("document:113", "expiry", d("2026-08-20"), "KW");
const BAHRAIN_VISA = deadline("document:211", "expiry", d("2026-08-20"), "BH");

function world(registrations: Registration[], calendars = [AE, KW]): World {
  return {
    today: TODAY,
    runId: "r9",
    registrations,
    thresholds: THRESHOLDS,
    calendars,
    alerts: fakeAlertManager(),
  };
}

const endsWith = (report: Report, tail: string): boolean =>
  fingerprints(report).some((fingerprint) => fingerprint.endsWith(tail));

describe("a missing calendar errors for that jurisdiction only, and the run continues", () => {
  it("still sends its report, and every healthy jurisdiction is in it", async () => {
    // :48 — aborting "takes every jurisdiction dark for one bad calendar". The
    // healthy half of the domain is the thing being protected here.
    const state = world([UAE_VISA, UAE_LICENCE, KUWAIT_VISA], [AE]);
    const report = await sweep(state);

    expect(state.alerts.runs, "the run sent no report at all").toHaveLength(1);
    expect(fingerprints(report), "the healthy jurisdiction went dark with the broken one").toHaveLength(2);
    expect(endsWith(report, "document:123:expiry")).toBe(true);
    expect(endsWith(report, "document:124:expiry")).toBe(true);
  });

  it("leaves the unscorable jurisdiction out of the breach set", async () => {
    // It cannot be scored, so it cannot be reported as breached OR as clear —
    // "the run did not look, and not looking is not the same as finding
    // nothing" (:47). Reporting it as a breach would mean it was measured
    // against some week, which is the Saturday-Sunday fallback rule 9 forbids.
    const state = world([UAE_VISA, KUWAIT_VISA], [AE]);
    const report = await sweep(state);
    expect(fingerprints(report), "nothing was reported at all").toHaveLength(1);
    expect(endsWith(report, "document:111:expiry"), "KW was scored without a calendar").toBe(false);
  });

  it("does not throw, however many jurisdictions are broken", async () => {
    // The literal reversal of the carried assertion. Two broken jurisdictions
    // and one healthy one: the run completes and reports the healthy one.
    const state = world([UAE_VISA, KUWAIT_VISA, BAHRAIN_VISA], [AE]);
    const report = await sweep(state);
    expect(fingerprints(report)).toHaveLength(1);
    expect(endsWith(report, "document:123:expiry")).toBe(true);
  });

  it("still sends the empty report when the only jurisdiction it has is broken", async () => {
    // The liveness signal is the point of the empty report (spec:32-33), and
    // this is the run most likely to be skipped by an implementation that
    // treats "nothing scorable" as "nothing to say". A source that goes silent
    // here is a source the Alert Manager must treat as dark
    // (flows-alerting.md:49), which freezes every open alert everywhere.
    const state = world([KUWAIT_VISA, KUWAIT_LICENCE], [AE]);
    const report = await sweep(state);
    expect(state.alerts.runs, "no report was sent, so the source reads as dark").toHaveLength(1);
    expect(report.alerts).toEqual([]);
    expect(report.sourceId).toBe("deadline-monitor");
  });
});

describe("a missing calendar raises one misconfiguration alert", () => {
  it("raises exactly one for the jurisdiction, however many deadlines it holds", async () => {
    // :48 — "the missing calendar raises its own misconfiguration alert so the
    // gap is visible rather than merely survivable." One per jurisdiction: the
    // same flood argument the unconfigured-type rule makes (spec:46).
    const state = world([UAE_VISA, KUWAIT_VISA, KUWAIT_LICENCE, KUWAIT_PERMIT], [AE]);
    await sweep(state);
    const about = misconfigurationsAbout(state.alerts, "KW", state.registrations);
    expect(about, "three Kuwaiti deadlines produced no misconfiguration alert").toHaveLength(1);
    expect(about[0].fingerprint).toContain("KW");
  });

  it("raises one per broken jurisdiction, and none for the healthy one", async () => {
    const state = world([UAE_VISA, KUWAIT_VISA, BAHRAIN_VISA], [AE]);
    await sweep(state);
    expect(misconfigurationsAbout(state.alerts, "KW", state.registrations)).toHaveLength(1);
    expect(misconfigurationsAbout(state.alerts, "BH", state.registrations)).toHaveLength(1);
    expect(state.alerts.raised, "two broken jurisdictions, two raises").toHaveLength(2);
  });

  it("raises none at all when every jurisdiction has a calendar", async () => {
    // The negative half. Without it, "raises on a missing calendar" is
    // satisfied by a module that raises on every run.
    const state = world([UAE_VISA, KUWAIT_VISA], [AE, KW]);
    const report = await sweep(state);
    expect(fingerprints(report), "both should have been scored").toHaveLength(2);
    expect(state.alerts.raised).toEqual([]);
  });

  it("raises it through raiseAlert rather than smuggling it into the breach set", async () => {
    // Isolated, like the unconfigured-type channel case, so a disagreement
    // about the verb fails one test. reportRun's array is "the run's complete
    // breach set" (flows-alerting.md:24); a jurisdiction with no calendar is
    // not a breached deadline, it is the engine reporting on its own inputs —
    // the shape :49 gives the source-dark alarm.
    const state = world([KUWAIT_VISA], [AE]);
    const report = await sweep(state);
    expect(report.alerts).toEqual([]);
    expect(raisedAbout(state.alerts, "KW")).toHaveLength(1);
  });
});

describe("completeness is reported per jurisdiction", () => {
  it("declares the healthy jurisdiction complete and the broken one not", async () => {
    // :47 — "Completeness is scoped, and the scope is declared." Without a
    // declaration the Alert Manager has only one lever, and applying it means
    // either resolving KW's alerts by absence (which is wrong) or resolving
    // nothing at all (which strands AE's).
    const state = world([UAE_VISA, KUWAIT_VISA], [AE]);
    const report = await sweep(state);
    expect(
      report.scopes,
      "the run declared no completeness scope at all, so the Alert Manager cannot " +
        "tell the jurisdiction it checked from the one it could not. Expected the report to " +
        "carry {complete: [...], incomplete: [...]} of jurisdiction ids. It carried: " +
        JSON.stringify(report.extra),
    ).toBeDefined();
    expect(report.scopes?.complete).toContain("AE");
    expect(report.scopes?.complete, "KW was declared complete; it was never scored").not.toContain("KW");
    expect(report.scopes?.incomplete, "the broken scope is not named").toContain("KW");
  });

  it("declares every jurisdiction complete when they all have calendars", async () => {
    const state = world([UAE_VISA, KUWAIT_VISA], [AE, KW]);
    const report = await sweep(state);
    expect(report.scopes?.complete.slice().sort()).toEqual(["AE", "KW"]);
    expect(report.scopes?.incomplete ?? []).toEqual([]);
  });

  it("marks each breach with the jurisdiction it was scored in", async () => {
    // The declaration is only usable if an open alert can be placed in a scope,
    // and a fingerprint — `{tenant}:{app}:{source}:{entity}:{policy}`
    // (flows-alerting.md:34) — has no jurisdiction segment to place it by.
    const state = world([UAE_VISA, BAHRAIN_VISA], [AE, BH]);
    const report = await sweep(state);
    expect(report.alerts, "nothing to attribute").toHaveLength(2);
    const scopes = report.alerts.map((alert) => ({ tail: alert.fingerprint.split(":").slice(-2).join(":"), scope: scopeOf(alert) }));
    expect(scopes.find((entry) => entry.tail === "123:expiry")?.scope).toBe("AE");
    expect(scopes.find((entry) => entry.tail === "211:expiry")?.scope).toBe("BH");
  });
});

describe("absence resolves inside a completed scope, and never inside an incomplete one", () => {
  /**
   * The full sequence the decision describes, in one run:
   *
   *   night 1 — every calendar present. A UAE visa and a Kuwaiti visa breach,
   *             so both alerts are open with the Alert Manager.
   *   night 2 — Kuwait's BusinessCalendar row is gone. The UAE visa has been
   *             renewed, so it is absent from the breach set; the Kuwaiti one
   *             has not, but cannot be scored.
   *
   * The UAE alert must close, because the run declared AE complete and looked.
   * The Kuwaiti alert must stay open and be marked STALE, because the run did
   * not look. flows-alerting.md:46-47.
   */
  async function twoNights() {
    const state = world([UAE_VISA, KUWAIT_VISA], [AE, KW]);
    const first = await sweep(state);

    const renewed = deadline("document:123", "expiry", d("2028-08-20"), "AE");
    const second = await sweep({ ...state, registrations: [renewed, KUWAIT_VISA], calendars: [AE] });
    return { state, first, second };
  }

  it("sets the two alerts up on the first night", async () => {
    // The precondition, asserted rather than assumed: without two open alerts
    // going into the second night, everything below passes over an empty set.
    const { state, first } = await twoNights();
    expect(fingerprints(first), "the first night did not open two alerts").toHaveLength(2);
    expect(state.alerts.board().length).toBeGreaterThanOrEqual(2);
  });

  it("resolves the renewed UAE visa, because the run declared AE complete", async () => {
    // :46 — "Absence from a completed report resolves. The run evaluated
    // everything; this fingerprint was not breached. Affirmative, not
    // inferred."
    const { state, first } = await twoNights();
    const uae = first.alerts.find((alert) => alert.fingerprint.endsWith("document:123:expiry"));
    expect(uae, "the UAE visa never breached, so its resolution proves nothing").toBeDefined();
    expect(state.alerts.stateOf(uae!.fingerprint)?.status).toBe("resolved");
  });

  it("leaves the Kuwaiti alert open and marks it STALE", async () => {
    // :47 — "Alerts in an incomplete scope stay open, are marked STALE, and are
    // never resolved by absence — the run did not look, and not looking is not
    // the same as finding nothing." This is the assertion the whole scoping
    // decision exists for: the Kuwaiti visa is still expiring, and closing its
    // alert because a calendar row was deleted would hide it.
    const { state, first } = await twoNights();
    const kuwaiti = first.alerts.find((alert) => alert.fingerprint.endsWith("document:111:expiry"));
    expect(kuwaiti, "the Kuwaiti visa never breached, so nothing was at risk of closing").toBeDefined();

    const status = state.alerts.stateOf(kuwaiti!.fingerprint)?.status;
    expect(status, "an alert in a scope the run could not evaluate was resolved by absence").not.toBe(
      "resolved",
    );
    expect(status).toBe("stale");
  });

  it("never calls resolveAlert for either of them", async () => {
    // spec, Note:50 — "modules never call cancel… The missed-cancel failure
    // mode does not exist by construction." Resolution is the Alert Manager's,
    // driven by absence and by the declared scope; a module that reaches for
    // resolveAlert here would close the Kuwaiti alert directly.
    const { state } = await twoNights();
    expect(state.alerts.resolved).toEqual([]);
  });

  it("raises the misconfiguration alert on the second night and not the first", async () => {
    const { state } = await twoNights();
    expect(misconfigurationsAbout(state.alerts, "KW", state.registrations)).toHaveLength(1);
    expect(state.alerts.runs).toHaveLength(2);
  });

  it("re-reports the Kuwaiti breach once the calendar comes back, with no memory of the gap", async () => {
    // The self-heal (spec:13). Nothing about the broken night is carried
    // forward: the third run has a calendar again and scores KW exactly as the
    // first did.
    const state = world([UAE_VISA, KUWAIT_VISA], [AE, KW]);
    const first = await sweep(state);
    await sweep({ ...state, calendars: [AE] });
    const third = await sweep(state);

    expect(fingerprints(third)).toEqual(fingerprints(first));
    expect(third.scopes?.complete.slice().sort()).toEqual(["AE", "KW"]);
    expect(
      misconfigurationsAbout(state.alerts, "KW", state.registrations),
      "one broken night, one misconfiguration alert",
    ).toHaveLength(1);
  });
});
