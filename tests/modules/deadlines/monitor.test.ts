// Assertions 1, 2 and 8 of tasks/backlog.yaml#module-deadlines-sweep:
//   1. "A run reports the complete breach set, and an empty set is meaningful"
//   2. "Registering a deadline already inside a threshold evaluates immediately"
//   8. "A run is stateless: two runs on the same day report identically, and a
//       missed night self-heals"
//
// plus the run-level half of module-deadlines' "Thresholds are data in settings,
// not constants in code" and its business-day arithmetic.
//
// Every assertion here is on what the Alert Manager was told, because that is
// what the spec makes observable: "The run reports its **complete** breach set
// to the Alert Manager" (components-core-deadline-monitor.md:13).
//
// CARRIED FROM `module-deadlines`, AND CHANGED WITH THE BEHAVIOUR. This file was
// written before three decisions were settled and pinned the opposite of two of
// them. Every case that changed says so at the case, with what it used to assert
// and why it no longer does. Nothing was deleted to avoid the conflict.
//   · "fails loudly, naming the jurisdiction, when a jurisdiction has no
//     calendar" asserted that the whole sweep REJECTED. It now asserts the run
//     continues and scopes the failure. See scope.test.ts for the full rule.
//   · "reports nothing for a type no threshold row covers" and "reports nothing
//     when the threshold table is empty" asserted silence. Silence is now the
//     forbidden outcome. See severity.test.ts for the count-per-type rule.
//   · "escalates through banded rows for one type" was justified by "the
//     tightest band the deadline has crossed is the one that scores it". That
//     rationale is reversed; the expected values happen to be unchanged, which
//     is exactly why the comment had to change and why severity.test.ts adds
//     the case that tells the two rules apart.
import { describe, expect, it, vi } from "vitest";
import {
  GULF,
  type Registration,
  type TestCalendar,
  type ThresholdRule,
  type World,
  businessDays,
  calendar,
  d,
  deadline,
  deregisterDeadline,
  evaluationOf,
  fakeAlertManager,
  fingerprints,
  misconfigurationsAbout,
  registerDeadline,
  scopeOf,
  sweep,
  sweepOnTheSystemClock,
  threshold,
} from "./surface";

const TODAY = d("2026-08-16"); // a Sunday, the first working day of the Gulf week
const AE = calendar("AE", GULF);

// Distances from TODAY under the Gulf calendar: 4, 7 and 12 business days.
const VISA = deadline("document:123", "expiry", d("2026-08-20"));
const LICENCE = deadline("document:456", "expiry", d("2026-08-25"));
const FILING = deadline("filing:44", "due", d("2026-09-01"));
// Months out under any reading.
const FAR_DOC = deadline("document:789", "expiry", d("2026-12-31"));
const FAR_FILING = deadline("filing:99", "due", d("2026-11-30"));

// The severities are the spec's own example: `…document:123:expiry` major and
// `…filing:44:due` minor (components-core-deadline-monitor.md:28-31).
const THRESHOLDS: ThresholdRule[] = [threshold("expiry", 10, "major"), threshold("due", 14, "minor")];

function world(overrides: Partial<World> = {}): World {
  return {
    today: TODAY,
    runId: "r9",
    registrations: [VISA, LICENCE, FILING, FAR_DOC, FAR_FILING],
    thresholds: THRESHOLDS,
    calendars: [AE],
    alerts: fakeAlertManager(),
    ...overrides,
  };
}

function only(registrations: Registration[], thresholds = THRESHOLDS, calendars: TestCalendar[] = [AE]): World {
  return world({ registrations, thresholds, calendars });
}

describe("a run reports the complete breach set", () => {
  it("sends one report naming the source, carrying every breach and nothing else", async () => {
    // spec:25 — "Every run sends one report", reportRun("deadline-monitor", r9,
    // [...]). Three of the five registrations are inside a threshold.
    const report = await sweep(world());
    expect(report.sourceId).toBe("deadline-monitor");
    expect(report.runId).toBe("r9");
    expect(report.alerts).toHaveLength(3);
    expect(fingerprints(report).map((f) => f.split(":").slice(-3).join(":"))).toEqual([
      "document:123:expiry",
      "document:456:expiry",
      "filing:44:due",
    ]);
  });

  it("carries the fingerprint shape the Alert Manager dedupes on", async () => {
    // flows-alerting.md:34 — "Fingerprints are deterministic —
    // {tenant}:{app}:{source}:{entity}:{policy} — computed by the source from
    // its own data". The spec's example ends `…document:123:expiry`.
    const report = await sweep(only([VISA]));
    const [alert] = report.alerts;
    expect(alert.fingerprint.endsWith("document:123:expiry")).toBe(true);
    expect(alert.fingerprint.split(":").length).toBeGreaterThanOrEqual(4);
    expect(alert.severity).toBe("major");
  });

  it("gives two deadlines on the same entity two identities", async () => {
    const renewal = deadline("document:123", "renewal", d("2026-08-20"));
    const report = await sweep(
      only([VISA, renewal], [...THRESHOLDS, threshold("renewal", 10, "minor")]),
    );
    expect(new Set(fingerprints(report)).size).toBe(2);
  });

  it("keeps severity out of the fingerprint", async () => {
    // flows-alerting.md:34 — "Severity is not part of the fingerprint
    // (escalation would break dedupe)". The same deadline scored under two
    // severity tables must dedupe to one alert identity.
    const asMajor = await sweep(only([VISA], [threshold("expiry", 10, "major")]));
    const asMinor = await sweep(only([VISA], [threshold("expiry", 10, "minor")]));
    expect(asMajor.alerts[0].severity).toBe("major");
    expect(asMinor.alerts[0].severity).toBe("minor");
    expect(asMinor.alerts[0].fingerprint).toBe(asMajor.alerts[0].fingerprint);
  });

  it("names, on each breach, the jurisdiction whose calendar scored it", async () => {
    // ADDED with the scoped-completeness decision. flows-alerting.md:47 —
    // "Absence then resolves only within the scopes the run declares complete."
    // A fingerprint is `{tenant}:{app}:{source}:{entity}:{policy}` (:34) and
    // carries no jurisdiction, so an alert that does not name its scope cannot
    // be placed inside or outside a completed one, and per-scope resolution is
    // not implementable at all.
    const report = await sweep(world());
    expect(report.alerts.length, "no breach to check the scope of").toBeGreaterThan(0);
    const unscoped = report.alerts.filter((alert) => scopeOf(alert) === undefined);
    expect(unscoped.map((alert) => alert.fingerprint), "these breaches name no jurisdiction").toEqual([]);
    expect(new Set(report.alerts.map(scopeOf))).toEqual(new Set(["AE"]));
  });

  it("sends an empty report when nothing is breached, rather than sending nothing", async () => {
    // spec:32 — "An empty array is a valid, meaningful report — 'I ran, nothing
    // is breached' — and doubles as the liveness signal." This is the exact
    // behaviour legacy gets wrong: expiry-reminders/route.ts:202-204 returns
    // `{ ok: true, sent: false }` and calls nobody, which under
    // flows-alerting.md:49 is a source that has gone dark.
    const state = only([FAR_DOC, FAR_FILING]);
    const report = await sweep(state);
    expect(state.alerts.runs).toHaveLength(1);
    expect(report.alerts).toEqual([]);
    expect(report.sourceId).toBe("deadline-monitor");
  });

  it("sends an empty report when there is nothing registered at all", async () => {
    const state = only([]);
    const report = await sweep(state);
    expect(state.alerts.runs).toHaveLength(1);
    expect(report.alerts).toEqual([]);
  });

  it("never resolves an alert itself — absence from the report does that", async () => {
    // spec, Note:50 — "modules never call cancel: they update their own data
    // (renew the visa, pay the filing) and the next run observes the cleared
    // state." flows-alerting.md:46 — "Absence from a completed report resolves."
    // So the licence is renewed here rather than deregistered.
    const state = world();
    const before = await sweep(state);
    expect(fingerprints(before)).toHaveLength(3);

    const renewed = deadline("document:456", "expiry", d("2027-08-25"));
    const after = await sweep({
      ...state,
      registrations: [VISA, renewed, FILING, FAR_DOC, FAR_FILING],
    });

    expect(fingerprints(after)).toEqual(
      fingerprints(before).filter((fingerprint) => !fingerprint.endsWith("document:456:expiry")),
    );
    expect(after.alerts).toHaveLength(2);
    expect(state.alerts.resolved, "the module called resolveAlert instead of reporting").toEqual([]);

    // ADDED: the other half of the same rule. Reporting less is only a
    // resolution because the run declared the scope complete — the licence's
    // alert has to actually close, or "absence resolves" is a claim nothing
    // checks (flows-alerting.md:46).
    const licence = before.alerts.find((alert) => alert.fingerprint.endsWith("document:456:expiry"));
    expect(licence, "the licence never breached, so its resolution proves nothing").toBeDefined();
    expect(state.alerts.stateOf(licence!.fingerprint)?.status).toBe("resolved");
  });
});

describe("thresholds are data in settings, not constants in code", () => {
  // spec, Owns table:20 — "Per deadline type, tunable in Settings — domain
  // knowledge, exactly as SOC thresholds are tuned per detection rule
  // (ADR-020)". Every case below changes a threshold row and nothing else.
  it("stops reporting a deadline when the window is tightened, with no code change", async () => {
    const wide = await sweep(only([LICENCE], [threshold("expiry", 10, "major")]));
    const narrow = await sweep(only([LICENCE], [threshold("expiry", 5, "major")]));
    expect(wide.alerts).toHaveLength(1); // 7 business days out, inside 10
    expect(narrow.alerts).toEqual([]); // the same date, outside 5
  });

  it("takes the severity from the row that matched", async () => {
    const report = await sweep(only([VISA], [threshold("expiry", 10, "minor")]));
    expect(report.alerts[0].severity).toBe("minor");
  });

  it("escalates through banded rows for one type", async () => {
    // CHANGED — the expected values stand, the reason for them does not. This
    // case used to read "the tightest band the deadline has crossed is the one
    // that scores it", which is the rule Ahmed reversed on 2026-08-14: severity
    // is the MAXIMUM across breached windows (spec:42). The two rules agree on
    // a sanely ordered table like this one — at 4 days out both 10-minor and
    // 5-major are breached, and the tightest and the maximum are both major —
    // which is precisely why a misordered table is needed to tell them apart.
    // severity.test.ts carries that case.
    const bands = [threshold("expiry", 10, "minor"), threshold("expiry", 5, "major")];
    const outer = await sweep(only([LICENCE], bands)); // 7 business days out: only 10 breached
    const inner = await sweep(only([VISA], bands)); // 4 business days out: 10 and 5 both breached
    expect(outer.alerts[0].severity).toBe("minor");
    expect(inner.alerts[0].severity).toBe("major");
  });

  it("treats the threshold itself as inside the window, and one day past it as outside", async () => {
    // The boundary. LICENCE is exactly 7 business days from today. spec:48 —
    // "A threshold is inclusive at its bound — exactly seven business days
    // remaining breaches a seven-day window".
    expect(businessDays(TODAY, LICENCE.dueDate, AE)).toBe(7);
    const atBoundary = await sweep(only([LICENCE], [threshold("expiry", 7, "major")]));
    const justOutside = await sweep(only([LICENCE], [threshold("expiry", 6, "major")]));
    expect(atBoundary.alerts).toHaveLength(1);
    expect(justOutside.alerts).toEqual([]);
  });

  it("reports a deadline already past, at the most severe band configured", async () => {
    // An expired visa stops an engineer working (spec:7). A negative distance
    // is more urgent than zero, never less; it must not fall out of the window.
    // spec:48 — "an overdue deadline, with negative days remaining, reports the
    // highest configured severity."
    const expired = deadline("document:321", "expiry", d("2026-08-06"));
    const report = await sweep(
      only([expired], [threshold("expiry", 10, "minor"), threshold("expiry", 5, "major")]),
    );
    expect(report.alerts).toHaveLength(1);
    expect(report.alerts[0].severity).toBe("major");
  });

  it("does not report a type no threshold row covers as a breach — it raises instead", async () => {
    // CHANGED. This case used to assert silence, and nothing else: "With no row
    // for trade_licence, a deadline one day away is not a breach: nobody has
    // said what one is." Half of that stands — it is still not a breach — but
    // silence is now the forbidden outcome. spec:46 — "A registered deadline
    // whose type has no ThresholdTable row is a misconfiguration, not a quiet
    // no-op: an unwatched deadline is exactly the failure this module exists to
    // prevent, and silence must never be indistinguishable from 'nothing is
    // wrong'." Ahmed's decision, 2026-08-14. The count-per-type half of the
    // rule is in severity.test.ts.
    //
    // What has NOT changed is why the row has to be data at all: legacy
    // hardcodes the window (expiry-reminders/route.ts:37,
    // `parseInt(... ?? "90") || 90`), which is the constant this assertion
    // exists to remove.
    const uncovered = deadline("document:654", "trade_licence", d("2026-08-17"));
    const state = only([uncovered], [threshold("expiry", 30, "major")]);
    const report = await sweep(state);
    expect(report.alerts, "an unconfigured type is not a breach — nobody has said what one is").toEqual([]);

    const raised = misconfigurationsAbout(state.alerts, "trade_licence", state.registrations);
    expect(raised, "an unconfigured deadline type went unreported entirely").toHaveLength(1);
  });

  it("raises for every uncovered type when the threshold table is empty, rather than going quiet", async () => {
    // CHANGED. This case used to assert `report.alerts` was empty and stop
    // there, which is the state an empty ThresholdTable produces in a build
    // that watches nothing at all — indistinguishable, from the outside, from a
    // healthy quiet night. The breach set is still empty; what is new is that
    // the run says why. Three registrations across two types raise two alerts,
    // one per type (spec:46).
    const state = only([VISA, LICENCE, FILING], []);
    const report = await sweep(state);
    expect(report.alerts, "nothing can breach a window nobody configured").toEqual([]);
    expect(
      misconfigurationsAbout(state.alerts, "expiry", state.registrations),
      "two expiry deadlines, one unconfigured type",
    ).toHaveLength(1);
    expect(misconfigurationsAbout(state.alerts, "due", state.registrations)).toHaveLength(1);
  });
});

describe("the run measures distance in business days against the jurisdiction's calendar", () => {
  // spec:13 — "'seven days' that lands on a weekend is not seven working days."
  it("breaches on a deadline that plain calendar arithmetic would leave outside the window", async () => {
    // LICENCE is 9 calendar days from Sun 16 Aug and 7 business days. A 7-day
    // threshold catches it only if the distance is measured in working days.
    const report = await sweep(only([LICENCE], [threshold("expiry", 7, "major")]));
    expect(report.alerts).toHaveLength(1);
  });

  it("changes its answer when the jurisdiction's weekend mask changes", async () => {
    // The same registration, the same threshold, a calendar row that says the
    // country works seven days a week: 9 days out, outside a 7-day window.
    const sevenDayWeek = calendar("AE", []);
    const report = await sweep(only([LICENCE], [threshold("expiry", 7, "major")], [sevenDayWeek]));
    expect(report.alerts).toEqual([]);
  });

  it("does not abort the run when a jurisdiction has no calendar", async () => {
    // CHANGED, AND THIS IS THE CASE THE WHOLE NODE TURNS ON. It used to read:
    //
    //     await expect(sweep(only([kuwaiti]))).rejects.toThrow(/KW/);
    //
    // i.e. one missing BusinessCalendar row aborted the entire sweep and no
    // report was sent at all. Ahmed reversed that on 2026-08-14, and
    // flows-alerting.md:48 now carries the reasoning: "A partial run is never
    // presented as whole. The alternative — aborting so the report is either
    // total or absent — takes every jurisdiction dark for one bad calendar,
    // which is a larger failure than the one it avoids."
    //
    // Note what did NOT change and must not: module-deadlines' assertion "a
    // jurisdiction with no BusinessCalendar is an error, never a
    // Saturday-Sunday fallback" still holds. Erroring FOR THAT JURISDICTION is
    // not the same as aborting the run, and a fallback week is what CLAUDE.md
    // rule 9 forbids — calendar.test.ts still pins requireCalendar throwing.
    // The full rule, both paths, is in scope.test.ts.
    const kuwaiti = deadline("document:111", "expiry", d("2026-08-25"), "KW");
    const state = only([VISA, kuwaiti]);
    const report = await sweep(state);

    expect(state.alerts.runs, "the run must still report; a silent source is a dark source").toHaveLength(1);
    expect(fingerprints(report).some((f) => f.endsWith("document:123:expiry"))).toBe(true);
    expect(
      fingerprints(report).some((f) => f.endsWith("document:111:expiry")),
      "KW could not be scored, so it cannot appear in the breach set",
    ).toBe(false);
    expect(
      misconfigurationsAbout(state.alerts, "KW", state.registrations),
      "the missing calendar was never reported",
    ).toHaveLength(1);
  });
});

describe("each run is stateless", () => {
  // spec:13 — "Each run is stateless: it recomputes distance from today rather
  // than remembering what it warned about yesterday, so a missed night
  // self-heals."
  it("gives the same report twice for the same day", async () => {
    const state = world();
    const first = await sweep(state);
    const second = await sweep(state);
    expect(second.alerts).toEqual(first.alerts);
    expect(state.alerts.runs).toHaveLength(2);
  });

  it("gives the same day the same answer whatever ran before it", async () => {
    // A missed night self-heals, and a run that remembered would give itself
    // away here: the second run for TODAY follows a run whose breach set was
    // empty, and it must still report all three.
    const state = world();
    const fresh = await sweep(state);

    const earlier = await sweep({ ...state, today: d("2026-07-26") });
    expect(earlier.alerts, "nothing is within a threshold three weeks earlier").toEqual([]);

    const repeated = await sweep(state);
    expect(repeated.alerts).toEqual(fresh.alerts);
    expect(state.alerts.runs).toHaveLength(3);
  });

  it("recomputes from today when the scheduled job hands it no clock", async () => {
    // operations-scheduling.md:21 — "Deadline sweep | Deadline monitor | daily
    // 02:00 | Stateless recompute; liveness via its own reportRun". The cron
    // passes no clock and no run id: the run must still take today from the
    // system, still report, and still carry a run id for the Alert Manager.
    vi.useFakeTimers();
    vi.setSystemTime(TODAY);
    try {
      const state = world();
      const report = await sweepOnTheSystemClock(state);
      expect(report.alerts).toHaveLength(3);
      expect(report.sourceId).toBe("deadline-monitor");
      expect(report.runId.length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("recomputes from the day it is given, not from the last day it ran", async () => {
    const state = world();
    await sweep(state); // TODAY: VISA is 4 business days out, inside 10
    const backInTime = await sweep({ ...state, today: d("2026-07-26") });
    expect(backInTime.alerts).toEqual([]);
    expect(businessDays(d("2026-07-26"), VISA.dueDate, AE)).toBe(19);
  });

  it("answers a cold process and a worn-in one identically", async () => {
    // ADDED. The three cases above all reuse one World, so a module that
    // memoised inside its own module scope — a cached threshold table, a
    // remembered set of fingerprints — would satisfy every one of them. This
    // compares a run in a process that has already swept five times, on three
    // different days, against a run built from nothing but the same data. Any
    // surviving state between runs shows up here as a difference.
    const warm = world();
    await sweep(warm);
    await sweep({ ...warm, today: d("2026-07-26") });
    await sweep(warm);
    await sweep({ ...warm, today: d("2027-01-01") });
    const wornIn = await sweep(warm);

    const cold = world();
    const fresh = await sweep(cold);

    expect(fingerprints(wornIn)).toEqual(fingerprints(fresh));
    expect(wornIn.alerts.map((alert) => alert.severity)).toEqual(fresh.alerts.map((a) => a.severity));
    expect(cold.alerts.runs).toHaveLength(1);
  });

  it("writes nothing to the registrations it swept", async () => {
    // ADDED. The other way a run could stop being stateless is by recording
    // what it warned on the row it swept — which is what
    // schema.test.ts forbids at the column level ("records nothing about what a
    // previous run warned"). This is the runtime half: after a sweep, every
    // registration is byte-for-byte what went in.
    const state = world();
    const snapshot = JSON.stringify(state.registrations);
    await sweep(state);
    await sweep(state);
    expect(JSON.parse(JSON.stringify(state.registrations))).toEqual(JSON.parse(snapshot));
  });

  it("does not depend on the order the registrations come back in", async () => {
    // ADDED. listRegistrations makes no ordering promise, and a run whose
    // answer depends on row order is one that a database's plan change can
    // alter without anybody touching the code.
    const forwards = world();
    const backwards = world({ registrations: [...forwards.registrations].reverse() });
    const a = await sweep(forwards);
    const b = await sweep(backwards);
    expect(fingerprints(a).length, "an empty breach set would make this vacuous").toBeGreaterThan(0);
    expect(fingerprints(b)).toEqual(fingerprints(a));
  });
});

describe("registering a deadline already inside a threshold evaluates immediately", () => {
  // spec, Owns table:22 — "Evaluate-on-register: A document ingested already
  // inside a threshold is scored inline, not left for the next sweep."
  const arriving = deadline("document:555", "expiry", d("2026-08-20")); // 4 days out

  it("scores it inline, with the severity its threshold row carries", async () => {
    const state = only([]);
    const result = await registerDeadline(state, arriving);
    const scored = evaluationOf(result, state.alerts);
    expect(scored, "registering a deadline inside a threshold produced no evaluation").toBeDefined();
    expect(scored?.severity).toBe("major");
    expect(scored?.fingerprint.endsWith("document:555:expiry")).toBe(true);
  });

  it("scores it exactly as the next sweep would", async () => {
    const state = only([]);
    const scored = evaluationOf(await registerDeadline(state, arriving), state.alerts);
    const swept = (await sweep({ ...state, registrations: [arriving] })).alerts[0];
    expect(scored?.fingerprint).toBe(swept.fingerprint);
    expect(scored?.severity).toBe(swept.severity);
  });

  it("scores nothing for a deadline still outside every threshold", async () => {
    // The negative half, without which "evaluates immediately" could pass by
    // alerting on everything registered.
    const state = only([]);
    const result = await registerDeadline(state, FAR_DOC);
    expect(evaluationOf(result, state.alerts)).toBeUndefined();
  });

  it("scores an overdue arrival at once, at the highest configured severity", async () => {
    // ADDED. The document that arrives already expired is the case
    // evaluate-on-register exists for: an ingested passport whose expiry was
    // last month must not wait for 02:00. spec:48 gives the severity.
    const state = only([], [threshold("expiry", 10, "minor"), threshold("expiry", 3, "major")]);
    const lapsed = deadline("document:556", "expiry", d("2026-08-06"));
    const scored = evaluationOf(await registerDeadline(state, lapsed), state.alerts);
    expect(scored, "an already-expired arrival scored nothing").toBeDefined();
    expect(scored?.severity).toBe("major");
  });

  it("puts a registered deadline into the next sweep, and a deregistered one out of it", async () => {
    // The register/deregister pair from the spec's Owns table:19, round-tripped
    // through the store the module was handed. Nothing else in this file
    // depends on registration being a write, which is why it is pinned once.
    const state = only([]);
    await registerDeadline(state, arriving);
    const after = await sweep(state);
    expect(fingerprints(after).some((f) => f.endsWith("document:555:expiry"))).toBe(true);

    await deregisterDeadline(state, arriving);
    expect((await sweep(state)).alerts).toEqual([]);
  });
});
