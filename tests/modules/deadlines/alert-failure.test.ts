// Assertions 2, 3 and 4 of
// tasks/backlog.yaml#deadlines-alert-contract-scope-and-failure:
//
//   2. "A sweep whose alert call fails still reaches reportRun, and still
//       reports every other area"
//   3. "An area whose alert call failed is reported incomplete, so absence never
//       resolves an alert the run failed to raise"
//   4. "An area that was checked and had nothing to report stays complete, and
//       absence there does resolve"
//
// ADR-040(3): "A failed alert call does not abort the run. The sweep carries on
// and still reports — a partial run reported honestly beats every jurisdiction
// going dark for one failure, which is the same reasoning that made
// completeness scoped rather than global (2026-08-14)." And its consequence,
// which ADR-040 calls derived rather than separate: "An area whose alert could
// not be raised was not fully checked, so the run reports that area incomplete
// — otherwise (3) silently undoes (1), by letting absence close an alert the
// run failed to raise."
//
// WHAT THE MERGED MODULE DID INSTEAD, and the regression these cases lock out:
// `runDeadlineSweep` had no try/catch anywhere, and both misconfiguration
// raises preceded `reportRun`. One Alert Manager failure on one jurisdiction's
// missing calendar therefore took EVERY jurisdiction dark — no report at all,
// which flows-alerting.md treats as a source going dark and which freezes every
// open alert in the system. That is the exact outcome scoped completeness was
// introduced to prevent on 2026-08-14, arriving through a different door.
//
// THE TWO HALVES PULL IN OPPOSITE DIRECTIONS AND BOTH ARE ASSERTED HERE.
// Carrying on must not become "carry on and declare everything checked"
// (assertion 3), and reporting a failed area incomplete must not become "one
// failure freezes the whole world" (assertion 4). Every failure case below has
// a healthy area asserted beside the broken one, and vice versa.
//
// OUT OF SCOPE, deliberately: a `reportRun` that itself fails, which this node
// does not cover; and a run in which EVERY area ends up incomplete, which
// ADR-040 lists under "Not settled here" — whether that is a run reported with
// every area incomplete or no run at all. Every scenario below leaves at least
// one area complete, so none of them depends on that being settled either way.
//
// Where the area travels — the `areas` argument itself — is alert-scope.test.ts.
import { describe, expect, it } from "vitest";
import {
  AE,
  BH,
  KW,
  MISSING_CALENDAR_POLICY,
  NO_THRESHOLD_POLICY,
  SA,
  alertEngine,
  breaching,
  clear,
  onlyRun,
  raisesFor,
  reportedBreach,
  requireAreas,
  runsSince,
  scenario,
  scopeFor,
  scopedJurisdictions,
  sorted,
  sweep,
  unwatched,
  type BusinessCalendar,
  type Registration,
} from "./alert-contract-surface";

/** An engine that refuses the missing-calendar alert and nothing else. */
const refusesCalendarAlert = () => alertEngine({ policies: [MISSING_CALENDAR_POLICY] });
/** An engine that refuses the unconfigured-type alert and nothing else. */
const refusesThresholdAlert = () => alertEngine({ policies: [NO_THRESHOLD_POLICY] });

describe("a failed alert call never ends the run", () => {
  it("still sends its report when the missing-calendar alert rejects", async () => {
    // The regression, stated at its narrowest. Before ADR-040 this run threw
    // out of `runDeadlineSweep` at the raise and `reportRun` was never reached,
    // so the Alert Manager saw no report — and "No report at all never
    // resolves… the alerts freeze open as STALE" (flows-alerting.md), for every
    // jurisdiction, because of one refused alert about Kuwait.
    const state = scenario(
      [breaching("document:123", "AE"), breaching("document:111", "KW")],
      [AE],
      refusesCalendarAlert(),
    );
    await sweep(state);

    expect(raisesFor(state.alerts, MISSING_CALENDAR_POLICY).map((call) => call.failed)).toEqual([true]);
    expect(state.alerts.runs, "the refused alert took the whole run down with it").toHaveLength(1);
  });

  it("resolves rather than rejecting, and returns the run it made", async () => {
    // The caller of `runDeadlineSweep` is a scheduled job (operations-scheduling.md).
    // A rejection there is an operational failure that gets retried and paged
    // on; a partial run reported honestly is neither. The returned report must
    // also be the run that was sent, not a second opinion about it.
    const state = scenario(
      [breaching("document:123", "AE"), breaching("document:111", "KW")],
      [AE],
      refusesCalendarAlert(),
    );

    const report = await sweep(state);
    const run = onlyRun(state.alerts);
    expect(report.runId).toBe(run.runId);
    expect(report.sourceId).toBe(run.sourceId);
  });

  it("still reports every other area when two alerts are refused", async () => {
    // "and still reports every other area". Two broken jurisdictions, both of
    // whose alerts are refused, and two healthy ones that must come through
    // untouched — the breach set, and the scope declaration that lets absence
    // act on it.
    const state = scenario(
      [
        breaching("document:1", "AE"),
        breaching("document:2", "SA"),
        breaching("document:3", "KW"),
        breaching("document:4", "BH"),
      ],
      [AE, SA],
      refusesCalendarAlert(),
    );
    await sweep(state);

    const run = onlyRun(state.alerts);
    expect(reportedBreach(run, "document:1:expiry"), "AE went dark with KW and BH").toBe(true);
    expect(reportedBreach(run, "document:2:expiry"), "SA went dark with KW and BH").toBe(true);
    expect(scopeFor(run, "AE")?.complete).toBe(true);
    expect(scopeFor(run, "SA")?.complete).toBe(true);
  });

  it("still sends its report when the unconfigured-type alert rejects", async () => {
    // The second raise site. It runs after the jurisdiction loop and
    // immediately before `reportRun`, so an unguarded rejection there loses the
    // report having already done all the work of computing it.
    const state = scenario(
      [breaching("document:1", "AE"), unwatched("document:2", "AE"), breaching("document:3", "SA")],
      [AE, SA],
      refusesThresholdAlert(),
    );
    await sweep(state);

    expect(raisesFor(state.alerts, NO_THRESHOLD_POLICY).map((call) => call.failed)).toEqual([true]);
    expect(state.alerts.runs).toHaveLength(1);
  });

  it("still reports a breach it did score in an area whose alert was refused", async () => {
    // AE was scored — the run measured that visa and found it breaching. The
    // refused alert is about a DIFFERENT fault in the same area (a deadline
    // type nobody configured), and dropping the finding the run did make would
    // lose a real breach to an unrelated failure. The scope's completeness
    // carries the caveat; the breach set carries what was found.
    const state = scenario(
      [breaching("document:1", "AE"), unwatched("document:2", "AE"), breaching("document:3", "SA")],
      [AE, SA],
      refusesThresholdAlert(),
    );
    await sweep(state);

    expect(reportedBreach(onlyRun(state.alerts), "document:1:expiry")).toBe(true);
  });

  it("goes on raising the other misconfiguration after the first one is refused", async () => {
    // Carrying on means carrying on through the rest of the alert path, not
    // just as far as `reportRun`. A missing calendar in Kuwait and an
    // unconfigured type in the UAE are unrelated faults; one being refused must
    // not silence the other, or a single flaky alert hides a second, permanent
    // misconfiguration for as long as it lasts.
    const state = scenario(
      [breaching("document:1", "AE"), unwatched("document:2", "AE"), breaching("document:3", "KW")],
      [AE],
      refusesCalendarAlert(),
    );
    await sweep(state);

    expect(raisesFor(state.alerts, MISSING_CALENDAR_POLICY)).toHaveLength(1);
    expect(raisesFor(state.alerts, NO_THRESHOLD_POLICY), "the second fault was never raised").toHaveLength(1);
    expect(state.alerts.runs).toHaveLength(1);
  });

  it("survives a raiseAlert that throws before it returns a promise", async () => {
    // A client failing synchronously — a bad argument, a null dependency, a
    // module that has not finished initialising — is a different code path from
    // one returning a rejected promise, and a `.catch()` attached to the call
    // survives only the second. Both are the Alert Manager failing, and
    // ADR-040(3) does not distinguish them.
    const state = scenario(
      [breaching("document:1", "AE"), breaching("document:2", "KW")],
      [AE],
      alertEngine({ policies: [MISSING_CALENDAR_POLICY], mode: "throw" }),
    );

    await sweep(state);
    const run = onlyRun(state.alerts);
    expect(reportedBreach(run, "document:1:expiry")).toBe(true);
    expect(scopeFor(run, "AE")?.complete).toBe(true);
  });
});

describe("an area whose alert failed is reported incomplete", () => {
  /**
   * The hard case, and the reason this is not a one-line change.
   *
   * AE and KW both hold a deadline of an unconfigured type, so the single
   * `no-threshold` alert's areas are both of them. Both were also scored
   * perfectly well and would have been declared COMPLETE by the time that alert
   * is raised. The refusal therefore has to reach BACK and downgrade two scopes
   * the run had already finished — not append a second, contradictory row for
   * each, which would leave the Alert Manager choosing between two answers for
   * one jurisdiction and would make `complete` depend on which it read.
   *
   * BH holds only a configured type and is the control: it is not in the
   * refused alert's areas and must be untouched by it.
   */
  const spanningRefusal = () =>
    scenario(
      [
        breaching("document:1", "AE"),
        unwatched("document:2", "AE"),
        unwatched("document:3", "KW"),
        breaching("document:4", "BH"),
      ],
      [AE, KW, BH],
      refusesThresholdAlert(),
    );

  it("downgrades every area the refused alert named, including ones already scored", async () => {
    const state = spanningRefusal();
    await sweep(state);

    const run = onlyRun(state.alerts);
    expect(scopeFor(run, "AE")?.complete, "AE was scored, so it was declared complete and left there").toBe(false);
    expect(scopeFor(run, "KW")?.complete).toBe(false);
  });

  it("reports exactly one RunScope per jurisdiction — a downgrade, never a second row", async () => {
    // `RunScope` is the unit of completeness, and two rows for one jurisdiction
    // is not a scope declaration, it is an ambiguity. An engine reading
    // `scopes.find(row => row.jurisdictionId === "AE")` would resolve by
    // absence or not depending on emission order.
    const state = spanningRefusal();
    await sweep(state);

    const run = onlyRun(state.alerts);
    const declared = scopedJurisdictions(run);
    expect(sorted(declared), "one row per jurisdiction holding a registration").toEqual(["AE", "BH", "KW"]);
    expect(declared, "a jurisdiction was declared twice").toHaveLength(new Set(declared).size);
  });

  it("names the policy in the reason, so the gap is diagnosable", async () => {
    // `RunScope.reason` is the only channel that says WHY an area went
    // unchecked, and "an area whose alert failed" and "an area with no
    // calendar" need different remedies — one is an Alert Manager outage, the
    // other a missing configuration row. A reason that does not name the policy
    // sends whoever reads it looking at the calendars.
    const state = spanningRefusal();
    await sweep(state);

    const reason = scopeFor(onlyRun(state.alerts), "AE")?.reason;
    expect(reason, "an incomplete scope with no reason").toBeDefined();
    expect(reason).toContain(NO_THRESHOLD_POLICY);
  });

  it("leaves an area the refused alert did not name complete and unexplained", async () => {
    // The over-correction guard for the downgrade. BH is not in the refused
    // alert's areas: it was checked, and marking it incomplete would strand
    // every open BH alert as STALE for a fault in two other countries — the
    // same all-or-nothing failure ADR-040(3) exists to stop, arriving from the
    // other side.
    const state = spanningRefusal();
    await sweep(state);

    const bh = scopeFor(onlyRun(state.alerts), "BH");
    expect(bh?.complete).toBe(true);
    expect(bh?.reason, "a complete scope needs no excuse").toBeUndefined();
  });

  it("keeps those same areas complete when the same alert succeeds", async () => {
    // The discriminator. Without it, "downgrade on failure" is satisfied by a
    // module that marks every jurisdiction holding an unconfigured type
    // incomplete unconditionally — which would stop absence resolving anything
    // in a jurisdiction with one stale Settings row, permanently.
    const state = scenario(
      [
        breaching("document:1", "AE"),
        unwatched("document:2", "AE"),
        unwatched("document:3", "KW"),
        breaching("document:4", "BH"),
      ],
      [AE, KW, BH],
    );
    await sweep(state);

    const run = onlyRun(state.alerts);
    expect(raisesFor(state.alerts, NO_THRESHOLD_POLICY).map((call) => call.failed)).toEqual([false]);
    for (const jurisdiction of ["AE", "BH", "KW"]) {
      expect(scopeFor(run, jurisdiction)?.complete, `${jurisdiction} was downgraded for nothing`).toBe(true);
      expect(scopeFor(run, jurisdiction)?.reason).toBeUndefined();
    }
  });

  it("leaves a healthy area complete when another area's calendar alert is refused", async () => {
    // The same guard on the missing-calendar path. KW is unscorable and its
    // alert was refused; AE is neither, and one refusal about Kuwait must not
    // cost the UAE its resolution.
    const state = scenario(
      [breaching("document:1", "AE"), breaching("document:2", "KW")],
      [AE],
      refusesCalendarAlert(),
    );
    await sweep(state);

    const run = onlyRun(state.alerts);
    expect(scopeFor(run, "AE")?.complete).toBe(true);
    expect(scopeFor(run, "KW")?.complete).toBe(false);
    expect(scopedJurisdictions(run)).toHaveLength(2);
  });

  it("never resolves by absence in an area whose alert was refused", async () => {
    // The whole point of assertion 3, played out over two nights — the failure
    // it exists to prevent is not a wrong flag, it is a closed alert.
    //
    //   night 1 — everything healthy. A UAE visa breaches and its alert opens
    //             with the Alert Manager. SA breaches too and stays breaching.
    //   night 2 — the visa has been renewed, so its fingerprint is ABSENT from
    //             the breach set. A deadline of an unconfigured type has since
    //             been registered in the UAE, and the Alert Manager refuses
    //             that alert.
    //
    // If AE were still reported complete, absence would close the visa alert on
    // a night the run could not raise everything it had to raise. It must stay
    // open and be marked STALE instead. SA is the control: it was checked, its
    // breach is still there, and it is untouched.
    const state = scenario(
      [breaching("document:1", "AE"), breaching("document:2", "SA")],
      [AE, SA],
      refusesThresholdAlert(),
    );
    const firstNight = await sweep(state);
    const visa = firstNight.breaches.find((alert) => alert.fingerprint.endsWith("document:1:expiry"));
    expect(visa, "the visa never breached, so nothing was at risk of closing").toBeDefined();

    const renewed = clear("document:1", "AE");
    await sweep({
      ...state,
      registrations: [renewed, breaching("document:2", "SA"), unwatched("document:3", "AE")],
    });

    expect(runsSince(state.alerts, 1), "the second night sent no report").toHaveLength(1);
    expect(raisesFor(state.alerts, NO_THRESHOLD_POLICY).map((call) => call.failed)).toEqual([true]);
    const status = state.alerts.stateOf(visa!.fingerprint)?.status;
    expect(status, "absence closed an alert on a night the run could not raise its alerts").not.toBe(
      "resolved",
    );
    expect(status).toBe("stale");
    expect(state.alerts.resolved, "the module resolved an alert directly").toEqual([]);
  });
});

describe("an area that was checked and had nothing to report stays complete", () => {
  it("declares an area with no breaches complete, with no reason, beside a refused alert", async () => {
    // Assertion 4. "An empty report is meaningful: it says 'I ran, nothing is
    // wrong'" (components-core-deadline-monitor.md) — and it says that PER
    // AREA. AE has one deadline, months away and clear. It was checked, it had
    // nothing to say, and a run that also hit an Alert Manager failure
    // elsewhere must not turn that silence into "not looked at".
    const state = scenario(
      [clear("document:1", "AE"), breaching("document:2", "KW")],
      [AE],
      refusesCalendarAlert(),
    );
    await sweep(state);

    const run = onlyRun(state.alerts);
    const ae = scopeFor(run, "AE");
    expect(ae?.complete).toBe(true);
    expect(ae?.reason).toBeUndefined();
    expect(reportedBreach(run, "document:1:expiry"), "a clear deadline was reported as breaching").toBe(false);
  });

  it("resolves by absence there, even in a run whose alert call failed", async () => {
    // The other half of assertion 4, and the guard against the safest-looking
    // wrong fix: treating any alert failure as "this run checked nothing".
    //
    //   night 1 — AE and SA both breach; both alerts open.
    //   night 2 — the AE document is renewed and is absent from the breach set.
    //             Kuwait has appeared with no business calendar, and the Alert
    //             Manager refuses that alert.
    //
    // AE was checked and found clear, so its alert CLOSES. The failure was
    // about Kuwait and stays about Kuwait.
    const state = scenario(
      [breaching("document:1", "AE"), breaching("document:2", "SA")],
      [AE, SA],
      refusesCalendarAlert(),
    );
    const firstNight = await sweep(state);
    const doc = firstNight.breaches.find((alert) => alert.fingerprint.endsWith("document:1:expiry"));
    expect(doc, "nothing opened on the first night").toBeDefined();

    await sweep({
      ...state,
      registrations: [clear("document:1", "AE"), breaching("document:2", "SA"), breaching("document:3", "KW")],
    });

    expect(raisesFor(state.alerts, MISSING_CALENDAR_POLICY).map((call) => call.failed)).toEqual([true]);
    expect(
      state.alerts.stateOf(doc!.fingerprint)?.status,
      "one refused alert about Kuwait froze a UAE alert the run did check",
    ).toBe("resolved");
  });

  it("resolves by absence in an area whose unconfigured-type alert succeeded", async () => {
    // An area holding a type nobody configured was still CHECKED — the
    // misconfiguration was raised, and raised successfully. Absence resolves
    // there exactly as anywhere else. This is the negative that stops the
    // downgrade rule being implemented as "an unconfigured type makes its
    // jurisdictions incomplete", which would be a permanent freeze rather than
    // a per-failure one.
    const state = scenario([breaching("document:1", "AE"), breaching("document:2", "SA")], [AE, SA]);
    const firstNight = await sweep(state);
    const doc = firstNight.breaches.find((alert) => alert.fingerprint.endsWith("document:1:expiry"));
    expect(doc).toBeDefined();

    await sweep({
      ...state,
      registrations: [clear("document:1", "AE"), breaching("document:2", "SA"), unwatched("document:3", "AE")],
    });

    expect(raisesFor(state.alerts, NO_THRESHOLD_POLICY).map((call) => call.failed)).toEqual([false]);
    expect(state.alerts.stateOf(doc!.fingerprint)?.status).toBe("resolved");
  });
});

describe("the invariants, over every combination of faults and refusals", () => {
  // A property, enumerated exhaustively rather than sampled, because the space
  // is small and a fixed enumeration is reproducible. Four jurisdictions, each
  // holding one watched deadline; a subset missing its calendar, a subset also
  // holding a deadline of an unconfigured type, and each of the four ways the
  // Alert Manager can refuse.
  //
  // The claim under test is a TOTAL one, which no single example makes:
  //
  //     an area is complete  <=>  it could be scored, AND no alert naming it
  //                               was refused
  //
  // Both directions matter and they are the two failure modes this node sits
  // between — "complete when it should not be" closes an alert nobody checked,
  // "incomplete when it should not be" freezes an area the run did check.
  const CALENDARS: Record<string, BusinessCalendar> = { AE, KW, BH, SA };
  const ALL = ["AE", "KW", "BH", "SA"];
  const withoutCalendar: readonly string[][] = [[], ["KW"], ["BH"], ["KW", "BH"]];
  const withUnwatched: readonly string[][] = [[], ["AE"], ["AE", "SA"], ["BH", "SA"]];
  const refusals: readonly string[][] = [
    [],
    [MISSING_CALENDAR_POLICY],
    [NO_THRESHOLD_POLICY],
    [MISSING_CALENDAR_POLICY, NO_THRESHOLD_POLICY],
  ];

  type Case = { blind: readonly string[]; unwatchedIn: readonly string[]; refuses: readonly string[] };

  const cases: Case[] = withoutCalendar.flatMap((blind) =>
    withUnwatched.flatMap((unwatchedIn) => refusals.map((refuses) => ({ blind, unwatchedIn, refuses }))),
  );

  /**
   * Which areas the run may declare complete, derived from the WORLD rather
   * than from what the module reported: an area with no calendar was never
   * scored, and an area named by a REFUSED alert was not fully checked
   * (ADR-040, "Consequences").
   *
   * Computed at collection time, not inside the case, because it decides
   * whether the combination is one this node may assert at all.
   */
  const completeAreas = ({ blind, unwatchedIn, refuses }: Case): string[] => {
    const refused = new Set<string>();
    if (refuses.includes(MISSING_CALENDAR_POLICY)) for (const id of blind) refused.add(id);
    if (refuses.includes(NO_THRESHOLD_POLICY)) for (const id of unwatchedIn) refused.add(id);
    return ALL.filter((id) => !blind.includes(id) && !refused.has(id));
  };

  for (const scenarioCase of cases) {
    const { blind, unwatchedIn, refuses } = scenarioCase;
    const expectComplete = completeAreas(scenarioCase);

    // A run in which NO area comes out complete is the one thing ADR-040
    // expressly leaves open: "Whether a run in which every alert call failed
    // should still count as a run — reported, with every area incomplete — or
    // as no run at all." Asserting either way here would invent the decision.
    //
    // SKIPPED RATHER THAN DROPPED, on purpose. A silent `return` inside the
    // body reads as a passing assertion and is worth nothing; a skip says in
    // the report that this combination is waiting on a decision, and it is the
    // placeholder to un-skip the day that decision lands. It still counts in
    // the total, so the "did everything run" ratchet is unaffected either way.
    const runCase = expectComplete.length === 0 ? it.skip : it;
    const openQuestion = expectComplete.length === 0 ? " — every area incomplete, left open by ADR-040" : "";
    const name =
      `no calendar in [${blind}], unconfigured type in [${unwatchedIn}], ` +
      `the Alert Manager refuses [${refuses}]${openQuestion}`;

    runCase(name, async () => {
      const registrations: Registration[] = ALL.map((id, index) => breaching(`document:${index}`, id));
      for (const [index, id] of unwatchedIn.entries()) {
        registrations.push(unwatched(`document:9${index}`, id));
      }
      const calendars = ALL.filter((id) => !blind.includes(id)).map((id) => CALENDARS[id]);
      const state = scenario(registrations, calendars, alertEngine({ policies: refuses }));

      await sweep(state);
      const run = onlyRun(state.alerts);

      expect(sorted(scopedJurisdictions(run)), "one scope row per jurisdiction with a registration").toEqual(
        ALL.slice().sort(),
      );
      expect(scopedJurisdictions(run), "a jurisdiction was declared twice").toHaveLength(
        new Set(scopedJurisdictions(run)).size,
      );

      for (const id of ALL) {
        const scope = scopeFor(run, id);
        const shouldBeComplete = expectComplete.includes(id);
        expect(scope?.complete, `${id}: complete should be ${shouldBeComplete}`).toBe(shouldBeComplete);
        if (shouldBeComplete) {
          expect(scope?.reason, `${id} is complete and still carries a reason`).toBeUndefined();
        } else {
          expect(scope?.reason, `${id} is incomplete and says nothing about why`).toBeTruthy();
        }
      }

      // The other half of the same claim: every area a refused alert NAMED is
      // one of the areas that came back incomplete. This is what ties the
      // `areas` argument to the completeness declaration — the two halves of
      // ADR-040 have to agree, or the scope on the alert and the scope on the
      // report are two different vocabularies.
      for (const call of state.alerts.raised.filter((raise) => raise.failed)) {
        for (const area of requireAreas(call)) {
          expect(scopeFor(run, area)?.complete, `${area} was named by a refused alert`).toBe(false);
        }
      }
    });
  }
});
