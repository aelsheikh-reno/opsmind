// Assertion 6 of tasks/backlog.yaml#service-alerts-surface-and-lifecycle:
//
//   "A policyId the engine holds no configuration for is accepted and recorded,
//    never refused"
//
// data-model.md, the Alert card: `policyId | string | What rule fired. Recorded
// even when the engine holds no configuration for it — an unknown policy is
// accepted, never refused`.
//
// WHY IT MATTERS ENOUGH TO BE ITS OWN ASSERTION. The two policies in service
// today are the deadline monitor's misconfiguration alerts — `missing-business-calendar`
// and `no-threshold-configured` — and neither exists in any Alert Manager
// configuration, because both mean "something is registered that nothing can
// score". They are raised inside `runDeadlineSweep`'s jurisdiction loop. ADR-040
// made a failure there non-fatal, but an area whose alert could not be raised is
// reported INCOMPLETE, and absence never resolves inside an incomplete area — so
// an engine that refuses an unknown policy does not merely drop one alert, it
// stops that jurisdiction's alerts from ever closing again. Refusing the unknown
// is also CLAUDE.md rule 8 upside down: the engine would be guessing that a
// policy it has not been told about is not real.
//
// Written from the specification alone: no file under lib/services/alerts/ was
// read by the author of these tests.
import { describe, expect, it } from "vitest";

import {
  MISSING_CALENDAR_POLICY,
  NO_THRESHOLD_POLICY,
  fingerprintFor,
} from "@/lib/modules/deadlines";

import { AREA, AT, FP_A, MAJOR, MINOR, alertShape, declaredShapes, typeText, verb } from "./surface";

/** What the engine did with the call, in one word, for a message worth reading. */
async function outcomeOf(call: () => unknown): Promise<string> {
  return Promise.resolve(call()).then(
    () => "accepted",
    (error: unknown) => `refused: ${error instanceof Error ? error.message : String(error)}`,
  );
}

const raise = (fingerprint: string, policyId: string, severity = MAJOR): (() => unknown) => {
  const call = verb("raiseAlert");
  return () => call(fingerprint, severity, policyId, [AREA], { raisedAt: AT });
};

describe("an unknown policy is accepted, never refused", () => {
  it("accepts a policyId no configuration mentions", () => {
    // The plain case. The engine holds thresholds for nothing — detection
    // engines own thresholds and severity, and the Alert Manager "consumes
    // severity; it never judges it" (components-services.md:24) — so there is
    // nothing for a policy id to be checked against, and checking it against
    // the empty set would refuse every alert ever raised.
    return expect(outcomeOf(raise(FP_A, "a-policy-nobody-configured"))).resolves.toBe("accepted");
  });

  it("accepts both misconfiguration policies the merged sweep already raises", async () => {
    // These two are not hypothetical: lib/modules/deadlines/index.ts exports
    // them and `runDeadlineSweep` raises them by name. They are the alerts that
    // say a deadline is registered and unscorable — the failure the deadline
    // monitor exists to prevent — so they are the last two an engine should be
    // fussy about.
    for (const policyId of [MISSING_CALENDAR_POLICY, NO_THRESHOLD_POLICY]) {
      const fingerprint = fingerprintFor("reno", "jurisdiction", "KW", policyId);
      expect(await outcomeOf(raise(fingerprint, policyId)), policyId).toBe("accepted");
    }
  });

  it("accepts the same unknown policy again, run after run", async () => {
    // The sweep raises one misconfiguration alert per subject per run, every
    // night, until somebody adds the missing row. An engine that accepted the
    // first and refused the repeat would go quiet on a fault that is still
    // there, which is the same silence as refusing it outright — only later.
    const fingerprint = fingerprintFor("reno", "deadline-type", "visa", NO_THRESHOLD_POLICY);
    for (const run of [1, 2, 3]) {
      expect(await outcomeOf(raise(fingerprint, NO_THRESHOLD_POLICY)), `run ${run}`).toBe(
        "accepted",
      );
    }
  });

  it("accepts an unknown policy at either severity the source may choose", async () => {
    // Severity comes from the source and the engine never judges it (ADR-020).
    // The misconfiguration alerts arrive at the top of the enum because the
    // fault IS the absence of a rule; a lower one must be just as acceptable.
    for (const severity of [MINOR, MAJOR]) {
      expect(await outcomeOf(raise(FP_A, "still-not-configured", severity)), severity).toBe(
        "accepted",
      );
    }
  });

  it("records the policy as a plain string, so an unknown one is representable", () => {
    // The "and recorded" half, at the only place it is visible before the store
    // lands. A `policyId` typed as a union of configured policies would make an
    // unknown one unrepresentable — the refusal moved from a runtime check into
    // the type, where it is harder to see and just as silent.
    const shape = alertShape();
    expect(
      shape,
      "the service declares no alert record (data-model.md, the Alert card). " +
        `It declares: ${declaredShapes()}`,
    ).toBeDefined();
    const policy = (shape as NonNullable<typeof shape>).members.find(
      (declared) => declared.name === "policyId",
    );
    expect(
      policy,
      "the alert record declares no `policyId`. data-model.md: 'What rule fired. Recorded even " +
        "when the engine holds no configuration for it'",
    ).toBeDefined();
    expect(typeText(policy as { type: string })).toBe(":string");
  });
});
