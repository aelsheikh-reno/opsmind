// Assertions 3, 4 and 5 of
// tasks/backlog.yaml#service-alerts-surface-and-lifecycle:
//
//   3 "Severity rises in place while an alert is open and never falls; a
//      downgrade is a resolve followed by a new alert"
//   4 "STALE is a flag on an open alert, not a fifth state — an alert is firing
//      and STALE at once"
//   5 "Acknowledged and suppressed are open: neither closes an alert and
//      neither resolves it"
//
// Sources, in the words they use:
//
//   ADR-020 — "The engine owns a four-state lifecycle (firing, acknowledged,
//     suppressed, resolved)… severity monotonic while open".
//   data-model.md, the Alert card — `stale | boolean | A flag on an open alert,
//     not a fifth state. An alert can be firing *and* unconfirmed at once; a
//     fifth state would make that unrepresentable`; and `severity | enum |
//     Monotonic while open — it may rise in place; a genuine downgrade is
//     resolve-then-reopen, or dedupe breaks`.
//   flows-alerting.md — "Acknowledgement pauses paging but never closes: if the
//     resolve window lapses while the alert is still open, it re-escalates"; "A
//     missed report never resolves anything: open alerts are flagged STALE and
//     stay open"; "Only the source, or a logged human resolve, closes an alert".
//   The node's note — "STALE AS A FLAG IS NOT INVENTED HERE: ADR-020 fixes the
//     lifecycle at four states, and flows-alerting.md says a frozen alert stays
//     open. A fifth state would make 'open and unconfirmed' unrepresentable."
//
// Written from the specification alone: no file under lib/services/alerts/ was
// read by the author of these tests. How the surface is reached — and why more
// than one spelling of it is accepted while nothing about the assertions is
// relaxed — is in ./surface.ts.
import { describe, expect, it } from "vitest";

import {
  ACKNOWLEDGED,
  FIRING,
  FOUR_STATES,
  MAJOR,
  MINOR,
  OPEN_STATES,
  RESOLVED,
  SUPPRESSED,
  alertShape,
  declaredSeverities,
  declaredShapes,
  declaredStates,
  higherSeverity,
  isOpen,
  severityOrderingName,
} from "./surface";

const sorted = (values: Iterable<string>): string[] => [...values].sort();

/** One member of the alert record, by name, or undefined. */
function member(name: string): { name: string; type: string; optional: boolean } | undefined {
  const shape = alertShape();
  expect(
    shape,
    "the service declares no alert record carrying a fingerprint and a state. " +
      "data-model.md's Alert card is the shape; a lifecycle with no record to move is not one. " +
      `It declares: ${declaredShapes()}`,
  ).toBeDefined();
  return (shape as NonNullable<typeof shape>).members.find((declared) => declared.name === name);
}

// ----------------------------------------------------- assertion 4, the four --

describe("the lifecycle has four states and STALE is not one of them", () => {
  it("declares exactly the four of ADR-020", () => {
    // "The four of ADR-020, and only those four" (data-model.md). A fifth
    // member is the mutation this case exists for: `"stale"` alongside
    // `"firing"` makes "open and unconfirmed" unrepresentable, because an alert
    // in the stale state is no longer in the firing one.
    const declared = declaredStates();
    expect(
      sorted(declared.values),
      `the state vocabulary in ${declared.where} is not ADR-020's four`,
    ).toEqual(sorted(FOUR_STATES));
  });

  it("names no state after being unconfirmed, under any of its words", () => {
    // The same rule stated so that renaming the fifth state does not evade it.
    // "Frozen", "unconfirmed" and "dark" are the three words flows-alerting.md
    // uses for this condition, and none of them is a state.
    const declared = declaredStates();
    for (const forbidden of ["stale", "unconfirmed", "frozen", "dark", "unknown"]) {
      expect(
        declared.values.map((state) => state.toLowerCase()),
        `${forbidden} is a flag on an open alert, never a state`,
      ).not.toContain(forbidden);
    }
  });

  it("carries STALE as a boolean flag on the record instead", () => {
    // The positive half, and the one that fails if the flag is deleted rather
    // than kept off the state machine: a record with four states and no `stale`
    // satisfies the case above while making the STALE rule — "alerts in an
    // incomplete scope stay open, are marked STALE, and are never resolved by
    // absence" — impossible to record at all.
    const flag = member("stale");
    expect(
      flag,
      "the alert record declares no `stale`. data-model.md: 'Set when a run did not cover " +
        "this alert's areas, cleared when one does'",
    ).toBeDefined();
    expect((flag as { type: string }).type).toContain("boolean");
  });

  it("is firing and STALE at once, and still open", () => {
    // The assertion in the node's own words. A run that did not cover this
    // alert's areas marks it unconfirmed; it has not stopped firing, and
    // nothing about being unconfirmed closes it — "a dead watcher can flag
    // alerts unconfirmed but can never close them" (flows-alerting.md).
    expect(isOpen(FIRING, true), "firing and stale is open").toBe(true);
    expect(isOpen(FIRING, false), "firing is open").toBe(true);
    // And the flag does not decide openness in either direction: a resolved
    // alert is closed whether or not the last run reached it.
    expect(isOpen(RESOLVED, true), "resolved is closed, stale or not").toBe(false);
  });
});

// -------------------------------------- assertion 5, acknowledged and suppressed --

describe("acknowledged and suppressed are open", () => {
  it("counts all three of firing, acknowledged and suppressed as open", () => {
    // flows-alerting.md: "Acknowledgement pauses paging but never closes… if
    // the resolve window lapses while the alert is still open, it re-escalates."
    // An engine that treated acknowledgement as closure would stop chasing a
    // breach the moment somebody looked at it, which is the compliance failure
    // this component exists to prevent.
    for (const state of OPEN_STATES) {
      expect(isOpen(state), `${state} must be open`).toBe(true);
    }
  });

  it("counts resolved, and only resolved, as closed", () => {
    // "Only the source, or a logged human resolve, closes an alert." The
    // exhaustive form: every state the service declares is open unless it is
    // the resolved one, so a fifth state cannot slip in as a second closed one.
    expect(isOpen(RESOLVED)).toBe(false);
    for (const state of declaredStates().values) {
      expect(isOpen(state), `${state}`).toBe(state !== RESOLVED);
    }
  });

  it("keeps acknowledged and suppressed distinct from resolved", () => {
    // Distinctness is what makes the case above mean anything: an engine that
    // mapped `acknowledge` onto the resolved state would answer `isOpen` however
    // it liked, because there would be nothing left to ask.
    const declared = declaredStates().values;
    expect(declared, "acknowledge has nowhere to put an alert").toContain(ACKNOWLEDGED);
    expect(declared, "suppress has nowhere to put an alert").toContain(SUPPRESSED);
    expect(new Set([ACKNOWLEDGED, SUPPRESSED, RESOLVED]).size).toBe(3);
  });

  it("leaves the resolution timestamp empty while an alert is open", () => {
    // data-model.md: `resolvedAt | timestamp | null | Null while open. The row
    // survives resolution — nothing is deleted to close an alert.` This is the
    // half of "neither resolves it" that is visible in the shape: a
    // non-nullable resolvedAt would force acknowledgement to invent one.
    const resolvedAt = member("resolvedAt");
    expect(
      resolvedAt,
      "the alert record declares no `resolvedAt`, so an open alert and a closed one are " +
        "indistinguishable outside `state`",
    ).toBeDefined();
    const declared = resolvedAt as { type: string; optional: boolean };
    expect(
      declared.optional || declared.type.includes("null") || declared.type.includes("undefined"),
      `resolvedAt is ${declared.type.trim()}, which cannot be empty while the alert is open`,
    ).toBe(true);
  });
});

// ------------------------------------------------- assertion 3, the severity --

describe("severity rises in place and never falls", () => {
  it("publishes the ordering itself, so what follows is the engine's answer", () => {
    // THE GUARD ON THE FIVE CASES BELOW. ./surface.ts will accept a max-style
    // function, a rank function or — failing both — an ordered vocabulary it
    // compares indices in. That last one is a fallback for reading a service
    // written a way this file did not predict, and every monotonicity case
    // measured through it would be measuring arithmetic done in the test rather
    // than a rule the engine enforces. So the ordering has to be callable, and
    // this says so before anything relies on it.
    //
    // It is also what the node buys: "the state predicates, the severity
    // ordering, the types, and index.ts" is the whole of its ~150-200 lines.
    expect(
      severityOrderingName(),
      "the service publishes no callable severity ordering, so 'never falls' would be a " +
        "property of the test rather than of the engine",
    ).toBeDefined();
  });

  it("holds the two severities the merged port sends", () => {
    // `Severity` on lib/modules/deadlines is "minor" | "major", and the module
    // is already calling. An engine whose vocabulary is missing one of them
    // cannot record what the sweep reports, whatever else it can order.
    const declared = declaredSeverities();
    expect(declared, "the engine cannot record what the deadline monitor sends").toContain(MINOR);
    expect(declared).toContain(MAJOR);
  });

  it("raises minor to major", () => {
    // "it may rise in place" (data-model.md). The alert keeps its identity —
    // severity is not part of the fingerprint, precisely so that escalation does
    // not break dedupe (flows-alerting.md:34).
    expect(higherSeverity(MINOR, MAJOR)).toBe(MAJOR);
  });

  it("leaves major where it is when minor arrives", () => {
    // The mutation this case exists for: an engine that simply assigns the
    // incoming severity. A visa that was major on Monday and reported minor on
    // Tuesday would silently de-escalate, and the page would stop.
    expect(higherSeverity(MAJOR, MINOR)).toBe(MAJOR);
  });

  it("never lowers a severity, for any pair in the vocabulary", () => {
    // The property, stated over everything the service declares rather than
    // over the two the deadline monitor happens to send, because the engine
    // serves other sources. Ordering is read from the service's own vocabulary
    // — the assertion is that the result is never BELOW where the alert already
    // was, and is exactly the higher of the two.
    const order = declaredSeverities();
    const rank = (value: string): number => order.indexOf(value);
    for (const current of order) {
      for (const incoming of order) {
        const answer = higherSeverity(current, incoming);
        expect(rank(answer), `${current} + ${incoming} -> ${answer} fell below ${current}`)
          .toBeGreaterThanOrEqual(rank(current));
        expect(answer, `${current} + ${incoming}`).toBe(
          rank(incoming) > rank(current) ? incoming : current,
        );
      }
    }
  });

  it("changes nothing when the same severity is reported again", () => {
    // The repeating source's ordinary night: the sweep recomputes and reports
    // the same breach at the same severity, every run, for weeks. Idempotence
    // here is what stops that from being an escalation.
    for (const severity of declaredSeverities()) {
      expect(higherSeverity(severity, severity)).toBe(severity);
    }
  });

  it("puts minor below major, which is the order the source's thresholds assume", () => {
    // The one ordering claim taken from outside the service: the deadline
    // monitor reports major for the nearest breached window and minor for a
    // wider one (tests/modules/deadlines/thresholds.test.ts, "minor < major is
    // the whole of it"), and prisma/schema.prisma spells the enum in that order.
    // An engine that ordered them the other way would treat every escalation as
    // a downgrade and never raise anything in place.
    const order = declaredSeverities();
    expect(order.indexOf(MINOR)).toBeLessThan(order.indexOf(MAJOR));
  });

  it("offers no way to lower a severity in place, which is why a downgrade reopens", () => {
    // The second half of assertion 3 — "a downgrade is a resolve followed by a
    // new alert". What is provable at THIS node is that nothing in the
    // published ordering can move an open alert down: the two cases above are
    // the specific pair, this is every pair at once, and the state machine
    // supplies the rest — a genuine downgrade has to pass through `resolved`,
    // which is not an open state. The reopen itself is service-alerts-raise's
    // assertion, because it needs a store to see the second alert in.
    const order = declaredSeverities();
    const lowered = order.flatMap((current) =>
      order
        .filter((incoming) => order.indexOf(incoming) < order.indexOf(current))
        .filter((incoming) => higherSeverity(current, incoming) !== current)
        .map((incoming) => `${current} + ${incoming}`),
    );
    expect(lowered, "an open alert was moved down without being resolved first").toEqual([]);
    expect(isOpen(RESOLVED), "resolve-then-reopen means resolved is not open").toBe(false);
  });
});
