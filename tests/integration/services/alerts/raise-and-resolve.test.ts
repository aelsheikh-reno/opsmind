// raiseAlert and resolveAlert against a real engine (ADR-038): assertions 1, 2,
// 3, 4 and 7 of tasks/backlog.yaml#service-alerts-raise, plus the node's
// corrected note — "the engine must not throw for a data reason".
//
// Assertions 5 and 6 need the merged deadline monitor driving the engine and
// live next door in dedupe-across-verbs.test.ts.
//
// WRITTEN FROM THE SPECIFICATION; the sources are listed at the top of
// engine.ts, which also states why the wiring is discovered and the behaviour
// is not.
//
// WHY THIS IS AN INTEGRATION FILE AND NOT A UNIT ONE. Every assertion of this
// node is about what SURVIVES a call. "Two raises produce one open alert" is a
// claim about rows; "the earlier resolution stays in the record" is a claim
// about an append-only table; "the context is stored whole" is a claim about a
// json column. A fake store would answer all three from the same code that put
// the values there — which is the failure the node's note names, one layer up:
// a merged module whose alerts go nowhere. So the store is the real one, the
// read-back is `db`, and the write is always through the public surface.
//
// THE CONVENTIONS ARE tests/integration/services/alerts/repository.test.ts's.
// `db` is used only where the PORT CANNOT EXPRESS the check — counting rows,
// reading AlertArea and AlertEvent, which no published verb returns. Every
// write goes through `@/lib/services/alerts` and nothing deeper, or this file
// stops testing the engine and starts testing Prisma.
//
// NO CASE ASSERTS A WALL-CLOCK VALUE. Whether the engine takes an injected
// clock is not specified, so `engine.tick()` moves time by whichever mechanism
// this engine respects and the assertions are about ORDER and IDENTITY of
// instants, never about a literal.
import { describe, expect, it } from "vitest";

import { integrationDatabase } from "../../support/database";
import { alertCountFor, alertEngine, alertFor, areasOf, eventsFor } from "./engine";

// Order is load-bearing: integrationDatabase swaps DATABASE_URL and evicts the
// cached client, so everything reaching the database is imported AFTER it.
const db = await integrationDatabase("alerts_raise");
const engine = await alertEngine(db);

// A real fingerprint's shape, `{tenant}:{app}:{source}:{entity}:{policy}`. Used
// whole, separators and all, because it is opaque and is never split.
const FP = "reno:opsmind:deadline-monitor:document:1:expiry";
const OTHER = "reno:opsmind:deadline-monitor:document:2:expiry";

const AREA = "AE";
const POLICY = "expiry";

const raise = (
  fingerprint: string,
  severity: "minor" | "major",
  policyId = POLICY,
  areas: readonly string[] = [AREA],
  context: Record<string, unknown> = {},
) => engine.raiseAlert(fingerprint, severity, policyId, areas, context);

/** The row, or a failure that says the raise never landed rather than a
 *  `Cannot read properties of null`. */
async function stored(fingerprint: string) {
  const row = await alertFor(db, fingerprint);
  if (row === null) {
    throw new Error(
      `no Alert row carries ${fingerprint} after a raise through the public surface ` +
        `(${engine.how}). The node exists because "every raiseAlert the deadline monitor ` +
        'makes goes to nothing"; a raise that resolves and records nothing is that failure.',
    );
  }
  return row;
}

// --------------------------------------------------------------- assertion 1 --

describe("two raises of one fingerprint produce one open alert, not two", () => {
  it("lands the first raise as one open alert", async () => {
    // The floor. There is no dedupe to speak of if the raise does not arrive,
    // and this is the case that separates a wired engine from HEAD's, which
    // resolves a promise and records nothing.
    await raise(FP, "minor");

    const row = await stored(FP);
    expect(row.state).toBe("firing");
    expect(row.resolvedAt).toBeNull();
    expect(row.stale).toBe(false);
    expect(row.policyId).toBe(POLICY);
    expect(await db.alert.count()).toBe(1);
  });

  it("keeps one row when the identical raise arrives again", async () => {
    // THE ASSERTION. `@@unique([sourceId, fingerprint])` IS the dedupe
    // (data-model.md): reporting the same fingerprint twice updates one row and
    // never creates a second identity for one fact.
    await raise(FP, "minor");
    await engine.tick();
    await raise(FP, "minor");

    expect(await alertCountFor(db, FP)).toBe(1);
    expect((await stored(FP)).state).toBe("firing");
  });

  it("keeps one row when the second raise differs in policy, areas and context", async () => {
    // Severity is deliberately absent from the identity and so is everything
    // else on the raise: the fingerprint is the whole of it. An engine keying
    // on more than the fingerprint would open a second alert for one fact every
    // time a caller's diagnostic bag changed — which it does on every run.
    await raise(FP, "minor", "expiry", ["AE"], { run: 1 });
    await engine.tick();
    await raise(FP, "major", "expiry-v2", ["AE", "EG"], { run: 2 });

    expect(await alertCountFor(db, FP)).toBe(1);
    expect(await db.alert.count()).toBe(1);
  });

  it("keeps the first sighting across a second raise, and moves the last one", async () => {
    // `firstSeenAt` — "when this identity first fired. SURVIVES re-firing";
    // `lastSeenAt` — "the most recent run or raise that carried it"
    // (data-model.md). A dedupe that rewrote the first sighting would report a
    // three-month-old breach as new.
    await raise(FP, "minor");
    const first = await stored(FP);
    await engine.tick();
    await raise(FP, "minor");
    const second = await stored(FP);

    expect(second.id).toBe(first.id);
    expect(second.firstSeenAt).toEqual(first.firstSeenAt);
    expect(second.lastSeenAt.getTime()).toBeGreaterThan(first.lastSeenAt.getTime());
  });

  it("still treats two fingerprints as two alerts, so the dedupe is not just 'one row'", async () => {
    // The discriminating half of assertion 1. An engine that collapsed
    // everything into one row would pass every case above.
    await raise(FP, "minor");
    await raise(OTHER, "minor");

    expect(await db.alert.count()).toBe(2);
    expect(await alertCountFor(db, FP)).toBe(1);
    expect(await alertCountFor(db, OTHER)).toBe(1);
  });

  it("keeps apart two fingerprints that differ only inside an escape", async () => {
    // `fingerprintFor` escapes `:` and `\` inside a segment, so an engine that
    // trimmed, unescaped or split would merge two identities into one and make
    // an alert not merely wrong but INVISIBLE — the failure the escaping exists
    // to prevent (data-model.md, Alert.fingerprint).
    const escaped = "reno:opsmind:deadline-monitor:document\\:1:expiry";
    const plain = "reno:opsmind:deadline-monitor:document:1:expiry";
    await raise(escaped, "minor");
    await raise(plain, "minor");

    expect(await db.alert.count()).toBe(2);
    expect((await stored(escaped)).fingerprint).toBe(escaped);
  });
});

// --------------------------------------------------------------- assertion 2 --

describe("a second raise raises severity in place, and never lowers it", () => {
  it("raises minor to major on the same row", async () => {
    await raise(FP, "minor");
    const before = await stored(FP);
    await engine.tick();
    await raise(FP, "major");

    const after = await stored(FP);
    expect(after.id).toBe(before.id);
    expect(after.severity).toBe("major");
    expect(await alertCountFor(db, FP)).toBe(1);
  });

  it("leaves the severity where it was when a LOWER one arrives", async () => {
    // The case a naive implementation gets wrong, because the obvious `update`
    // overwrites. Read back from the store, never from a return value: an
    // engine that computes the right answer and writes the incoming one is
    // exactly the shape this reads through.
    //
    // "Severity … is MONOTONIC while an alert is open: it may rise in place; a
    // genuine downgrade is resolve-then-reopen" (data-model.md, Alert.severity;
    // flows-alerting.md, "The contract").
    await raise(FP, "major");
    await engine.tick();
    await raise(FP, "minor");

    expect((await stored(FP)).severity).toBe("major");
  });

  it("stays at the high-water mark across minor, major, minor", async () => {
    await raise(FP, "minor");
    await engine.tick();
    await raise(FP, "major");
    await engine.tick();
    await raise(FP, "minor");

    expect((await stored(FP)).severity).toBe("major");
    expect(await alertCountFor(db, FP)).toBe(1);
  });

  it("changes nothing when the same severity is reported again", async () => {
    await raise(FP, "major");
    await engine.tick();
    await raise(FP, "major");
    expect((await stored(FP)).severity).toBe("major");
  });

  it("never lowers severity, for either ordered pair, from either starting point", async () => {
    // The invariant rather than one instance of it: for every pair the port can
    // send, the stored severity after two raises is the higher of the two. Two
    // levels is the whole vocabulary today (`enum AlertSeverity { minor major }`),
    // so this is exhaustive rather than sampled.
    const levels = ["minor", "major"] as const;
    const higher = (a: string, b: string) => (a === "major" || b === "major" ? "major" : "minor");

    for (const first of levels) {
      for (const second of levels) {
        const fingerprint = `reno:opsmind:deadline-monitor:document:${first}-${second}:expiry`;
        await raise(fingerprint, first);
        await engine.tick();
        await raise(fingerprint, second);
        const row = await stored(fingerprint);
        expect(row.severity, `${first} then ${second} stored ${row.severity}`).toBe(higher(first, second));
      }
    }
  });

  it("raises severity without closing, reopening or restarting the alert", async () => {
    // Escalation must not be a new identity: "severity is not part of the
    // fingerprint (escalation would break dedupe)" (flows-alerting.md).
    await raise(FP, "minor");
    const before = await stored(FP);
    await engine.tick();
    await raise(FP, "major");

    const after = await stored(FP);
    expect(after.id).toBe(before.id);
    expect(after.firstSeenAt).toEqual(before.firstSeenAt);
    expect(after.state).toBe("firing");
    expect(after.resolvedAt).toBeNull();
  });
});

// --------------------------------------------------------------- assertion 3 --

describe("resolveAlert is idempotent", () => {
  it("closes an open alert and keeps the row, because nothing is deleted to close an alert", async () => {
    await raise(FP, "major");
    const open = await stored(FP);
    await engine.tick();
    await engine.resolveAlert(FP);

    const closed = await stored(FP);
    expect(closed.id).toBe(open.id);
    expect(closed.state).toBe("resolved");
    expect(closed.resolvedAt).not.toBeNull();
    expect(await alertCountFor(db, FP)).toBe(1);
  });

  it("succeeds for a fingerprint nothing has raised, and creates nothing", async () => {
    // "resolving a resolved or UNKNOWN fingerprint succeeds and changes
    // nothing". Not a throw, and not a phantom row either — an engine that
    // upserted-then-resolved would satisfy "succeeds" while inventing an alert
    // for a condition nobody ever detected.
    await expect(engine.resolveAlert("reno:opsmind:deadline-monitor:document:404:expiry")).resolves.not.toThrow();

    expect(await db.alert.count()).toBe(0);
    expect(await db.alertEvent.count()).toBe(0);
    expect(await db.alertArea.count()).toBe(0);
  });

  it("succeeds for an already-resolved fingerprint and changes nothing at all", async () => {
    // "Idempotent, and the original instant is kept — re-resolving must not
    // rewrite when the alert actually closed" (lifecycle.ts, merged). The tick
    // between the two calls is what makes a rewrite visible.
    await raise(FP, "major", "expiry", ["AE", "EG"], { note: "first" });
    await engine.resolveAlert(FP);
    const once = await stored(FP);
    const historyOnce = await eventsFor(db, once.id);

    await engine.tick();
    await engine.resolveAlert(FP);
    const twice = await stored(FP);

    expect(twice.state).toBe("resolved");
    expect(twice.resolvedAt).toEqual(once.resolvedAt);
    expect(twice.severity).toBe(once.severity);
    expect(twice.policyId).toBe(once.policyId);
    expect(twice.lastSeenAt).toEqual(once.lastSeenAt);
    expect(twice.context).toEqual(once.context);
    expect(areasOf(twice)).toEqual(areasOf(once));
    // Append-only: a second resolve of a resolved alert is not a state change,
    // so it has no event to record.
    expect((await eventsFor(db, once.id)).length).toBe(historyOnce.length);
  });

  it("resolves the alert it was asked about and nothing else", async () => {
    await raise(FP, "major");
    await raise(OTHER, "major");
    await engine.resolveAlert(FP);

    expect((await stored(FP)).state).toBe("resolved");
    expect((await stored(OTHER)).state).toBe("firing");
    expect((await stored(OTHER)).resolvedAt).toBeNull();
  });

  it("does not resolve a fingerprint that differs anywhere", async () => {
    // Compared whole, with `===`. Two strings that differ anywhere are two
    // alerts, so a near miss must close nothing — a prefix or case-insensitive
    // match would close a compliance alert nobody resolved.
    await raise(FP, "major");
    await engine.resolveAlert(FP.toUpperCase());
    await engine.resolveAlert(`${FP}x`);
    await engine.resolveAlert(FP.slice(0, -1));

    expect((await stored(FP)).state).toBe("firing");
    expect(await db.alert.count()).toBe(1);
  });
});

// --------------------------------------------------------------- assertion 4 --

describe("a raise for a resolved fingerprint reopens it, and the earlier resolution stays in the record", () => {
  it("opens it again as firing, with no resolution instant left on the row", async () => {
    await raise(FP, "major");
    await engine.resolveAlert(FP);
    await engine.tick();
    await raise(FP, "major");

    const row = await stored(FP);
    expect(row.state).toBe("firing");
    expect(row.resolvedAt).toBeNull();
    expect(row.stale).toBe(false);
    expect(await alertCountFor(db, FP)).toBe(1);
  });

  it("leaves the earlier resolution in the event log, untouched", async () => {
    // THE ASSERTION, AND WHY IT IS READ HERE. "The earlier resolution stays in
    // the record" cannot be met by a field on the alert: the row is firing and
    // `resolvedAt` is null again, so the only place the closure can survive is
    // AlertEvent — "append-only … NEVER UPDATED, NEVER DELETED", and it is "why
    // the current state can be trusted" (data-model.md).
    //
    // The whole event row is captured and compared afterwards, so an engine
    // that rewrote the resolution in place, or deleted it on reopen, fails here
    // rather than in an ordering assertion the log's timestamps might tie on.
    await raise(FP, "major");
    const alert = await stored(FP);
    await engine.tick();
    await engine.resolveAlert(FP);

    const closed = (await eventsFor(db, alert.id)).filter((event) => event.kind === "resolved");
    expect(
      closed,
      "resolving an alert recorded no `resolved` event, so nothing can testify that it ever closed",
    ).toHaveLength(1);

    await engine.tick();
    await raise(FP, "major");

    const survivor = await db.alertEvent.findUnique({ where: { id: closed[0].id } });
    expect(survivor, "the reopen destroyed the resolution event").not.toBeNull();
    expect(survivor).toEqual(closed[0]);
    // And it is still readable as this alert's history, not orphaned onto a
    // second row the reopen created.
    expect((await eventsFor(db, alert.id)).map((event) => event.id)).toContain(closed[0].id);
  });

  it("keeps one identity across resolve and reopen, with its original first sighting", async () => {
    await raise(FP, "major");
    const original = await stored(FP);
    await engine.tick();
    await engine.resolveAlert(FP);
    await engine.tick();
    await raise(FP, "major");

    const reopened = await stored(FP);
    expect(reopened.id).toBe(original.id);
    expect(reopened.firstSeenAt).toEqual(original.firstSeenAt);
    expect(reopened.lastSeenAt.getTime()).toBeGreaterThan(original.lastSeenAt.getTime());
  });

  it("takes the incoming severity on reopen, which is the only way a downgrade is expressed", async () => {
    // "a genuine downgrade is resolve-then-reopen" (flows-alerting.md,
    // data-model.md). Monotonicity binds an OPEN alert; a reopened one starts
    // clean at what the caller just said, or the sentence above buys nothing.
    await raise(FP, "major");
    await engine.resolveAlert(FP);
    await engine.tick();
    await raise(FP, "minor");

    const row = await stored(FP);
    expect(row.state).toBe("firing");
    expect(row.severity).toBe("minor");
  });

  it("records the reopen as well, so the row's history shows both", async () => {
    // The other half of "stays in the record": a log that kept the resolution
    // and recorded nothing for the reopen would leave the current state
    // untestifiable, which is the one thing AlertEvent exists for.
    await raise(FP, "major");
    const alert = await stored(FP);
    await engine.tick();
    await engine.resolveAlert(FP);
    const beforeReopen = await eventsFor(db, alert.id);
    await engine.tick();
    await raise(FP, "major");

    expect((await eventsFor(db, alert.id)).length).toBeGreaterThan(beforeReopen.length);
  });
});

// ------------------------------------ what the append-only log says happened --

describe("the event log distinguishes what happened, and claims a transition only where one happened", () => {
  // The AlertEvent card is "every state change and what caused it", and it is
  // "why the current state can be trusted" — NEVER UPDATED, NEVER DELETED. An
  // entry that names a transition nothing made is therefore worse than a
  // missing one: it cannot be corrected, and `service-alerts-store`'s own
  // assertion is that every state change is recorded "carrying what changed it".
  //
  // WHAT IS ASSERTED AND WHAT IS DELIBERATELY NOT. `kind` has nine members on
  // the card and no document fixes which one a re-raise or an escalation must
  // carry, so no case below spells one — except `resolved`, which is the card's
  // own word for closing and which assertion 4 already turns on. What the card
  // DOES fix is the meaning of the pair beside it:
  //
  //   "fromState, toState | enum | null | Null where the kind changes no state
  //    — a reassert or a stale flag"
  //
  // That is a rule about state and not about spelling, and it is asserted
  // literally. Everything else here asserts DISTINCTIONS: three different
  // things happened, so the log must call them three different things, or it
  // cannot say which of them it was.

  /** The nine the card names, and the only nine. */
  const CARD_KINDS = [
    "raised",
    "reasserted",
    "severity_raised",
    "stale_marked",
    "stale_cleared",
    "acknowledged",
    "suppressed",
    "unsuppressed",
    "resolved",
  ];

  it("records a first sighting and an ordinary re-raise as two different things", async () => {
    await raise(FP, "minor");
    const alert = await stored(FP);
    expect(await eventsFor(db, alert.id), "a first raise recorded no event at all").toHaveLength(1);

    await engine.tick();
    await raise(FP, "minor");

    const history = await eventsFor(db, alert.id);
    expect(history, "the second raise recorded no event").toHaveLength(2);
    expect(
      history[1].kind,
      "an ordinary re-raise is logged as the same thing as a first sighting, so nothing in the " +
        "record can say which alerts are new",
    ).not.toBe(history[0].kind);
  });

  it("records a first sighting, a re-raise and an escalation as three different things", async () => {
    // One event per thing that happened, and three things happened: an alert
    // opened, the same condition was seen again unchanged, and its severity
    // rose. A log that collapses any two of those has lost the difference
    // permanently.
    await raise(FP, "minor");
    const alert = await stored(FP);
    await engine.tick();
    await raise(FP, "minor");
    await engine.tick();
    await raise(FP, "major");

    const history = await eventsFor(db, alert.id);
    expect(history).toHaveLength(3);
    expect(
      new Set(history.map((event) => event.kind)).size,
      `three different things happened and the log calls them: ${history.map((event) => event.kind).join(", ")}`,
    ).toBe(3);
  });

  it("claims NO state change on a re-raise or an escalation, because neither moved the alert", async () => {
    // data-model.md, AlertEvent: "fromState, toState … Null where the kind
    // changes no state — a reassert or a stale flag." A re-raise leaves a
    // firing alert firing, and an escalation raises SEVERITY, which is its own
    // column and not a state. An entry reading firing -> firing is a transition
    // that did not happen, written where it can never be taken back.
    await raise(FP, "minor");
    const alert = await stored(FP);
    await engine.tick();
    await raise(FP, "minor");
    await engine.tick();
    await raise(FP, "major");

    // The premise, stated rather than assumed: the alert never left firing.
    expect((await stored(FP)).state).toBe("firing");

    const [, reasserted, escalated] = await eventsFor(db, alert.id);
    for (const event of [reasserted, escalated]) {
      expect(event.fromState, `${event.kind} recorded a state it moved from`).toBeNull();
      expect(event.toState, `${event.kind} recorded a state it moved to`).toBeNull();
    }
  });

  it("records the transition a first sighting DID make", async () => {
    // The other half of the same rule: an event that changes state names the
    // state it reached. An alert opens firing (ADR-020), and there was no state
    // before it, so exactly one of the pair can be filled.
    await raise(FP, "minor");
    const alert = await stored(FP);

    const [opened] = await eventsFor(db, alert.id);
    expect(opened.toState, "the first sighting did not record that the alert opened").toBe("firing");
    expect(opened.fromState, "the first sighting named a state that existed before the alert did").toBeNull();
  });

  it("records the close and the reopen as the transitions they are, so neither reads as a first sighting", async () => {
    // Assertion 4 from the log's side. The reopen and the first sighting both
    // end firing and may legitimately carry the same kind; what must tell them
    // apart is WHERE EACH CAME FROM, and that is the pair the card fixes.
    await raise(FP, "major");
    const alert = await stored(FP);
    await engine.tick();
    await engine.resolveAlert(FP);
    await engine.tick();
    await raise(FP, "major");

    const [opened, closed, reopened] = await eventsFor(db, alert.id);
    expect(closed.kind).toBe("resolved");
    expect(closed.fromState).toBe("firing");
    expect(closed.toState).toBe("resolved");
    expect(
      reopened.fromState,
      "the reopen did not record what it reopened FROM, so nothing distinguishes it from an alert " +
        "seen for the first time",
    ).toBe("resolved");
    expect(reopened.toState).toBe("firing");
    expect(reopened.fromState).not.toBe(opened.fromState);
  });

  it("stamps each event with the instant the change it describes happened", async () => {
    // `at` is the whole reason an append-only log is a HISTORY rather than a
    // bag. Asserted against the columns the same call wrote on the alert —
    // `firstSeenAt`/`lastSeenAt` are "when this identity first fired" and "the
    // most recent run or raise that carried it", `resolvedAt` is when it closed
    // — so no case here needs a wall-clock literal or a clock the engine may
    // not have taken.
    await raise(FP, "minor");
    const opened = await stored(FP);
    const [opening] = await eventsFor(db, opened.id);
    expect(opening.at, "the opening event is not stamped when the alert opened").toEqual(opened.firstSeenAt);

    await engine.tick();
    await raise(FP, "minor");
    const seenAgain = await stored(FP);
    const [, reasserted] = await eventsFor(db, opened.id);
    expect(reasserted.at, "the re-raise event is not stamped when the raise arrived").toEqual(seenAgain.lastSeenAt);

    await engine.tick();
    await engine.resolveAlert(FP);
    const closed = await stored(FP);
    const [, , resolved] = await eventsFor(db, opened.id);
    expect(resolved.at, "the resolution event is not stamped when the alert closed").toEqual(closed.resolvedAt);
    expect(resolved.at.getTime()).toBeGreaterThan(opening.at.getTime());
  });

  it("writes only kinds the card names, with no actor and no run behind them", async () => {
    // `actor` — "NULL MEANS THE SOURCE OR THE ENGINE DID IT, and a human
    // resolve is the case that must never be indistinguishable from an
    // automatic one". Nothing in this node has an actor: both verbs are a
    // source talking. `runId` — "the run that caused it, WHERE A RUN DID", and
    // neither verb here carries one.
    await raise(FP, "minor");
    const alert = await stored(FP);
    await engine.tick();
    await raise(FP, "minor");
    await engine.tick();
    await raise(FP, "major");
    await engine.tick();
    await engine.resolveAlert(FP);
    await engine.tick();
    await raise(FP, "minor");

    const history = await eventsFor(db, alert.id);
    expect(history.length).toBeGreaterThanOrEqual(5);
    for (const event of history) {
      expect(CARD_KINDS, `the log carries a kind the card does not name: ${event.kind}`).toContain(event.kind);
      expect(event.actor, "an event this node wrote claims a human caused it").toBeNull();
      expect(event.runId, "an event this node wrote claims a run caused it").toBeNull();
    }
  });
});

// --------------------------------------------------------------- assertion 7 --

describe("the context a source supplies is stored whole and nothing in it is interpreted", () => {
  // A bag chosen to be hostile: every key below is one an engine might be
  // tempted to read, and several are the caller's own words for things the
  // engine has its own argument for.
  const BAG: Record<string, unknown> = {
    area: "ZZ",
    areas: ["XX", "YY"],
    jurisdictionId: "QQ",
    scope: "SS",
    severity: "major",
    state: "resolved",
    stale: true,
    policyId: "something-else",
    fingerprint: "not-this-one",
    sourceId: "not-this-source",
    resolvedAt: "2020-01-01T00:00:00.000Z",
    nested: { deep: { count: 3, flag: false } },
    list: [1, "two", null, { three: 3 }],
    empty: {},
    zero: 0,
    blank: "",
    unicode: "تأشيرة — الإمارات",
    "a key with spaces and : colons": "kept",
  };

  it("stores the caller's bag exactly as given, key for key and value for value", async () => {
    await raise(FP, "minor", POLICY, [AREA], BAG);
    expect((await stored(FP)).context).toEqual(BAG);
  });

  it("scopes the alert by the areas ARGUMENT and never by a scope key in the context", async () => {
    // ADR-040, and the reason the argument exists at all: "The engine must
    // never dig a scope out of `context` — that bakes one caller's vocabulary
    // into a component built to be imported by several applications (ADR-039),
    // and a caller that spells the key differently loses its scoping silently
    // rather than loudly." The bag offers `area`, `areas`, `jurisdictionId` and
    // `scope`; the argument says AE, and AE is what the alert must be scoped by.
    await raise(FP, "minor", POLICY, [AREA], BAG);

    const row = await stored(FP);
    expect(areasOf(row)).toEqual(new Set([AREA]));
    expect(await db.alertArea.count()).toBe(1);
  });

  it("does not take severity, state, policy or identity out of the context either", async () => {
    // The bag says major, resolved, stale, a different policy, a different
    // fingerprint and a different source. Every one of those is an ARGUMENT or
    // is the engine's own, and the bag is "the source's own diagnostic payload"
    // — carried whole and never read (data-model.md, Alert.context).
    await raise(FP, "minor", POLICY, [AREA], BAG);

    const row = await stored(FP);
    expect(row.severity).toBe("minor");
    expect(row.state).toBe("firing");
    expect(row.stale).toBe(false);
    expect(row.policyId).toBe(POLICY);
    expect(row.fingerprint).toBe(FP);
    expect(row.resolvedAt).toBeNull();
  });

  it("carries several areas when the caller names several, because one fault can span scopes", async () => {
    // ADR-044: the areas name where the IMPACT is, not where the fault is —
    // one unconfigured deadline type affects every jurisdiction holding one, so
    // three areas is one alert and never three.
    await raise(FP, "major", "no-threshold-configured", ["AE", "EG", "KW"], BAG);

    expect(areasOf(await stored(FP))).toEqual(new Set(["AE", "EG", "KW"]));
    expect(await alertCountFor(db, FP)).toBe(1);
  });

  it("replaces the areas on a later raise rather than accumulating them", async () => {
    // An alert must not keep claiming a scope it has left. Resolution by
    // absence asks whether ALL of an alert's areas were inside the set a run
    // declared complete (data-model.md, AlertArea, "Why a row per area"), so an
    // area that is no longer affected but is still recorded is one nothing can
    // ever resolve — the alert freezes open for a scope it left.
    await raise(FP, "major", "no-threshold-configured", ["AE", "EG", "KW"], {});
    expect(areasOf(await stored(FP))).toEqual(new Set(["AE", "EG", "KW"]));

    await engine.tick();
    await raise(FP, "major", "no-threshold-configured", ["AE"], {});

    expect(areasOf(await stored(FP))).toEqual(new Set(["AE"]));
    expect(await db.alertArea.count()).toBe(1);
  });

  it("accepts an empty context and stores an empty one", async () => {
    await raise(FP, "minor", POLICY, [AREA], {});
    expect((await stored(FP)).context).toEqual({});
  });

  it("replaces the bag on a later raise rather than merging it", async () => {
    // The caller's payload describes the CURRENT sighting. A merge would leave
    // last week's `businessDaysRemaining` beside this week's, and a reader
    // could not tell which was which.
    await raise(FP, "minor", POLICY, [AREA], { run: 1, gone: true });
    await engine.tick();
    await raise(FP, "minor", POLICY, [AREA], { run: 2 });

    expect((await stored(FP)).context).toEqual({ run: 2 });
  });
});

// ------------------------------------------- the engine does not throw for data --

describe("nothing about the data a caller sends is an error", () => {
  // The node's corrected note: a throw is survivable now — ADR-040 guards both
  // misconfiguration raises — but it "costs those areas their completeness for
  // the night, which means nothing in them resolves". So every case below is a
  // condition the engine must ACCEPT and RECORD, never refuse.

  it("accepts a policyId no configuration mentions, and records it verbatim", async () => {
    // "an unknown policy is accepted, never refused" (data-model.md,
    // Alert.policyId); assertion 5 and ADR-040 both say so.
    const unknown = "visa-expiry-window-v3";
    await expect(raise(FP, "major", unknown)).resolves.not.toThrow();
    expect((await stored(FP)).policyId).toBe(unknown);
  });

  it("keeps a policyId's exact bytes — case, spaces and separators", async () => {
    const odd = "  Policy:Visa Expiry / v3  ";
    await raise(FP, "major", odd);
    expect((await stored(FP)).policyId).toBe(odd);
  });

  it("accepts an empty policyId rather than dropping the alert", async () => {
    // The boundary of "accepted, never refused": the card states the rule with
    // no condition, and a breach discarded because its policy string was empty
    // is a compliance failure nobody is told about.
    await expect(raise(FP, "major", "")).resolves.not.toThrow();
    expect((await stored(FP)).policyId).toBe("");
  });

  it("accepts a raise that names no area at all", async () => {
    // An alert with no area can never be resolved by absence, which is a
    // consequence for the NEXT verb and not a reason to refuse this one.
    await expect(raise(FP, "major", POLICY, [])).resolves.not.toThrow();
    expect(areasOf(await stored(FP))).toEqual(new Set());
  });

  it("accepts a source with no AlertSource configuration row", async () => {
    // "No relation to AlertSource: a source with no configuration row still
    // gets its alerts recorded" (schema; data-model.md, Alert.sourceId).
    expect(await db.alertSource.count()).toBe(0);
    await expect(raise(FP, "minor")).resolves.not.toThrow();
    expect(await alertCountFor(db, FP)).toBe(1);
  });

  it("accepts every combination of odd policy, areas and context without rejecting one", async () => {
    // The property, over the shapes a caller can legitimately produce: NONE of
    // them is an error. An engine that validates any one of these takes an area
    // incomplete for the night and resolves nothing in it (ADR-040).
    const policies = ["", "unknown-policy", "  spaced  ", "policy:with:separators", "🙂"];
    const areaSets: readonly (readonly string[])[] = [[], ["AE"], ["AE", "EG", "KW"], [""]];
    const bags: Record<string, unknown>[] = [{}, { a: null }, { deep: { deeper: [1, 2] } }, { "": "" }];

    let index = 0;
    for (const policyId of policies) {
      for (const areas of areaSets) {
        for (const context of bags) {
          const fingerprint = `reno:opsmind:deadline-monitor:document:${(index += 1)}:odd`;
          await expect(
            raise(fingerprint, "minor", policyId, areas, context),
            `refused policy=${JSON.stringify(policyId)} areas=${JSON.stringify(areas)} context=${JSON.stringify(context)}`,
          ).resolves.not.toThrow();
          expect(await alertCountFor(db, fingerprint)).toBe(1);
        }
      }
    }
    expect(await db.alert.count()).toBe(index);
  });

  it("accepts a fingerprint carrying separators and escapes, and keeps it whole", async () => {
    const awkward = "reno:opsmind:deadline-monitor:document\\:1\\\\:expiry";
    await expect(raise(awkward, "major")).resolves.not.toThrow();
    expect((await stored(awkward)).fingerprint).toBe(awkward);
  });

  it("accepts resolveAlert for a fingerprint nothing has raised", async () => {
    await expect(engine.resolveAlert("nothing:has:ever:raised:this")).resolves.not.toThrow();
  });
});
