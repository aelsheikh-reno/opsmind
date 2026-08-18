// The lifecycle as BEHAVIOUR, for the same three assertions of
// tasks/backlog.yaml#service-alerts-surface-and-lifecycle that lifecycle.test.ts
// states as vocabulary:
//
//   3 "Severity rises in place while an alert is open and never falls; a
//      downgrade is a resolve followed by a new alert"
//   4 "STALE is a flag on an open alert, not a fifth state — an alert is firing
//      and STALE at once"
//   5 "Acknowledged and suppressed are open: neither closes an alert and
//      neither resolves it"
//
// WHY THIS FILE EXISTS BESIDE lifecycle.test.ts, WHICH ALREADY CLAIMS ALL THREE.
// That file proves them from the declared vocabulary — `ALERT_STATES`,
// `OPEN_STATES`, the severity ordering — and a vocabulary is not a transition.
// "Acknowledged is open" held there by membership in a list, so an `acknowledge`
// that returned a RESOLVED record passed the whole suite: the list still said
// acknowledged was open, and nothing ever called the function. Same for STALE —
// the type could represent firing-and-stale while `markStale` moved the state,
// and for severity — the ordering was monotonic while nothing applied it to a
// record. The two files are complementary and neither replaces the other: one
// says what the lifecycle IS, this one says what it DOES.
//
// Sources, in the words they use:
//
//   data-model.md, the Alert card — `stale | boolean | A flag on an open alert,
//     not a fifth state`; `severity | Monotonic while open — it may rise in
//     place; a genuine downgrade is resolve-then-reopen`; `firstSeenAt | When
//     this identity first fired. Survives re-firing`; `lastSeenAt | The most
//     recent run or raise that carried it`; `resolvedAt | Null while open. The
//     row survives resolution — nothing is deleted to close an alert`;
//     `policyId | Recorded even when the engine holds no configuration for it`;
//     `context | The source's own diagnostic payload. Never read for scoping`;
//     and `@@unique([sourceId, fingerprint])`, which is what `sameIdentity` is.
//   flows-alerting.md — "Acknowledgement pauses paging but never closes";
//     "open alerts are flagged STALE and stay open"; "Only the source, or a
//     logged human resolve, closes an alert".
//   ADR-020 — four states; ADR-040/043 — `areas` are the caller's own opaque
//     keys; ADR-044 — an alert's areas name impact, not fault.
//
// ---------------------------------------------------------------------------
// PROVENANCE, STATED PLAINLY BECAUSE IT CHANGED. Every other file in this
// directory was written without reading lib/services/alerts/. This one was
// written after reading lifecycle.ts, on the coordinator's instruction, because
// nine exported transitions had no caller and a case cannot assert a reading it
// has not seen. That is a real risk — a test written from code describes the
// code, bugs included — so each case below cites the sentence of the
// specification it is testing, and the four places where the implementation
// makes a choice the specification does not are marked UNSPECIFIED and pinned
// deliberately rather than silently. Where a choice looked wrong against the
// spec rather than merely unspecified, it is reported to the coordinator instead
// of being written down here as an expectation.
// ---------------------------------------------------------------------------
import { describe, expect, it } from "vitest";

import {
  acknowledge,
  clearStale,
  isOpen,
  isResolved,
  markStale,
  openAlert,
  reassert,
  resolveAlert,
  sameIdentity,
  suppress,
  type AlertRaise,
  type AlertRecord,
  type AlertSeverity,
  type AlertState,
} from "@/lib/services/alerts";

import { fingerprintFor } from "@/lib/modules/deadlines";

import { ACKNOWLEDGED, AREA, FIRING, FP_A, FP_B, MAJOR, MINOR, POLICY, RESOLVED, SOURCE, SUPPRESSED } from "./surface";

// ------------------------------------------------------------- fixtures --

/** Three nights of a nightly source, so "which timestamp moved" is answerable. */
const FIRST_NIGHT = new Date("2026-08-17T02:00:00Z");
const SECOND_NIGHT = new Date("2026-08-18T02:00:00Z");
const THIRD_NIGHT = new Date("2026-08-19T02:00:00Z");

/** A caller's own diagnostic bag. Never read by the engine (ADR-040). */
const CONTEXT = { businessDaysRemaining: 3, dueOnNonWorkingDay: true };

const raise = (over: Partial<AlertRaise> = {}): AlertRaise => ({
  sourceId: SOURCE,
  fingerprint: FP_A,
  severity: MAJOR,
  policyId: POLICY,
  areas: [AREA],
  context: CONTEXT,
  ...over,
});

/** The four canonical records, each reached through the engine's own verbs
 *  rather than assembled by hand — a record built by hand can be inconsistent
 *  in a way the engine would never produce, and asserting against one proves
 *  nothing about the engine. */
const firingRecord = (): AlertRecord => openAlert(raise(), FIRST_NIGHT);
const acknowledgedRecord = (): AlertRecord => acknowledge(firingRecord());
const suppressedRecord = (): AlertRecord => suppress(firingRecord());
const resolvedRecord = (): AlertRecord => resolveAlert(firingRecord(), SECOND_NIGHT);

const inEveryState = (): { state: AlertState; record: AlertRecord }[] => [
  { state: FIRING as AlertState, record: firingRecord() },
  { state: ACKNOWLEDGED as AlertState, record: acknowledgedRecord() },
  { state: SUPPRESSED as AlertState, record: suppressedRecord() },
  { state: RESOLVED as AlertState, record: resolvedRecord() },
];

const RANK: readonly AlertSeverity[] = [MINOR, MAJOR];
const rank = (severity: AlertSeverity): number => RANK.indexOf(severity);

// -------------------------------------------------------- a first sighting --

describe("openAlert records the raise and nothing else", () => {
  it("opens firing, unconfirmed by nothing, and not resolved", () => {
    // data-model.md: `state` starts at firing, `stale` is a flag that a run
    // sets later, and `resolvedAt` is "Null while open". A first sighting that
    // arrived stale would be an alert nobody has failed to confirm yet.
    const alert = openAlert(raise(), FIRST_NIGHT);
    expect(alert.state).toBe(FIRING);
    expect(alert.stale, "nothing has failed to cover this alert yet").toBe(false);
    expect(alert.resolvedAt, "an open alert has no resolution instant").toBeNull();
    expect(isOpen(alert.state)).toBe(true);
  });

  it("carries the severity, the policy and the caller's areas verbatim", () => {
    // "Detection engines own thresholds and severity; the Alert Manager owns
    // everything after" (ADR-020) — so every one of these is recorded as given
    // and none of it is judged. The areas are a LIST because one alert can
    // legitimately span several scopes (ADR-040), and they name where the
    // IMPACT is rather than where the fault is (ADR-044).
    const areas = ["AE", "EG", "KW"];
    const alert = openAlert(raise({ severity: MINOR, policyId: "no-threshold-configured", areas }), FIRST_NIGHT);
    expect(alert.severity).toBe(MINOR);
    expect(alert.policyId).toBe("no-threshold-configured");
    expect([...alert.areas]).toEqual(areas);
  });

  it("carries an unconfigured policy as data, not as an error", () => {
    // Assertion 6 of the node, as behaviour rather than as a type. The two
    // policies in service today are the deadline monitor's misconfiguration
    // alerts and no Alert Manager configuration mentions either; an engine that
    // validated the policy here would drop exactly the alerts that say
    // something is registered which nothing can score.
    const alert = openAlert(raise({ policyId: "a-policy-nobody-configured" }), FIRST_NIGHT);
    expect(alert.policyId).toBe("a-policy-nobody-configured");
  });

  it("carries the caller's context whole and reads nothing out of it", () => {
    // ADR-040(2): "The area is a named argument on raiseAlert, not something
    // read back out of context. The Alert Manager must never parse a caller's
    // context bag." Carried whole is the positive half; the record's `areas`
    // coming from the ARGUMENT and not from the bag is the other half, so a bag
    // that contradicts the argument must not win.
    const alert = openAlert(
      raise({ areas: ["AE"], context: { ...CONTEXT, area: "KW", jurisdictionId: "KW" } }),
      FIRST_NIGHT,
    );
    expect(alert.context).toEqual({ ...CONTEXT, area: "KW", jurisdictionId: "KW" });
    expect([...alert.areas], "the scope came out of the bag").toEqual(["AE"]);
  });

  it("stamps both timestamps with the instant it was told about, and no clock of its own", () => {
    // The whole file "takes what it needs and returns what it decided": a
    // lifecycle that read the system clock could not be replayed, and a run
    // would not be reproducible (the same reason DeadlineDeps.now is injected).
    const alert = openAlert(raise(), FIRST_NIGHT);
    expect(alert.firstSeenAt).toBe(FIRST_NIGHT);
    expect(alert.lastSeenAt).toBe(FIRST_NIGHT);
  });
});

// ------------------------------------------------------- the same identity --

describe("sameIdentity compares the whole string, and the source with it", () => {
  it("is the same alert only when both halves match", () => {
    // data-model.md: `@@unique([sourceId, fingerprint])`. "That uniqueness IS
    // the dedupe: reporting the same fingerprint twice updates one row and
    // never creates a second identity for one fact."
    const identity = { sourceId: SOURCE, fingerprint: FP_A };
    expect(sameIdentity(identity, { sourceId: SOURCE, fingerprint: FP_A })).toBe(true);
    expect(sameIdentity(identity, { sourceId: SOURCE, fingerprint: FP_B })).toBe(false);
  });

  it("keeps two sources apart that computed the same string", () => {
    // The card's reason for scoping the fingerprint: "Which source raised it.
    // Scopes the fingerprint — two sources may legitimately compute the same
    // one." Without this, one product's alert resolves another's.
    expect(sameIdentity({ sourceId: "a", fingerprint: FP_A }, { sourceId: "b", fingerprint: FP_A })).toBe(false);
  });

  it("keeps apart two fingerprints that differ only inside an escape", () => {
    // ASSERTION 2, AS BEHAVIOUR, and the case fingerprint.test.ts could not
    // make: with no store there was nothing to observe an identity through, so
    // that file could only prove the engine never SPLITS the string. This is
    // the other half — the engine's own comparison, given the pair the escaping
    // exists for. One entity id is `1:2`; the other is the four characters `1`,
    // `\`, `:`, `2`. A naive splitter merges them (fingerprint.test.ts shows it
    // doing so); comparing the whole strings does not.
    const escapedColon = fingerprintFor("reno", "document", "1:2", POLICY);
    const literalBackslash = fingerprintFor("reno", "document", "1\\:2", POLICY);
    const splitOnType = fingerprintFor("reno", "document:1", "2", POLICY);
    expect(sameIdentity({ sourceId: SOURCE, fingerprint: escapedColon }, { sourceId: SOURCE, fingerprint: literalBackslash })).toBe(false);
    expect(sameIdentity({ sourceId: SOURCE, fingerprint: escapedColon }, { sourceId: SOURCE, fingerprint: splitOnType })).toBe(false);
  });

  it("says an alert is itself, whatever else has happened to it", () => {
    // Identity survives the lifecycle: escalation, acknowledgement, staleness
    // and resolution all leave the alert the same alert, which is why severity
    // is deliberately not part of the fingerprint (flows-alerting.md:34).
    const opened = firingRecord();
    for (const later of [
      acknowledge(opened),
      suppress(opened),
      markStale(opened),
      resolveAlert(opened, SECOND_NIGHT),
      reassert(opened, raise({ severity: MINOR }), SECOND_NIGHT),
    ]) {
      expect(sameIdentity(opened, later)).toBe(true);
    }
  });
});

// ----------------------------------------------------------- isResolved --

describe("isResolved is the complement of isOpen, over all four states", () => {
  it("closes on resolved and on nothing else", () => {
    // Stated as a behaviour rather than as a list membership, and exhaustively,
    // so a fifth closed state cannot be introduced without failing here.
    expect(isResolved(RESOLVED as AlertState)).toBe(true);
    for (const state of [FIRING, ACKNOWLEDGED, SUPPRESSED] as AlertState[]) {
      expect(isResolved(state), `${state} is open, so it is not resolved`).toBe(false);
      expect(isResolved(state)).toBe(!isOpen(state));
    }
  });
});

// -------------------------------------------------- assertion 3, in place --

describe("reassert raises severity in place and never lowers it", () => {
  it("raises minor to major on the same record", () => {
    // "it may rise in place" (data-model.md). The identity does not move, so
    // the escalation is the same alert at a higher level rather than a second
    // alert about one fact.
    const opened = openAlert(raise({ severity: MINOR }), FIRST_NIGHT);
    const escalated = reassert(opened, raise({ severity: MAJOR }), SECOND_NIGHT);
    expect(escalated.severity).toBe(MAJOR);
    expect(sameIdentity(opened, escalated)).toBe(true);
    expect(escalated.state, "an escalation does not reopen or close anything").toBe(FIRING);
  });

  it("ignores a lower severity while the alert is open", () => {
    // The mutation this exists for is the one-line `severity: raise.severity`.
    // A deadline that was major on Monday and is reported minor on Tuesday would
    // silently de-escalate and the page would stop — with the breach still
    // there, because the fingerprint never changed.
    const escalated = openAlert(raise({ severity: MAJOR }), FIRST_NIGHT);
    expect(reassert(escalated, raise({ severity: MINOR }), SECOND_NIGHT).severity).toBe(MAJOR);
  });

  it("keeps the first sighting and moves the last one", () => {
    // data-model.md: `firstSeenAt | When this identity first fired. Survives
    // re-firing`; `lastSeenAt | The most recent run or raise that carried it`.
    // The pair is how long a breach has been open, which is what an escalation
    // policy is written against — an engine that moved firstSeenAt every night
    // would report every alert as new every night.
    const opened = firingRecord();
    const again = reassert(opened, raise(), SECOND_NIGHT);
    expect(again.firstSeenAt).toBe(FIRST_NIGHT);
    expect(again.lastSeenAt).toBe(SECOND_NIGHT);
  });

  it("leaves an acknowledged alert acknowledged when its source reports it again", () => {
    // The nightly sweep re-reports every breach it still finds. If that returned
    // an acknowledged alert to firing, acknowledgement would last exactly until
    // 02:00 and paging would resume for an alert somebody is already handling.
    // service-alerts-acknowledge-suppress states the same rule for the other
    // verb — "an alert raised again while suppressed is recorded and stays
    // quiet" — and re-escalation is a lapsed RESOLVE WINDOW there, not a
    // re-raise here.
    const acknowledged = acknowledgedRecord();
    const again = reassert(acknowledged, raise(), SECOND_NIGHT);
    expect(again.state).toBe(ACKNOWLEDGED);
    expect(isOpen(again.state)).toBe(true);
    expect(again.lastSeenAt, "the source still carried it").toBe(SECOND_NIGHT);

    const suppressed = suppressedRecord();
    expect(reassert(suppressed, raise(), SECOND_NIGHT).state).toBe(SUPPRESSED);
  });

  it("never lowers a severity, from any open state, for any pair", () => {
    // The property, over every open state and every ordered pair. It is the
    // exhaustive form of the two specific cases above and is what a partial fix
    // — monotonic from firing, assignment from acknowledged — would fail.
    for (const { state, record } of inEveryState().filter((entry) => entry.state !== RESOLVED)) {
      for (const current of RANK) {
        for (const incoming of RANK) {
          const before = { ...record, severity: current };
          const after = reassert(before, raise({ severity: incoming }), SECOND_NIGHT);
          expect(rank(after.severity), `${state}: ${current} + ${incoming} -> ${after.severity}`)
            .toBeGreaterThanOrEqual(rank(current));
          expect(after.severity).toBe(rank(incoming) > rank(current) ? incoming : current);
        }
      }
    }
  });
});

describe("reassert on a resolved alert reopens it, which is how a downgrade is expressed", () => {
  it("opens it again as firing, with no resolution instant left on the row", () => {
    // ASSERTION 3's OTHER HALF. "A genuine downgrade is resolve-then-reopen"
    // only means something if the reopen exists, and this is it:
    // service-alerts-raise states the same rule for the verb above it — "A raise
    // for a fingerprint that is currently resolved opens it again as firing".
    const closed = resolvedRecord();
    expect(closed.state).toBe(RESOLVED);
    const reopened = reassert(closed, raise(), THIRD_NIGHT);
    expect(reopened.state).toBe(FIRING);
    expect(reopened.resolvedAt, "an open alert carries no resolution instant").toBeNull();
    expect(isOpen(reopened.state)).toBe(true);
    expect(sameIdentity(closed, reopened), "one identity throughout").toBe(true);
  });

  it("takes the incoming severity on reopen, even when it is lower", () => {
    // This is the whole point of the pair of rules. Monotonicity holds WHILE
    // OPEN; the resolve ends that alert, so the new one starts wherever the
    // source now says it is. Without this, a condition that genuinely improved
    // could never be recorded as improved and the highest severity a
    // fingerprint ever reached would be permanent.
    const closed = resolveAlert(openAlert(raise({ severity: MAJOR }), FIRST_NIGHT), SECOND_NIGHT);
    expect(reassert(closed, raise({ severity: MINOR }), THIRD_NIGHT).severity).toBe(MINOR);
  });

  it("starts the reopened alert confirmed rather than unconfirmed", () => {
    // A reopen is a run that positively carried the fingerprint, so the alert
    // cannot be "nobody has confirmed this" at the moment it reopens.
    const stale = markStale(firingRecord());
    const closed = resolveAlert(stale, SECOND_NIGHT);
    expect(reassert(closed, raise(), THIRD_NIGHT).stale).toBe(false);
  });

  it("keeps the original first sighting across the reopen", () => {
    // data-model.md again: firstSeenAt is "When this identity first fired.
    // Survives re-firing" — and a reopen is the strongest form of re-firing.
    //
    // NOTE FOR THE NODE ABOVE THIS ONE: the row's own `resolvedAt` is cleared
    // by the reopen, so service-alerts-raise's "the earlier resolution stays in
    // the record" must come from the append-only AlertEvent log, which does not
    // exist yet. Recorded here so the two are not read as contradicting.
    const closed = resolvedRecord();
    expect(reassert(closed, raise(), THIRD_NIGHT).firstSeenAt).toBe(FIRST_NIGHT);
  });

  it("takes the latest raise's policy, areas and context", () => {
    // UNSPECIFIED — latest-wins is the implementation's reading and no document
    // states it. Pinned because the alternative is silence, and because it is
    // the defensible one: ADR-044 has an alert's areas name where the IMPACT is,
    // and a missing threshold row affecting three jurisdictions on Monday and
    // two on Tuesday is one fault whose impact shrank. A record that kept
    // Monday's areas would be resolved by absence in a scope nobody rechecked.
    // If Ahmed rules the other way — first-wins, or accumulate — this case is
    // the one that must change, and it is deliberately the only one that
    // asserts it.
    const opened = openAlert(raise({ areas: ["AE", "EG", "KW"], context: { run: 1 } }), FIRST_NIGHT);
    const again = reassert(opened, raise({ policyId: "renewal", areas: ["AE"], context: { run: 2 } }), SECOND_NIGHT);
    expect(again.policyId).toBe("renewal");
    expect([...again.areas]).toEqual(["AE"]);
    expect(again.context).toEqual({ run: 2 });
  });

  it("leaves the unconfirmed flag alone on an ordinary re-raise", () => {
    // UNSPECIFIED at this node, and correct as a division of labour. Clearing
    // STALE is scope knowledge: "An alert stops being STALE when a later run
    // declares its scope COMPLETE" (service-alerts-report-run), and reassert is
    // handed a raise, not a scope declaration — it cannot know whether the run
    // that carried this alert finished the areas it belongs to. `clearStale` is
    // the separate verb the run-reporting node calls once it does know.
    const stale = markStale(firingRecord());
    expect(reassert(stale, raise(), SECOND_NIGHT).stale).toBe(true);
  });
});

// ------------------------------------- assertion 5, acknowledged and suppressed --

describe("acknowledge and suppress move the state and leave the alert open", () => {
  it("acknowledges a firing alert without closing it", () => {
    // flows-alerting.md: "Acknowledgement pauses paging but never closes: if the
    // resolve window lapses while the alert is still open, it re-escalates."
    // The compliance failure this shape exists to prevent is a human silencing
    // an alert and the deadline arriving anyway.
    const acknowledged = acknowledge(firingRecord());
    expect(acknowledged.state).toBe(ACKNOWLEDGED);
    expect(isOpen(acknowledged.state), "acknowledgement never closes").toBe(true);
    expect(isResolved(acknowledged.state)).toBe(false);
    expect(acknowledged.resolvedAt, "and it never resolves").toBeNull();
  });

  it("suppresses a firing alert without closing it", () => {
    const suppressed = suppress(firingRecord());
    expect(suppressed.state).toBe(SUPPRESSED);
    expect(isOpen(suppressed.state)).toBe(true);
    expect(suppressed.resolvedAt).toBeNull();
  });

  it("changes nothing else about the alert", () => {
    // Neither verb is a report from the source, so neither touches what a
    // source owns: the severity it decided, the areas it named, the bag it
    // supplied, or `lastSeenAt` — "The most recent run or raise that CARRIED
    // it" (data-model.md), and a human acknowledging is not the source
    // carrying it.
    const opened = firingRecord();
    for (const changed of [acknowledge(opened), suppress(opened)]) {
      expect(changed.severity).toBe(opened.severity);
      expect([...changed.areas]).toEqual([...opened.areas]);
      expect(changed.context).toEqual(opened.context);
      expect(changed.policyId).toBe(opened.policyId);
      expect(changed.stale).toBe(opened.stale);
      expect(changed.firstSeenAt).toBe(opened.firstSeenAt);
      expect(changed.lastSeenAt, "a human did not carry this alert").toBe(opened.lastSeenAt);
    }
  });

  it("can pause an alert that is unconfirmed, and leaves it unconfirmed", () => {
    // The two are orthogonal by construction (data-model.md: "Orthogonal to
    // `state` on purpose"), so a stale alert is acknowledgeable and stays stale
    // — the acknowledgement says a human is on it, not that a run confirmed it.
    const stale = markStale(firingRecord());
    const acknowledged = acknowledge(stale);
    expect(acknowledged.state).toBe(ACKNOWLEDGED);
    expect(acknowledged.stale).toBe(true);
    expect(isOpen(acknowledged.state)).toBe(true);
  });

  it("leaves a resolved alert alone rather than reopening it", () => {
    // UNSPECIFIED — extrapolated by the implementation from resolveAlert's
    // stated idempotence, and pinned here as the safe reading of the two
    // alternatives. The other is a throw, and a throw is the failure mode
    // ADR-040 spent a whole decision containing: runDeadlineSweep awaits alert
    // calls inside its loop, so an engine that throws for a DATA reason takes
    // work down that had nothing to do with it. Silently reopening a closed
    // alert would be worse still.
    const closed = resolvedRecord();
    expect(acknowledge(closed)).toEqual(closed);
    expect(suppress(closed)).toEqual(closed);
    // Value equality, not reference equality: returning the same object is an
    // implementation choice and asserting it would pin something the spec has
    // no opinion about.
  });
});

// ----------------------------------------------------------- resolution --

describe("resolveAlert closes the alert and keeps the row", () => {
  it("closes it, stamps when, and stops it being unconfirmed", () => {
    // data-model.md: `resolvedAt | Null while open`, and `stale` is "A flag on
    // an OPEN alert" — so a closed alert cannot still be carrying it. The row
    // survives: "nothing is deleted to close an alert".
    const stale = markStale(firingRecord());
    const closed = resolveAlert(stale, SECOND_NIGHT);
    expect(closed.state).toBe(RESOLVED);
    expect(closed.resolvedAt).toBe(SECOND_NIGHT);
    expect(closed.stale, "a closed alert is not 'nobody confirmed this'").toBe(false);
    expect(isOpen(closed.state)).toBe(false);
  });

  it("keeps everything the alert was, because the record is the evidence", () => {
    // CLAUDE.md rule 7 in the small: the record is the thing. A resolution that
    // dropped the policy, the areas or the context would leave a closed alert
    // nobody can audit — which for a compliance alert is the whole value of it.
    const opened = firingRecord();
    const closed = resolveAlert(opened, SECOND_NIGHT);
    expect(sameIdentity(opened, closed)).toBe(true);
    expect(closed.policyId).toBe(opened.policyId);
    expect(closed.severity).toBe(opened.severity);
    expect([...closed.areas]).toEqual([...opened.areas]);
    expect(closed.context).toEqual(opened.context);
    expect(closed.firstSeenAt).toBe(opened.firstSeenAt);
  });

  it("is idempotent, and never rewrites when the alert actually closed", () => {
    // service-alerts-raise: "resolveAlert is idempotent: resolving a resolved or
    // unknown fingerprint succeeds and changes nothing." The instant matters as
    // much as the state — a second resolve moving `resolvedAt` to tonight would
    // silently restate when a compliance breach ended.
    const closed = resolveAlert(firingRecord(), SECOND_NIGHT);
    const again = resolveAlert(closed, THIRD_NIGHT);
    expect(again).toEqual(closed);
    expect(again.resolvedAt).toBe(SECOND_NIGHT);
  });

  it("closes an acknowledged or suppressed alert, because both are still open", () => {
    // The other side of assertion 5: acknowledgement pauses paging and leaves
    // the alert resolvable, so the ordinary end of an acknowledged alert is the
    // source ceasing to report it.
    for (const record of [acknowledgedRecord(), suppressedRecord()]) {
      const closed = resolveAlert(record, THIRD_NIGHT);
      expect(closed.state).toBe(RESOLVED);
      expect(closed.resolvedAt).toBe(THIRD_NIGHT);
    }
  });
});

// ---------------------------------------------- assertion 4, the flag itself --

describe("markStale flags an open alert without moving it", () => {
  it("leaves a firing alert firing, and stale", () => {
    // ASSERTION 4, AS BEHAVIOUR. lifecycle.test.ts proved the state vocabulary
    // has four members and the record has a boolean; this proves the function
    // uses them that way. "Alerts in an incomplete scope stay open, are marked
    // STALE, and are never resolved by absence — the run did not look, and not
    // looking is not the same as finding nothing" (flows-alerting.md).
    const stale = markStale(firingRecord());
    expect(stale.state, "STALE is a flag, not a fifth state").toBe(FIRING);
    expect(stale.stale).toBe(true);
    expect(isOpen(stale.state), "a frozen alert stays open").toBe(true);
    expect(stale.resolvedAt, "a dead watcher can never close an alert").toBeNull();
  });

  it("flags an acknowledged or suppressed alert without returning it to firing", () => {
    // Both are open, so both can go unconfirmed; and neither is un-acknowledged
    // by a run failing to reach it. This is the pair of orthogonal axes stated
    // as behaviour: state × stale, all combinations reachable.
    for (const [state, record] of [
      [ACKNOWLEDGED, acknowledgedRecord()],
      [SUPPRESSED, suppressedRecord()],
    ] as [AlertState, AlertRecord][]) {
      const stale = markStale(record);
      expect(stale.state).toBe(state);
      expect(stale.stale).toBe(true);
    }
  });

  it("does not move the last sighting, because the run that flags it is the run that missed it", () => {
    // The subtle one, and it is load-bearing for source liveness: an alert is
    // marked stale precisely BECAUSE no run carried it. Advancing `lastSeenAt`
    // here would make a dark source look like a healthy one — the failure ADR-020
    // calls "a detection engine that stops running produces no alerts, which
    // looks exactly like a healthy system".
    const stale = markStale(firingRecord());
    expect(stale.lastSeenAt).toBe(FIRST_NIGHT);
  });

  it("leaves a resolved alert alone: a closed alert is not unconfirmed", () => {
    // data-model.md is explicit that this is "A flag on an OPEN alert". Marking
    // a closed one would produce a record whose flag says a run failed to
    // confirm something that no run should be reporting at all.
    const closed = resolvedRecord();
    expect(markStale(closed)).toEqual(closed);
    expect(markStale(closed).stale).toBe(false);
  });

  it("is idempotent", () => {
    // Two runs in a row can both miss the same scope; the second must not
    // change anything, or "how long has this been unconfirmed" stops being
    // answerable from the row.
    const once = markStale(firingRecord());
    expect(markStale(once)).toEqual(once);
  });
});

describe("clearStale confirms an alert again without moving it", () => {
  it("clears the flag and leaves the state where it was", () => {
    // "cleared when one does" (data-model.md) — the counterpart of the rule
    // above, and the reason both exist as separate verbs from the state
    // machine: a run declaring a scope complete confirms its alerts without
    // acknowledging, suppressing or resolving any of them.
    const stale = markStale(acknowledgedRecord());
    const confirmed = clearStale(stale);
    expect(confirmed.stale).toBe(false);
    expect(confirmed.state, "confirming an alert is not un-acknowledging it").toBe(ACKNOWLEDGED);
    expect(isOpen(confirmed.state)).toBe(true);
  });

  it("changes nothing on an alert that was never flagged", () => {
    // The ordinary night: most alerts are confirmed by every run and were never
    // stale. Clearing must be free of side effects or every healthy sweep would
    // rewrite every row it touched.
    const opened = firingRecord();
    expect(clearStale(opened)).toEqual(opened);
    expect(clearStale(opened).lastSeenAt).toBe(FIRST_NIGHT);
  });
});

// ------------------------------------------------ invariants over everything --

describe("the invariants hold whatever is applied to whatever", () => {
  /** Every transition, as a named function of one record. */
  const TRANSITIONS: [string, (record: AlertRecord) => AlertRecord][] = [
    ["acknowledge", acknowledge],
    ["suppress", suppress],
    ["markStale", markStale],
    ["clearStale", clearStale],
    ["resolveAlert", (record) => resolveAlert(record, THIRD_NIGHT)],
    ["reassert", (record) => reassert(record, raise(), THIRD_NIGHT)],
  ];

  it("keeps `resolvedAt` empty exactly while the alert is open", () => {
    // THE INVARIANT THE WHOLE RECORD RESTS ON, stated over every transition
    // from every state rather than at the one place each is set. data-model.md:
    // "Null while open." A record that is open with a resolution instant, or
    // closed without one, cannot be reported on honestly — and both are one
    // careless spread away.
    for (const { state, record } of inEveryState()) {
      for (const [name, apply] of TRANSITIONS) {
        const after = apply(record);
        expect(after.resolvedAt === null, `${name} from ${state} left resolvedAt=${String(after.resolvedAt)} on a ${after.state} alert`)
          .toBe(isOpen(after.state));
      }
    }
  });

  it("never changes an alert's identity, from any state, through any verb", () => {
    // Dedupe is the fingerprint and nothing else. A transition that rewrote
    // either half would split one fact into two alerts on its next report — and
    // the old one, now unreachable, would never resolve.
    for (const { state, record } of inEveryState()) {
      for (const [name, apply] of TRANSITIONS) {
        expect(sameIdentity(record, apply(record)), `${name} from ${state}`).toBe(true);
      }
    }
  });

  it("never moves the first sighting", () => {
    // "Survives re-firing" (data-model.md). How long a breach has been open is
    // measured from here, and every escalation policy above this engine reads
    // it.
    for (const { state, record } of inEveryState()) {
      for (const [name, apply] of TRANSITIONS) {
        expect(apply(record).firstSeenAt, `${name} from ${state}`).toBe(record.firstSeenAt);
      }
    }
  });

  it("only ever ends in one of ADR-020's four states", () => {
    // The closure property. Every verb lands the alert somewhere the vocabulary
    // already knows, so no transition can invent the fifth state that assertion
    // 4 exists to forbid.
    const four: AlertState[] = [FIRING, ACKNOWLEDGED, SUPPRESSED, RESOLVED] as AlertState[];
    for (const { state, record } of inEveryState()) {
      for (const [name, apply] of TRANSITIONS) {
        expect(four, `${name} from ${state}`).toContain(apply(record).state);
      }
    }
  });

  it("never lowers severity except by passing through a resolve", () => {
    // Assertion 3 as a property of the whole machine rather than of one
    // function: the ONLY way down is resolve-then-reopen, so every transition
    // applied to an open alert leaves severity where it was or above.
    for (const { state, record } of inEveryState().filter((entry) => entry.state !== RESOLVED)) {
      for (const [name, apply] of TRANSITIONS) {
        const after = apply(record);
        expect(rank(after.severity), `${name} from ${state}`).toBeGreaterThanOrEqual(rank(record.severity));
      }
    }
  });
});
