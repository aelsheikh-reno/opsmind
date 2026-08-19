// Assertion 1 of tasks/backlog.yaml#service-alerts-surface-and-lifecycle:
//
//   "The service's client satisfies the deadline monitor's AlertManager port
//    exactly, and the compiler is what proves it"
//
// WHY THE COMPILER RATHER THAN A SHAPE CHECK. The node's own note: "IT IS
// WRITTEN TO A PORT THAT IS ALREADY IN PRODUCTION… module-deadlines is merged
// and calls reportRun and raiseAlert against nothing. The port is therefore not
// negotiable and not a draft: the compiler check that the client is assignable
// to the module's AlertManager type is the node's first assertion, because a
// signature disagreement discovered later is a change to a merged compliance
// module."
//
// A runtime `typeof client.reportRun === "function"` cannot see the difference
// between `reportRun(sourceId, runId, alerts, scopes)` and one whose third
// argument is a `Record<string, unknown>` — both are functions. So the binding
// on line ~60 is the assertion, it carries NO cast, and `npm run typecheck`
// fails on it if the two signatures ever disagree. Everything else in this file
// is the behaviour that binding buys.
//
// Written from the specification alone: no file under lib/services/alerts/ was
// read. The port was read from lib/modules/deadlines/index.ts, which the node
// lists under also_read and which is this file's whole subject.
import { describe, expect, it } from "vitest";

import {
  MISSING_CALENDAR_POLICY,
  runDeadlineSweep,
  type AlertManager,
  type CalendarSource,
  type DeadlineDeps,
  type DeadlineStore,
  type Registration,
  type ThresholdRule,
} from "@/lib/modules/deadlines";

// THE ONE PLACE THIS DIRECTORY NAMES A FUNCTION OF THE SERVICE DIRECTLY.
// Everywhere else goes through ./surface, which accepts more than one spelling;
// here it cannot, because a dynamically resolved value is `unknown` and the
// compiler would have nothing to check. If the factory is spelled differently,
// this import is the single line that moves.
import { createAlertManager, type AlertManagerClient } from "@/lib/services/alerts";

import { GULF, calendar, d, deadline, threshold } from "@/tests/modules/deadlines/surface";

import { AREA, FP_A, MAJOR, POLICY, PORT_VERBS, SOURCE, client } from "./surface";

// --------------------------------------------------------- the binding --

/**
 * THE ASSERTION, HALF ONE: the client is no NARROWER than the port.
 *
 * No `as`, no `satisfies`, no cast: the client is assigned to the merged
 * module's own port type, so `tsc --noEmit` is what rejects the disagreement.
 * This direction catches a client that demands MORE or DIFFERENT than the
 * deadline monitor supplies — an extra required parameter, a narrowed one
 * (`areas: string` where ADR-040 says a list), a parameter type whose field is
 * spelled differently (`jurisdictionId`, ADR-043), a verb that is missing, or
 * one that stops returning `Promise<void>`. Each of those was mutated and each
 * one fails here.
 */
const bound: AlertManager = createAlertManager({ sourceId: SOURCE });

/**
 * THE ASSERTION, HALF TWO: the client is no WIDER than the port — and this is
 * the half that catches a DROPPED TRAILING PARAMETER.
 *
 * DO NOT DELETE THIS AS REDUNDANT. It is not. TypeScript deliberately lets an
 * implementation with FEWER parameters satisfy a wider signature — that is what
 * makes `array.map((x) => x)` legal — so the binding above is ONE-DIRECTIONAL.
//
// WHEN THIS GOES RED BECAUSE THE CLIENT GREW A VERB, the answer is neither to
// delete it nor to cast past it — both reopen the hole above. `AlertManager` is
// the deadline monitor's two-verb view; the client is documented at five, and
// service-alerts-raise adds `resolveAlert` next. At that point make the probe's
// target `Pick<AlertManagerClient, "reportRun" | "raiseAlert">`, which keeps the
// no-wider check on exactly the verbs the port declares and lets the client grow
// past it. TS2741 on this line is that moment, not a failure.
 * Delete `scopes` from `AlertManagerClient.reportRun` and half one still
 * compiles, every runtime case still passes, and the type error the node's
 * first assertion promised never arrives.
 *
 * MEASURED, NOT REASONED, on 2026-08-19 by dropping `scopes` from
 * AlertManagerClient.reportRun and running `npm run typecheck` and
 * `npx vitest run tests/services/alerts` in each of three states:
 *   · dropped, this line ABSENT   -> tsc exit 0, no errors, 84 tests passed
 *   · dropped, this line PRESENT  -> tsc FAILS at this line,
 *       `error TS2322: Type 'AlertManager' is not assignable to type
 *        'AlertManagerClient'` — while the runtime suite STILL says 84 passed,
 *        because there is nothing at run time to see
 *   · restored, this line present -> tsc exit 0, 84 tests passed
 * The middle row is the only thing standing between a dropped completeness
 * declaration and a green pipeline.
 *
 * That parameter is not a detail. `scopes` is the completeness declaration, and
 * "absence from a COMPLETE report resolves" is the whole basis on which this
 * engine is allowed to close a compliance alert (flows-alerting.md, ADR-040).
 * Two nodes were spent building it and renaming its field. An edit that dropped
 * it would leave the merged sweep compiling and passing scopes into a void, and
 * a second codebase importing this package would never learn they exist —
 * every gate green.
 *
 * WHY THE CAST IS SOUND HERE, and why it does not contradict "no cast" above.
 * What is being tested is a relationship between two TYPES, not the behaviour
 * of a value; the cast only manufactures a value of the port type so that the
 * assignment on the left has something to check, and that value is never
 * called. The assignment itself is uncast, and it is the assertion.
 *
 * WHAT THE Pick<> NARROWED, AND WHAT IT DID NOT, since narrowing an existing
 * assertion is not something to do in passing. Before service-alerts-raise the
 * target was the whole `AlertManagerClient`, and the pair proved mutual
 * assignability outright. The client then grew `resolveAlert` — flows-alerting.md
 * fixes FIVE verbs, so it was always going to — and `AlertManager`, which
 * declares two, stopped being assignable to it. The two-verb exactness claim was
 * only ever accidentally true: it held because the client had not yet grown.
 *
 * So this now proves the narrower and correct thing: FOR THE VERBS THE PORT
 * DECLARES, the two agree exactly. It no longer proves the client carries only
 * those verbs, and it should not — the client legitimately carries more.
 *
 * IT STILL CATCHES WHAT IT WAS BUILT FOR. Measured: dropping `scopes` from
 * `reportRun` on the client fails to compile on this line, TS2322. That is the
 * completeness declaration two nodes were spent building and renaming, and the
 * one-directional binding above cannot see it go.
 */
const reverseProbe: Pick<AlertManagerClient, "reportRun" | "raiseAlert"> = {} as AlertManager;

describe("the client satisfies the AlertManager port the deadline monitor already calls", () => {
  it("is assignable to the port with no cast, which is the compile-time half made visible", () => {
    // The runtime half of the line above. It cannot prove the signatures match
    // — only the compiler can — but it fails loudly if the binding compiles
    // against something that is not there at run time, which is what a type-only
    // export or a mis-shaped default would produce.
    expect(typeof bound.reportRun, "AlertManager.reportRun").toBe("function");
    expect(typeof bound.raiseAlert, "AlertManager.raiseAlert").toBe("function");
  });

  it("is assignable in BOTH directions, which is what makes it exact", () => {
    // The runtime half of the reverse probe, and it is deliberately thin: there
    // is nothing at run time to see, because the claim is that two types are
    // mutually assignable and types do not exist at run time. The case is here
    // so the probe is referenced by something a reader will find, and so that
    // deleting the probe fails a named case rather than quietly removing the
    // only guard on a dropped trailing parameter.
    expect(reverseProbe, "the reverse probe is what catches a dropped `scopes`").toBeDefined();
    expect(PORT_VERBS).toEqual(["reportRun", "raiseAlert"]);
  });

  it("publishes the two verbs the merged module already calls", () => {
    // The port is two of the contract's five — flows-alerting.md and
    // components-services.md:24 give "reportRun · raiseAlert · resolveAlert ·
    // acknowledge · suppress" — because the deadline monitor is a SOURCE and
    // never touches lifecycle (lib/modules/deadlines/index.ts).
    //
    // THE OTHER THREE ARE NOT ASKED FOR HERE, deliberately: the graph gives
    // resolveAlert to service-alerts-raise and acknowledge/suppress to
    // service-alerts-acknowledge-suppress, and a case demanding them at this
    // node would fail work that is correctly somewhere else. What this node owes
    // is the two the merged module is calling against nothing today.
    const surface = client();
    for (const name of PORT_VERBS) {
      expect(typeof surface[name], `the client has no ${name}()`).toBe("function");
    }
  });

  it("answers both port verbs with a promise, because every caller awaits them", () => {
    // `AlertManager.reportRun` and `.raiseAlert` are declared `Promise<void>`,
    // and runDeadlineSweep awaits both. A verb that answered synchronously
    // would satisfy `await` by accident and break the moment the store lands.
    const reported = bound.reportRun(SOURCE, "run-1", [], []);
    const raised = bound.raiseAlert(FP_A, MAJOR, POLICY, [AREA], {});
    expect(reported, "reportRun did not return a promise").toBeInstanceOf(Promise);
    expect(raised, "raiseAlert did not return a promise").toBeInstanceOf(Promise);
    return Promise.all([reported, raised]);
  });
});

// ------------------------------------------------- the merged module calling --

const WATCHED = "expiry";
const TODAY = d("2026-08-16");
/** Four business days out under the Sunday–Thursday week — inside the window. */
const DUE = d("2026-08-20");

/**
 * The client, with a tally of what actually reached it.
 *
 * The counters wrap rather than replace: every call is passed straight through
 * to the real client, so this measures the merged module driving the real
 * thing, not a fake standing in for it.
 */
function counted(inner: AlertManager) {
  const calls = { reportRun: 0, raiseAlert: 0 };
  const wrapper: AlertManager = {
    reportRun: (sourceId, runId, alerts, scopes) => {
      calls.reportRun += 1;
      return inner.reportRun(sourceId, runId, alerts, scopes);
    },
    raiseAlert: (fingerprint, severity, policyId, areas, context) => {
      calls.raiseAlert += 1;
      return inner.raiseAlert(fingerprint, severity, policyId, areas, context);
    },
  };
  return { calls, port: wrapper };
}

function depsFor(registrations: Registration[], calendars: string[], alerts: AlertManager): DeadlineDeps {
  const thresholds: ThresholdRule[] = [threshold(WATCHED, 10, "major")];
  const store: DeadlineStore = {
    upsertRegistration: (input) => Promise.resolve({ id: "x", ...input }),
    deleteRegistration: () => Promise.resolve(),
    listRegistrations: () => Promise.resolve([...registrations]),
    listThresholds: () => Promise.resolve([...thresholds]),
  };
  const source: CalendarSource = {
    forJurisdiction: (id) => Promise.resolve(calendars.includes(id) ? calendar(id, GULF) : null),
  };
  return {
    tenant: "reno",
    store,
    calendars: source,
    alerts,
    now: () => TODAY,
    runId: () => "r-port",
  };
}

describe("the merged deadline sweep can drive this client end to end", () => {
  // The node exists because module-deadlines is already merged and "calls
  // reportRun and raiseAlert against nothing". This is that module, unmodified,
  // calling the real service: AE has a calendar and a breaching deadline, so a
  // breach is reported; KW has a registration and NO calendar, so the sweep
  // raises a misconfiguration alert for it and declares the area incomplete
  // (ADR-040, flows-alerting.md).
  const run = async () => {
    const engine = counted(createAlertManager({ sourceId: SOURCE }));
    const report = await runDeadlineSweep(
      depsFor(
        [deadline("document:1", WATCHED, DUE, "AE"), deadline("document:3", WATCHED, DUE, "KW")],
        ["AE"],
        engine.port,
      ),
    );
    return { engine, report };
  };

  it("reaches both port verbs and completes the run", async () => {
    const { engine, report } = await run();
    expect(engine.calls.raiseAlert, "the missing-calendar alert never reached the client").toBe(1);
    expect(engine.calls.reportRun, "the run's complete breach set never reached the client").toBe(1);
    expect(report.breaches.map((alert) => alert.area)).toEqual(["AE"]);
  });

  it("does not make an area go incomplete by refusing its alert", async () => {
    // ADR-040's derived constraint, read backwards. The sweep guards every
    // raiseAlert: a throw does not end the run, but "an area whose alert could
    // not be raised was NOT fully checked, so it is declared incomplete". So an
    // engine that rejects a call it should accept is visible right here, as a
    // second reason on the scope — and its consequence is that absence can never
    // resolve anything in that area again.
    const { report } = await run();
    const kw = report.scopes.find((scope) => scope.area === "KW");
    expect(kw, "the sweep declared no scope for KW").toBeDefined();
    expect(
      (kw as { reason?: string }).reason ?? "",
      `the client refused ${MISSING_CALENDAR_POLICY}, and the area went incomplete for it`,
    ).not.toContain("could not be raised");
  });

  it("leaves the healthy area complete, so absence there can still resolve", async () => {
    // The other half of the same rule (flows-alerting.md:47). If the client
    // threw on the AE breach report the run would still finish, and the silence
    // would be indistinguishable from a clean night.
    const { report } = await run();
    const ae = report.scopes.find((scope) => scope.area === "AE");
    expect(ae, "the sweep declared no scope for AE").toBeDefined();
    expect((ae as { complete: boolean }).complete).toBe(true);
  });
});
