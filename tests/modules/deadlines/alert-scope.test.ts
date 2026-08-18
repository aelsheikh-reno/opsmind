// Assertion 1 of tasks/backlog.yaml#deadlines-alert-contract-scope-and-failure:
//
//   "raiseAlert takes the area it applies to as a named argument, and no scope
//    is ever read back out of context"
//
// ADR-040(2), verbatim: "The area is a named argument on `raiseAlert`, not
// something read back out of `context`. The Alert Manager must never parse a
// caller's context bag: that bakes one caller's vocabulary into a component
// built to serve several (ADR-039), and a caller that spells the key
// differently silently loses its scoping."
//
// WHAT THE MERGED MODULE DID INSTEAD. `raiseAlert(fingerprint, severity,
// policyId, context)` carried no area at all: the jurisdiction sat inside the
// free-form context bag, where a generic engine has no licence to look for it.
// The signature is now
//
//     raiseAlert(fingerprint, severity, policyId, areas, context)
//
// with `areas` a list of OPAQUE scope keys in the same vocabulary as
// `RunScope.area` (flows-alerting.md, "The contract — three verbs"). It is a
// LIST because one alert legitimately spans several scopes: an unconfigured
// deadline type affects every jurisdiction holding one.
//
// That scope field was `RunScope.jurisdictionId` when these cases were written.
// ADR-043 renamed it to `area`, so that the port carries one vocabulary and
// none of it is OpsMind's. Nothing this file asserts changed with it — the
// cases below are about WHERE the scope travels and WHICH areas it names, and
// the field's name is pinned by alert-vocabulary.test.ts instead.
//
// The failure-handling half of ADR-040 — assertions 2, 3 and 4 — is in
// alert-failure.test.ts. Splitting them keeps a disagreement about WHERE the
// scope travels from failing every case about what a failure does.
import { describe, expect, it } from "vitest";
import {
  AE,
  BH,
  KW,
  MISSING_CALENDAR_POLICY,
  NO_THRESHOLD_POLICY,
  SA,
  alertEngine,
  areasOf,
  breaching,
  clear,
  contextOf,
  describeCall,
  onlyRaiseFor,
  policyOf,
  raisesFor,
  registerDeadline,
  requireAreas,
  scenario,
  sorted,
  sweep,
  unwatched,
} from "./alert-contract-surface";

describe("the area is an argument, in the position the contract fixes", () => {
  it("passes five arguments, with the areas before the context bag", async () => {
    // The shape assertion, on its own, so that a module still on the
    // four-argument signature fails ONE named case rather than every case in
    // this file with an undefined deref. Position matters as much as presence:
    // `areas` sits between `policyId` and `context`, which is what makes the
    // context bag the last thing an engine sees rather than the thing it has
    // to search.
    const state = scenario([breaching("document:123", "AE"), breaching("document:111", "KW")], [AE]);
    await sweep(state);

    const call = onlyRaiseFor(state.alerts, MISSING_CALENDAR_POLICY);
    expect(call.rest, describeCall(call)).toHaveLength(3);
    expect(policyOf(call)).toBe(MISSING_CALENDAR_POLICY);
    expect(areasOf(call), describeCall(call)).toBeDefined();
    expect(
      contextOf(call),
      "the fifth argument is not a context bag, so `areas` is not sitting before it",
    ).toBeDefined();
  });

  it("names exactly the one jurisdiction whose business calendar is missing", async () => {
    // "a missing business calendar raises with exactly that one jurisdiction".
    // The scope of this alert is a single area and nothing wider: the run
    // scored AE perfectly well, and an alert that claimed AE as its area would
    // let the Alert Manager treat a healthy jurisdiction as unchecked.
    const state = scenario(
      [breaching("document:123", "AE"), breaching("document:111", "KW")],
      [AE],
    );
    await sweep(state);

    const call = onlyRaiseFor(state.alerts, MISSING_CALENDAR_POLICY);
    expect(requireAreas(call)).toEqual(["KW"]);
  });

  it("scopes each broken jurisdiction to itself when two calendars are missing", async () => {
    // Two faults, two alerts, two disjoint single-area scopes — never one alert
    // claiming both, which would make resolving either depend on fixing both.
    const state = scenario(
      [breaching("document:123", "AE"), breaching("document:111", "KW"), breaching("document:211", "BH")],
      [AE],
    );
    await sweep(state);

    const calls = raisesFor(state.alerts, MISSING_CALENDAR_POLICY);
    expect(calls, "one broken jurisdiction should raise one alert").toHaveLength(2);
    for (const call of calls) {
      expect(requireAreas(call), "a missing calendar is a single-jurisdiction fault").toHaveLength(1);
    }
    expect(sorted(calls.flatMap((call) => requireAreas(call)))).toEqual(["BH", "KW"]);
  });

  it("names every distinct jurisdiction holding a registration of an unconfigured type", async () => {
    // "an unconfigured deadline type raises with EVERY distinct jurisdiction
    // holding a registration of that type, and it is genuinely more than one."
    // This is why `areas` is a list rather than a string: the fault is one
    // missing ThresholdTable row, and it leaves a deadline unwatched in three
    // countries at once. Reporting it against one of them — or against none —
    // would let absence resolve it inside the other two.
    //
    // SA holds only a configured type and must not appear: an area is what the
    // alert APPLIES to, not every area the run happened to visit.
    const state = scenario(
      [
        unwatched("document:1", "AE"),
        unwatched("document:2", "KW"),
        unwatched("document:3", "BH"),
        breaching("document:4", "SA"),
      ],
      [AE, KW, BH, SA],
    );
    await sweep(state);

    const call = onlyRaiseFor(state.alerts, NO_THRESHOLD_POLICY);
    const areas = requireAreas(call);
    expect(areas.length, "a one-area scope cannot express a fault spanning three").toBeGreaterThan(1);
    expect(sorted(areas)).toEqual(["AE", "BH", "KW"]);
    expect(areas, "SA's only deadline type is configured").not.toContain("SA");
  });

  it("names a jurisdiction once, however many registrations of the type it holds", async () => {
    // The areas are DISTINCT jurisdictions, not one entry per affected
    // deadline — the same flood argument that makes it one alert per
    // unconfigured type per run (components-core-deadline-monitor.md) rather
    // than one per deadline. A repeated key would also make the Alert Manager's
    // scope comparison quadratic in registrations for no information gained.
    const state = scenario(
      [
        unwatched("document:1", "AE"),
        unwatched("document:2", "AE"),
        unwatched("document:3", "AE"),
        unwatched("document:4", "KW"),
      ],
      [AE, KW],
    );
    await sweep(state);

    const areas = requireAreas(onlyRaiseFor(state.alerts, NO_THRESHOLD_POLICY));
    expect(sorted(areas)).toEqual(["AE", "KW"]);
  });

  it("names a jurisdiction that has no calendar among the areas of an unconfigured type", async () => {
    // The two faults are independent, and the areas follow the REGISTRATIONS
    // rather than the scoring. Kuwait's deadline of an unconfigured type is
    // unwatched whether or not Kuwait could be scored, and dropping it from the
    // areas would mean the one jurisdiction with two faults is the one the
    // second fault is silent about.
    const state = scenario([unwatched("document:1", "AE"), unwatched("document:2", "KW")], [AE]);
    await sweep(state);

    const areas = requireAreas(onlyRaiseFor(state.alerts, NO_THRESHOLD_POLICY));
    expect(sorted(areas)).toEqual(["AE", "KW"]);
  });

  it("treats an area as an opaque key: an id the module has never seen travels verbatim", async () => {
    // flows-alerting.md: "`areas` are the CALLER'S OWN opaque scope keys, in the
    // same vocabulary as reportRun's scopes. The engine compares them and never
    // interprets them." So nothing on this path may normalise, upper-case or
    // validate the key against a register of jurisdictions — the Alert Manager
    // matches it against `RunScope.area` by equality and by nothing
    // else, and a key rewritten on one path and not the other stops matching.
    // AE is present and healthy only so that the run has a complete scope: what
    // a run in which EVERY area is incomplete should do is expressly left open
    // by ADR-040 ("Not settled here"), and nothing in this directory asserts it.
    const odd = "tenant-7/region:north";
    const state = scenario([clear("document:0", "AE"), breaching("document:9", odd)], [AE]);
    await sweep(state);

    const call = onlyRaiseFor(state.alerts, MISSING_CALENDAR_POLICY);
    expect(requireAreas(call)).toEqual([odd]);
  });
});

describe("the scope never comes out of the context bag", () => {
  it("scopes every alert for an engine that discards context entirely", async () => {
    // ADR-039: the Alert Manager's reuse target is a package another
    // application imports, so it cannot know OpsMind's context vocabulary. The
    // engine here is exactly that engine — it drops the context argument on the
    // floor at the port — and it must still be able to place every alert in a
    // scope. A module that left the jurisdiction in `context` produces alerts
    // with an absent or empty `areas` here and nothing to place them by.
    const state = scenario(
      [
        breaching("document:1", "AE"),
        unwatched("document:2", "AE"),
        unwatched("document:3", "BH"),
        breaching("document:4", "KW"),
      ],
      [AE, BH],
      alertEngine({ blindToContext: true }),
    );
    await sweep(state);

    expect(state.alerts.raised, "no alert was raised at all").not.toHaveLength(0);
    for (const call of state.alerts.raised) {
      expect(requireAreas(call), `${policyOf(call)} arrived with an empty scope`).not.toHaveLength(0);
    }
    expect(requireAreas(onlyRaiseFor(state.alerts, MISSING_CALENDAR_POLICY))).toEqual(["KW"]);
    expect(sorted(requireAreas(onlyRaiseFor(state.alerts, NO_THRESHOLD_POLICY)))).toEqual(["AE", "BH"]);
  });

  it("gives a multi-area alert no single context key to be dug out of", async () => {
    // The concrete form of "a caller that spells the key differently silently
    // loses its scoping". An engine reading a scalar `context.jurisdictionId` —
    // the spelling the pre-ADR-040 module used, and the one any OpsMind-shaped
    // engine would reach for first — cannot express this alert's scope at all,
    // because the fault spans three jurisdictions. Whatever the context bag
    // carries for diagnosis, the SCOPE is the argument and only the argument.
    const state = scenario(
      [unwatched("document:1", "AE"), unwatched("document:2", "KW"), unwatched("document:3", "BH")],
      [AE, KW, BH],
    );
    await sweep(state);

    const call = onlyRaiseFor(state.alerts, NO_THRESHOLD_POLICY);
    expect(sorted(requireAreas(call))).toEqual(["AE", "BH", "KW"]);
    expect(
      typeof contextOf(call)?.jurisdictionId,
      "a scalar jurisdiction key on an alert spanning three jurisdictions is a scope " +
        "that reads as one area to anything that digs for it",
    ).not.toBe("string");
  });

  it("names the area on an alert raised at registration time too", async () => {
    // ADR-040 is titled "An alert names the area it was raised in" — every
    // alert, not only the sweep's two misconfigurations. A document ingested
    // already inside a threshold is scored inline and raised out of band
    // (components-core-deadline-monitor.md, evaluate-on-register); that alert
    // is scoped to the jurisdiction whose calendar measured it, and tonight's
    // sweep either confirms it or resolves it within that same scope.
    const state = scenario([], [BH]);
    await registerDeadline(state, breaching("document:77", "BH"));

    expect(state.alerts.raised, "an inline breach raised nothing").toHaveLength(1);
    const call = state.alerts.raised[0];
    expect(call.rest, describeCall(call)).toHaveLength(3);
    expect(requireAreas(call)).toEqual(["BH"]);
  });
});
