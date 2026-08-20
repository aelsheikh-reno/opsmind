// tasks/backlog.yaml#service-alerts-atomic-event, ASSERTION 2:
//
//   "A failure writing the event leaves the alert row unchanged, proved by
//    forcing the event write to fail"
//
// and the half of ASSERTION 1 no successful write can show — that the row and
// its event are ONE transaction rather than two writes that usually both land.
//
// WHY THE FAILURE IS FORCED AT THE ENGINE. The node calls this an AUDIT HOLE,
// NOT A CRASH: current state stays correct and the history gains a gap, so
// nothing is thrown, nothing is logged, and the only evidence is a row that
// moved with no event beside it. A stub that throws before the database is
// touched proves that an error propagates, which was never in question. A
// `CHECK (false)` on AlertEvent puts the failure where a real one goes — after
// the alert upsert has already executed inside the transaction — so what is
// measured is whether the engine unwinds a write it has already done.
//
// AND THE COUNTERFACTUAL IS A CASE, NOT A COMMENT. A rollback test that would
// also pass without a transaction proves nothing: if the row simply never moved
// under this failure, every implementation passes. So the same forced failure is
// run through the two separate verbs the port still carries, and that case
// asserts the row DID move with nothing logged. The pair is the proof — one
// shows the shape under test holds, the other shows the measurement can see it
// fail. lessons.md, "executing is not being asserted about".
//
// WHAT ITS AUTHOR READ. The node; data-model.md's Alert and AlertEvent cards;
// flows-alerting.md; ADR-020/038/039/040/043/044; lessons.md; the merged public
// surface lib/services/alerts/index.ts for its exported types; and the diff of
// lib/ under review. No implementation body, and no expected value below was
// obtained by running anything.
//
// A SCHEMA OF ITS OWN (ADR-038 and the convention in ../../support/database.ts):
// this file adds and drops a table constraint, and a file sharing a schema with
// it would see AlertEvent writes refused for reasons of its own.
import { describe, expect, it } from "vitest";
import type { AlertRecord } from "@/lib/services/alerts";
import { afterARefusal, integrationDatabase, integrationSchema, refusalFrom } from "../../support/database";
import { atomicWriter, withEventWritesRefused, type AlertChangeLike } from "./atomic";
import { alertCountFor, alertEngine, alertFor, eventsFor } from "./engine";

// Order is load-bearing, as in repository.test.ts: integrationDatabase swaps
// DATABASE_URL and evicts the cached client, so everything that reaches the
// database is imported dynamically AFTER it.
// One name for the schema, used to obtain it and to address it. The forced
// failure below is a DDL change, and under DATABASE_URL every integration file
// shares one database with a schema apiece — so the cases must say WHICH schema
// they are altering, and must derive it by the harness's own rule rather than
// by a second copy of it that can drift.
const SCHEMA = "alerts_atomic";
const db = await integrationDatabase(SCHEMA);
const schema = integrationSchema(SCHEMA);

const repository = (await import("@/lib/services/alerts/repository")) as Record<string, unknown>;
const store = repository.prismaAlertStore as Record<string, unknown> | undefined;

/** The seven verbs the merged suite already holds the store to; the atomic
 *  writer is the member beyond them (see ./atomic.ts for why it is found and
 *  not named). Kept in step with repository.test.ts's CONTRACT by hand is
 *  exactly the drift ./atomic.ts's message tells the next author about. */
const CONTRACT = [
  "upsertAlert",
  "getAlert",
  "listAlerts",
  "recordAlertEvent",
  "listAlertEvents",
  "upsertAlertSource",
  "getAlertSource",
] as const;

const engine = await alertEngine(db);

const at = (iso: string): Date => new Date(iso);

const SOURCE = "deadlines";
const FINGERPRINT = "reno:opsmind:deadlines:doc-1:expiry";
const RAISED = at("2026-08-01T03:00:00.000Z");
const CLOSED_AT = at("2026-08-05T03:00:00.000Z");

/** The alert as it stands while it is firing, in two scopes. */
const openAlert = (): AlertRecord => ({
  sourceId: SOURCE,
  fingerprint: FINGERPRINT,
  state: "firing",
  stale: false,
  severity: "minor",
  policyId: "expiry",
  areas: ["AE", "EG"],
  context: { dueDate: "2026-09-30", registrationId: "reg-1" },
  firstSeenAt: RAISED,
  lastSeenAt: RAISED,
  resolvedAt: null,
});

/**
 * The same alert after the change that must not survive its event failing.
 *
 * EVERY MUTABLE COLUMN MOVES, and the scope set moves too. "Unchanged" is a
 * claim about the whole row, and a rollback that restored the scalars while
 * leaving the AlertArea rows deleted would still have lost the alert's scope —
 * after which nothing there can ever resolve it by absence.
 */
const resolvedAlert = (): AlertRecord => ({
  ...openAlert(),
  state: "resolved",
  stale: true,
  severity: "major",
  policyId: "expiry-v2",
  areas: ["KW"],
  context: { dueDate: "2026-10-31" },
  lastSeenAt: CLOSED_AT,
  resolvedAt: CLOSED_AT,
});

const raising: AlertChangeLike = {
  at: RAISED,
  kind: "raised",
  fromState: null,
  toState: "firing",
  actor: null,
  runId: "sweep-2026-08-01",
  reason: null,
};

const closing: AlertChangeLike = {
  at: CLOSED_AT,
  kind: "resolved",
  fromState: "firing",
  toState: "resolved",
  actor: null,
  runId: "sweep-2026-08-05",
  reason: null,
};

/**
 * Every column of one alert, its scope rows and its history.
 *
 * Read back rather than compared field by field: the assertion is that the row
 * is UNCHANGED, and a hand-written list of columns to compare is a list that
 * silently stops covering the column added next. Both orderings are by keys
 * with no collation to disagree about — `at` is an instant, and the three area
 * keys used here differ at their first character (ADR-038).
 */
async function everyColumn(id: string) {
  return {
    row: await db.alert.findUnique({ where: { id } }),
    areas: (await db.alertArea.findMany({ where: { alertId: id } })).map((area) => area.area).sort(),
    events: await db.alertEvent.findMany({ where: { alertId: id }, orderBy: { at: "asc" } }),
  };
}

/** The atomic writer, discovered once, by the criterion and not by name. */
const write = (record: AlertRecord, change: AlertChangeLike) => atomicWriter(store, CONTRACT).write(record, change);

/** A call whose rejection is incidental: the assertion is about the rows left
 *  behind, so the outcome is returned rather than demanded, and the connection
 *  is made good again the way ../../support/database.ts does it. */
async function attempt(work: Promise<unknown>): Promise<string | null> {
  const outcome = await work.then(
    () => null,
    (cause: unknown) => String(cause),
  );
  await afterARefusal();
  return outcome;
}

describe("the forced failure is real, and it lands on the event write", () => {
  it("refuses an AlertEvent insert while it is in force, and accepts one again after", async () => {
    // The non-vacuity guard for everything below. If the constraint were never
    // added, or added to the wrong table, every rollback case here would pass
    // by writing successfully and asserting about a row nothing tried to move.
    const alert = await write(openAlert(), raising);

    const refusal = await withEventWritesRefused(db, schema, async () =>
      refusalFrom(
        db.alertEvent.create({
          data: { alertId: alert.id, at: CLOSED_AT, kind: "resolved", fromState: "firing", toState: "resolved" },
        }),
      ),
    );

    expect(refusal, "the AlertEvent write was refused by something other than the forced check").toMatch(
      /check constraint/i,
    );
    // And the constraint does not outlive the block: the next write succeeds.
    await db.alertEvent.create({ data: { alertId: alert.id, at: CLOSED_AT, kind: "reasserted" } });
    expect(await db.alertEvent.count()).toBe(2);
  });
});

describe("a failure writing the event leaves the alert row unchanged", () => {
  it("leaves every column, every scope row and the whole history exactly as they were", async () => {
    // THE ASSERTION. The alert is firing in AE and EG with one event behind it;
    // the change that fails would have resolved it, raised its severity, marked
    // it stale, moved its policy and its context, and moved its scope to KW.
    // Afterwards the row is compared with what it was, whole.
    const alert = await write(openAlert(), raising);
    const before = await everyColumn(alert.id);
    expect(before.row?.state, "the alert was not firing before the failed change").toBe("firing");
    expect(before.areas).toEqual(["AE", "EG"]);
    expect(before.events).toHaveLength(1);

    const refusal = await withEventWritesRefused(db, schema, () => attempt(write(resolvedAlert(), closing)));

    expect(refusal, "the write was ACCEPTED while every AlertEvent insert was refused").not.toBeNull();
    expect(await everyColumn(alert.id)).toEqual(before);
    expect(await db.alert.count()).toBe(1);
    expect(await db.alertArea.count()).toBe(2);
    expect(await db.alertEvent.count()).toBe(1);
  });

  it("leaves no alert at all when the failing change is the first sighting", async () => {
    // The create arm. Here the audit hole is a row nobody has any record of
    // having been raised — no event names it, so nothing downstream can say
    // when or why it appeared, and the fingerprint is now deduped against a row
    // whose history is empty.
    const refusal = await withEventWritesRefused(db, schema, () => attempt(write(openAlert(), raising)));

    expect(refusal, "the write was ACCEPTED while every AlertEvent insert was refused").not.toBeNull();
    expect(await db.alert.count(), "an alert row exists that no event records the raising of").toBe(0);
    expect(await db.alertArea.count()).toBe(0);
    expect(await db.alertEvent.count()).toBe(0);
  });

  it("writes both again once the event write is possible, so nothing is left poisoned", async () => {
    // A rollback that also lost the caller's change permanently would be a
    // different defect wearing the same green. The next attempt must land.
    await withEventWritesRefused(db, schema, () => attempt(write(openAlert(), raising)));

    const alert = await write(openAlert(), raising);
    expect(await db.alert.count()).toBe(1);
    expect((await eventsFor(db, alert.id)).map((row) => row.kind)).toEqual(["raised"]);
  });
});

describe("the same forced failure, through the two separate verbs, loses the record", () => {
  it("moves the alert row and logs nothing — which is why the pair is not a state change", async () => {
    // THE COUNTERFACTUAL, and it is what makes the case above mean something.
    // These are the two awaits the node was raised about, still on the port
    // because a caller may legitimately write a row or append an event alone.
    // Driven here with the identical failure and the identical records, they
    // leave the alert resolved, in a scope it has left, with no event saying so.
    //
    // This case ASSERTS THAT OUTCOME rather than deploring it: if the row did
    // not move here, the rollback case above would be passing because nothing
    // moves under this failure at all, and would keep passing against an
    // implementation with no transaction in it.
    const alert = await write(openAlert(), raising);
    const before = await everyColumn(alert.id);

    const refusal = await withEventWritesRefused(db, schema, async () => {
      const upsert = store?.upsertAlert as (record: AlertRecord) => Promise<{ id: string }>;
      const record = store?.recordAlertEvent as (event: Record<string, unknown>) => Promise<unknown>;
      await upsert.call(store, resolvedAlert());
      return refusalFrom(record.call(store, { ...closing, alertId: alert.id }));
    });

    expect(refusal).toMatch(/check constraint/i);

    const after = await everyColumn(alert.id);
    expect(after, "the row did not move, so the rollback case above proves nothing").not.toEqual(before);
    expect(after.row?.state, "the two-call form left the alert where it was").toBe("resolved");
    expect(after.row?.resolvedAt).toEqual(CLOSED_AT);
    expect(after.areas).toEqual(["KW"]);
    // The whole of the audit hole in one line: the state moved, the log did not.
    expect(after.events.map((row) => row.kind)).toEqual(["raised"]);
  });
});

describe("the engine's own verbs write the row and the event together", () => {
  // ASSERTIONS 1 AND 2 through lib/services/alerts/index.ts rather than through
  // the store, because the engine is where the two awaits were and where a
  // caller actually arrives. Nothing here asserts how the engine is wired —
  // ./engine.ts discovers that and states why.

  it("leaves no alert behind when a raise cannot record that it was raised", async () => {
    const fingerprint = "reno:opsmind:deadlines:doc-raise:expiry";

    await withEventWritesRefused(db, schema, () =>
      attempt(engine.raiseAlert(fingerprint, "major", "expiry", ["AE"], { dueDate: "2026-09-30" })),
    );

    // Asserted on the ROW, not on whether raiseAlert rejected: ADR-040 leaves a
    // failed alert free not to end the run, so an engine that swallows the
    // failure is defensible and an alert row with no event is not.
    expect(
      await alertCountFor(db, fingerprint),
      "a raise left an Alert row that no AlertEvent records the raising of",
    ).toBe(0);
    expect(await db.alertEvent.count()).toBe(0);
  });

  it("leaves the alert firing when a close cannot record that it was closed", async () => {
    // The node's own example: "the alert has changed state and nothing in the
    // log says so". Current state would stay CORRECT-looking — resolved is a
    // perfectly ordinary value — and the gap is only visible by asking the
    // history, which is the evidence an auditor asks for.
    const fingerprint = "reno:opsmind:deadlines:doc-close:expiry";
    await engine.raiseAlert(fingerprint, "major", "expiry", ["AE"], { dueDate: "2026-09-30" });
    const raised = await alertFor(db, fingerprint);
    if (raised === null) throw new Error(`the raise landed no Alert row for ${fingerprint} (wired by: ${engine.how})`);
    expect(raised.state, "the alert was not firing before the close was attempted").toBe("firing");
    const before = await everyColumn(raised.id);

    await withEventWritesRefused(db, schema, () => attempt(engine.resolveAlert(fingerprint)));

    expect(await everyColumn(raised.id)).toEqual(before);
    expect((await eventsFor(db, raised.id)).map((row) => row.toState)).not.toContain("resolved");
  });

  it("records the raise and the alert together when nothing is failing", async () => {
    // The control for the two cases above, and assertion 1 through the engine:
    // one call, one row, one event, and the event hangs off that row.
    const fingerprint = "reno:opsmind:deadlines:doc-ok:expiry";
    await engine.raiseAlert(fingerprint, "major", "expiry", ["AE"], { dueDate: "2026-09-30" });

    const raised = await alertFor(db, fingerprint);
    if (raised === null) throw new Error(`the raise landed no Alert row for ${fingerprint} (wired by: ${engine.how})`);
    const events = await eventsFor(db, raised.id);
    expect(events).toHaveLength(1);
    expect(events[0].alertId).toBe(raised.id);
  });
});
