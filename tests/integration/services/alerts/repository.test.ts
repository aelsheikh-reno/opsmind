// lib/services/alerts/repository.ts against a real engine (ADR-038): the four
// cards of docs/architecture/data-model.md#alert-manager — Alert, AlertArea,
// AlertEvent, AlertSource — and six of the seven assertions of
// tasks/backlog.yaml#service-alerts-store. The seventh, `// owns:`, is a claim
// about source text and lives next door in repository-ownership.test.ts.
//
// WRITTEN FROM THE SPECIFICATION. The author of this file read no line of
// lib/services/alerts/repository.ts, of prisma/schema.prisma's alert models, or
// of the migration. Every expected value below comes from the four cards, from
// flows-alerting.md, from ADR-020/039/040/043/044, or from
// lib/services/alerts/lifecycle.ts — which is merged, and is the layer that
// will sit on top of this store.
//
// THE CONVENTIONS ARE tests/integration/modules/deadlines/repository.test.ts's,
// which states them, and both apply here:
//
// ONE — `db` is used only where the PORT CANNOT EXPRESS the setup or the check:
// seeding a User to be an event's actor, forcing a unique constraint the port
// never violates, and counting AlertArea and AlertEvent rows the port cannot
// see. Everything else goes through the repository, or this file stops testing
// the repository and starts testing Prisma.
//
// TWO — an ordering case seeds DISTINCT sort keys. Exactly one ordering is
// asserted here, `listAlertEvents` by `at`, and its keys are distinct instants.
// ADR-038's collation divergence — PGlite runs the `C` collation, CI runs a
// linguistic one, and they disagree whenever a text ORDER BY ties on a prefix
// and the tie breaks on case — therefore cannot reach it, because a timestamp
// has no collation. Nothing in the four cards promises an order for
// `listAlerts` or for an alert's areas, so neither is asserted as a sequence:
// sets are compared instead. Where areas are compared at all the keys are
// `AE`/`EG`/`KW` — one case, differing at the first character — so that even an
// accidental order would be identical under both collations. That is the trap
// `regime.test.ts` fell into: green locally on PGlite, red in CI on postgres:16.
//
// THE SURFACE IS A CHOICE, AND IT IS STATED RATHER THAN INFERRED. data-model.md
// specifies four tables and their columns; it names no function, and no store
// port is declared on the merged `index.ts`. The seven names below are this
// file's reading of what those four cards require of a store, carried on one
// exported object because that is the shape the only other module-side
// repository uses (`prismaDeadlineStore`). If the implementation spells one
// differently that is a disagreement to settle in one place — never a reason to
// loosen a test — and the last describe in this file fails naming both what was
// expected and what is actually there.
import { describe, expect, it } from "vitest";
import type { AlertRecord, AlertState } from "@/lib/services/alerts";
import { integrationDatabase, refusalFrom } from "../../support/database";

// Order is load-bearing: integrationDatabase swaps DATABASE_URL and evicts the
// cached client, so the repository must be reached by dynamic import AFTER it.
// A static import at the top of the file would bind the client built for
// whatever DATABASE_URL held before the harness ran.
const db = await integrationDatabase("alerts");

const repository = await import("@/lib/services/alerts/repository").catch((cause: unknown) => {
  // A missing file is a failure that says which node produces it, not a stack
  // trace about module resolution. This file is written alongside that one.
  throw new Error(
    "lib/services/alerts/repository.ts could not be imported. " +
      "tasks/backlog.yaml#service-alerts-store produces it, so its absence is a failure of " +
      `this node and never an empty run (ADR-037, ADR-038). Cause: ${String(cause)}`,
    { cause },
  );
});

/**
 * The contract these tests hold the repository to, and the record of which
 * exported functions were actually called.
 *
 * Assertion 6 is "every exported repository function is exercised against a
 * real PostgreSQL". That is not checkable by reading the file, and a hand-kept
 * list drifts the first time a function is added — so each function is wrapped
 * once here, records its own name when it is invoked, and the final describe
 * compares what was invoked against what the module exports.
 */
const CONTRACT = [
  "upsertAlert",
  "getAlert",
  "listAlerts",
  "recordAlertEvent",
  "listAlertEvents",
  "upsertAlertSource",
  "getAlertSource",
] as const;

const store = repository.prismaAlertStore;
const members = (): Record<string, unknown> => (store ?? {}) as Record<string, unknown>;
const memberNames = (): string[] =>
  Object.entries(members())
    .filter(([, value]) => typeof value === "function")
    .map(([name]) => name)
    .sort();

const called = new Set<string>();

/** Reads the member at call time and applies it to the store, so a method that
 *  holds `this` is not broken by being lifted out of the object. */
function watch<K extends keyof typeof store>(name: K): (typeof store)[K] {
  const wrapped = (...args: unknown[]): unknown => {
    const target = members()[name as string];
    if (typeof target !== "function") {
      throw new Error(
        `lib/services/alerts/repository.ts's store has no function named '${String(name)}'. These ` +
          `tests hold it to the contract stated at the top of this file: ${CONTRACT.join(", ")}. ` +
          `It carries: ${memberNames().join(", ") || "nothing"}.`,
      );
    }
    called.add(name as string);
    return (target as (...inner: unknown[]) => unknown).apply(store, args);
  };
  return wrapped as unknown as (typeof store)[K];
}

const upsertAlert = watch("upsertAlert");
const getAlert = watch("getAlert");
const listAlerts = watch("listAlerts");
const recordAlertEvent = watch("recordAlertEvent");
const listAlertEvents = watch("listAlertEvents");
const upsertAlertSource = watch("upsertAlertSource");
const getAlertSource = watch("getAlertSource");

/**
 * The AlertEvent card, as a type. Declared here rather than imported because
 * the store is what introduces it; a structural disagreement with the
 * repository's own parameter type is meant to be a red `npm run typecheck`
 * rather than a surprise at run time (components-services.md, on the port being
 * bound with an annotation and no cast).
 */
interface NewAlertEvent {
  alertId: string;
  at: Date;
  kind:
    | "raised"
    | "reasserted"
    | "severity_raised"
    | "stale_marked"
    | "stale_cleared"
    | "acknowledged"
    | "suppressed"
    | "unsuppressed"
    | "resolved";
  /** Null where the kind changes no state — a reassert, or a stale flag. */
  fromState: AlertState | null;
  toState: AlertState | null;
  /** Null means the source or the engine did it. */
  actor: string | null;
  runId: string | null;
  reason: string | null;
}

/** The AlertSource card, on the same terms. */
interface NewAlertSource {
  sourceId: string;
  kind: "repeating" | "direct" | "fire_only";
  /** Null for `direct`, which is not expected to report on a cadence. The
   *  UNITS of a non-null value are not settled by any card and are the
   *  source-registry node's to decide, so nothing here supplies one. */
  expectedEvery: null;
  lastRunAt: Date | null;
  lastRunId: string | null;
}

const at = (iso: string): Date => new Date(iso);

const SOURCE = "deadlines";

// A real fingerprint's shape, `{tenant}:{app}:{source}:{entity}:{policy}`. It is
// opaque to the engine and is never split, so it is used here whole, separators
// and all, rather than as a tidy identifier that would hide a normalisation.
const FINGERPRINT = "reno:opsmind:deadlines:doc-1:expiry";
const OTHER_FINGERPRINT = "reno:opsmind:deadlines:doc-2:expiry";

const RAISED = at("2026-08-01T03:00:00.000Z");

const alert = (over: Partial<AlertRecord> = {}): AlertRecord => ({
  sourceId: SOURCE,
  fingerprint: FINGERPRINT,
  state: "firing",
  stale: false,
  severity: "minor",
  policyId: "expiry",
  areas: ["AE"],
  context: { dueDate: "2026-09-30", registrationId: "reg-1" },
  firstSeenAt: RAISED,
  lastSeenAt: RAISED,
  resolvedAt: null,
  ...over,
});

const event = (alertId: string, over: Partial<NewAlertEvent> = {}): NewAlertEvent => ({
  alertId,
  at: RAISED,
  kind: "raised",
  fromState: null,
  toState: "firing",
  actor: null,
  runId: null,
  reason: null,
  ...over,
});

const identity = (over: Partial<AlertRecord> = {}) => {
  const record = alert(over);
  return { sourceId: record.sourceId, fingerprint: record.fingerprint };
};

/** A User to be an event's actor. The port cannot create one — the Kernel owns
 *  that table — and the row must be real in case `actor` is a foreign key. */
const actorUser = async (email: string) =>
  db.user.create({ data: { email, name: "Compliance Officer" } });

describe("upsertAlert — one row per source and fingerprint", () => {
  it("stores an alert with every column the card names, and reads it back by identity", async () => {
    // Assertion 1's floor: there is no dedupe to speak of if the row does not
    // round-trip in the first place. toMatchObject rather than toEqual — the
    // stored row also carries an id, which AlertRecord does not name.
    const created = await upsertAlert(alert());
    expect(created).toMatchObject({
      id: expect.any(String),
      sourceId: SOURCE,
      fingerprint: FINGERPRINT,
      state: "firing",
      stale: false,
      severity: "minor",
      policyId: "expiry",
      firstSeenAt: RAISED,
      lastSeenAt: RAISED,
      resolvedAt: null,
    });
    // The caller's own diagnostic bag, carried whole and never read (ADR-040).
    expect(created.context).toEqual({ dueDate: "2026-09-30", registrationId: "reg-1" });
    expect(await getAlert(identity())).toEqual(created);
    expect(await listAlerts()).toEqual([created]);
  });

  it("updates one row when the same fingerprint is reported twice, and never creates a second", async () => {
    // THE ASSERTION ITSELF. Every column the card calls mutable is moved at
    // once, because an upsert whose update clause omits one keeps a stale value
    // silently — invisible until an alert shows last week's severity at 02:00.
    const first = await upsertAlert(alert());
    const second = await upsertAlert(
      alert({
        state: "acknowledged",
        stale: true,
        severity: "major",
        policyId: "expiry-v2",
        context: { dueDate: "2026-10-31" },
        lastSeenAt: at("2026-08-02T03:00:00.000Z"),
      }),
    );

    expect(second.id).toBe(first.id);
    expect(second).toMatchObject({
      state: "acknowledged",
      stale: true,
      severity: "major",
      policyId: "expiry-v2",
      lastSeenAt: at("2026-08-02T03:00:00.000Z"),
    });
    expect(second.context).toEqual({ dueDate: "2026-10-31" });
    // firstSeenAt survives re-firing: it is when this identity FIRST fired.
    expect(second.firstSeenAt).toEqual(first.firstSeenAt);
    expect(await listAlerts()).toHaveLength(1);
  });

  it("scopes the fingerprint by source, so two sources may legitimately compute the same one", async () => {
    // The unique is on the PAIR. Two engines watching different things may
    // derive the same string; collapsing them would hide one product's alert
    // behind another's, which is the failure `sourceId` is in the key for.
    const mine = await upsertAlert(alert({ sourceId: "deadlines" }));
    const theirs = await upsertAlert(alert({ sourceId: "ingestion" }));

    expect(theirs.id).not.toBe(mine.id);
    expect(await listAlerts()).toHaveLength(2);
    expect(await getAlert({ sourceId: "ingestion", fingerprint: FINGERPRINT })).toMatchObject({
      id: theirs.id,
      sourceId: "ingestion",
    });
  });

  it("treats two fingerprints from one source as two alerts", async () => {
    await upsertAlert(alert({ fingerprint: FINGERPRINT }));
    await upsertAlert(alert({ fingerprint: OTHER_FINGERPRINT }));
    expect(await listAlerts()).toHaveLength(2);
  });

  it("keeps the fingerprint whole — separators, escapes and all", async () => {
    // The fingerprint is OPAQUE: never split, never parsed, compared with ===.
    // `fingerprintFor` escapes `:` and `\` inside a segment, so a store that
    // trimmed, unescaped or normalised would merge two identities into one and
    // make an alert not merely wrong but invisible.
    const escaped = "reno:opsmind:deadlines:doc\\:1:expiry";
    const plain = "reno:opsmind:deadlines:doc:1:expiry";

    const one = await upsertAlert(alert({ fingerprint: escaped }));
    const two = await upsertAlert(alert({ fingerprint: plain }));

    expect(one.fingerprint).toBe(escaped);
    expect(two.fingerprint).toBe(plain);
    expect(await getAlert({ sourceId: SOURCE, fingerprint: escaped })).toMatchObject({ id: one.id });
    // Two strings that differ anywhere are two alerts.
    expect(await listAlerts()).toHaveLength(2);
  });

  it("cannot hold two rows for one source and fingerprint", async () => {
    // Forced through db, because the port upserts and so can never violate it.
    // That uniqueness IS the dedupe — the port's behaviour above and the
    // constraint here are the two halves of assertion 1, and a store that only
    // deduped in application code would let a second writer create the twin.
    const first = await upsertAlert(alert());
    const refusal = await refusalFrom(
      db.alert.create({
        data: {
          sourceId: SOURCE,
          fingerprint: FINGERPRINT,
          state: "firing",
          stale: false,
          severity: "minor",
          policyId: "expiry",
          context: {},
          firstSeenAt: RAISED,
          lastSeenAt: RAISED,
        },
      }),
    );

    expect(refusal).toMatch(/[Uu]nique constraint/);
    expect(await listAlerts()).toEqual([first]);
  });
});

describe("getAlert and listAlerts when nothing has been raised", () => {
  it("answers null for an identity nothing has raised, rather than failing", async () => {
    // resolveAlert is idempotent on an unknown fingerprint (ADR-020), so the
    // layer above has to be able to ask about one that was never seen.
    expect(await getAlert({ sourceId: SOURCE, fingerprint: "reno:opsmind:deadlines:nothing:expiry" })).toBeNull();
  });

  it("answers an empty set rather than failing when no alert exists", async () => {
    expect(await listAlerts()).toEqual([]);
  });
});

describe("policyId is recorded, never judged", () => {
  it("records a policyId this engine holds no configuration for, verbatim", async () => {
    // ASSERTION 7, and the half that moved here from the previous node because
    // "recorded" is unverifiable without a store. The engine holds no rule book:
    // refusing an unknown policy would mean a caller's condition is detected and
    // then discarded, which is the failure the caller exists to prevent, moved
    // one layer down. Nothing in this schema defines this policy.
    const unknown = "visa-expiry-window-v3";
    const created = await upsertAlert(alert({ policyId: unknown }));

    expect(created.policyId).toBe(unknown);
    expect((await getAlert(identity()))?.policyId).toBe(unknown);
  });

  it("keeps a policyId's exact bytes — case, spaces and separators", async () => {
    // Verbatim means untrimmed and unnormalised. A store that tidied this would
    // be interpreting a value it is specified only to carry, and the caller
    // would lose the ability to match its own policy back.
    const odd = "  Policy:Visa Expiry / v3  ";
    const created = await upsertAlert(alert({ policyId: odd }));
    expect(created.policyId).toBe(odd);
    expect((await getAlert(identity()))?.policyId).toBe(odd);
  });

  it("accepts an empty policyId rather than refusing the alert", async () => {
    // The boundary of "accepted, never refused". The card states that rule
    // without a condition, and an alert dropped because its policy string was
    // empty is a compliance breach nobody is told about. If this is ever
    // refused, that is a decision to record rather than a test to relax.
    const created = await upsertAlert(alert({ policyId: "" }));
    expect(created.policyId).toBe("");
    expect(await listAlerts()).toHaveLength(1);
  });

  it("lets many alerts share one policyId, because one fault can span many subjects", async () => {
    // ADR-044: one global fault — nobody configured a threshold for visas —
    // affects several scopes at once. A unique on policyId would make the second
    // subject's alert unrepresentable.
    await upsertAlert(alert({ fingerprint: FINGERPRINT, policyId: "threshold-missing" }));
    await upsertAlert(alert({ fingerprint: OTHER_FINGERPRINT, policyId: "threshold-missing" }));
    expect(await listAlerts()).toHaveLength(2);
  });
});

describe("the scope an alert was last reported in", () => {
  it("stores every area the alert was reported in", async () => {
    // ADR-044: the areas name where the IMPACT is, not where the fault is, so
    // three of them is one alert and not three. Compared as a set — no card
    // promises an order, and asserting one would assert something PostgreSQL
    // never said (and, on text, something the two engines disagree about).
    const created = await upsertAlert(alert({ areas: ["AE", "EG", "KW"] }));

    expect(new Set(created.areas)).toEqual(new Set(["AE", "EG", "KW"]));
    expect(new Set((await getAlert(identity()))?.areas)).toEqual(new Set(["AE", "EG", "KW"]));
    expect(await db.alertArea.count()).toBe(3);
  });

  it("gives an alert never reported in a scope NO area at all", async () => {
    // The second half of assertion 3, and the one a row-per-area table makes
    // easy to get wrong: an empty list, not a null, and no row standing in for
    // "none". Resolution by absence asks whether ALL of an alert's areas were
    // inside a complete scope, and a placeholder row would answer that wrongly.
    const created = await upsertAlert(alert({ areas: [] }));

    expect(created.areas).toEqual([]);
    expect((await getAlert(identity()))?.areas).toEqual([]);
    expect(await db.alertArea.count()).toBe(0);
  });

  it("replaces the areas on the next report rather than accumulating them", async () => {
    // "LAST reported in". An alert whose fault has moved between scopes must not
    // keep claiming the scope it has left, or it can never be resolved by
    // absence there — the run that covers that scope would find nothing to
    // close and the alert would be frozen open forever.
    await upsertAlert(alert({ areas: ["AE", "EG"] }));
    const second = await upsertAlert(alert({ areas: ["KW"] }));

    expect(second.areas).toEqual(["KW"]);
    expect(await db.alertArea.count()).toBe(1);
  });

  it("empties the areas when the alert is next reported in no scope at all", async () => {
    // The mid-change boundary of the case above: the new set is empty, which is
    // a value and not an omission.
    await upsertAlert(alert({ areas: ["AE", "EG"] }));
    const second = await upsertAlert(alert({ areas: [] }));

    expect(second.areas).toEqual([]);
    expect(await db.alertArea.count()).toBe(0);
  });

  it("cannot hold one area twice for one alert", async () => {
    // Forced through db: the port replaces the set and so never violates this.
    // A duplicated area would count twice in the anti-join that decides whether
    // every area was covered by a complete scope.
    const created = await upsertAlert(alert({ areas: ["AE"] }));
    const refusal = await refusalFrom(db.alertArea.create({ data: { alertId: created.id, area: "AE" } }));

    expect(refusal).toMatch(/[Uu]nique constraint/);
    expect(await db.alertArea.count()).toBe(1);
  });

  it("lets two alerts name the same area", async () => {
    // The unique is per (alertId, area), not per area: forty visa expiries in
    // one jurisdiction are forty individually addressable alerts.
    await upsertAlert(alert({ fingerprint: FINGERPRINT, areas: ["AE"] }));
    await upsertAlert(alert({ fingerprint: OTHER_FINGERPRINT, areas: ["AE"] }));

    expect(await listAlerts()).toHaveLength(2);
    expect(await db.alertArea.count()).toBe(2);
  });

  it("keeps an area key whole, in whatever vocabulary the caller uses", async () => {
    // ADR-043: an opaque scope key the engine compares and never interprets. It
    // names no jurisdiction as far as this store is concerned, so a key that
    // looks nothing like a country code must survive untouched — a caller that
    // spells it differently must lose nothing silently.
    const odd = "tenant/reno · site:Dubai Marina";
    const created = await upsertAlert(alert({ areas: [odd] }));

    expect(created.areas).toEqual([odd]);
    expect((await getAlert(identity()))?.areas).toEqual([odd]);
  });
});

describe("a resolved alert's row survives its resolution", () => {
  it("keeps the row, its areas and its history when the alert is closed", async () => {
    // ASSERTION 4. Nothing is deleted to close an alert: the compliance record
    // of what fired, where and for how long is the point, and a resolution that
    // removed the row would destroy exactly the evidence an auditor asks for.
    const open = await upsertAlert(alert({ areas: ["AE", "EG"] }));
    await recordAlertEvent(event(open.id, { kind: "raised", toState: "firing", runId: "run-1" }));

    const closedAt = at("2026-08-05T03:00:00.000Z");
    const resolved = await upsertAlert(
      alert({ areas: ["AE", "EG"], state: "resolved", resolvedAt: closedAt, lastSeenAt: closedAt }),
    );

    expect(resolved.id).toBe(open.id);
    expect(resolved.state).toBe("resolved");
    expect(resolved.resolvedAt).toEqual(closedAt);
    expect(await getAlert(identity())).toEqual(resolved);
    expect(await listAlerts()).toHaveLength(1);
    expect(await db.alertArea.count()).toBe(2);
    expect(await listAlertEvents(open.id)).toHaveLength(1);
  });

  it("finds a resolved alert by its identity, so a later raise reopens the same row", async () => {
    // The consequence of the row surviving, and the reason it must: a raise for
    // a currently-resolved fingerprint opens it AGAIN as firing, and the earlier
    // resolution stays in the record. A deleted row would make the reopen a new
    // alert, losing firstSeenAt and breaking dedupe across the close.
    const open = await upsertAlert(alert());
    const closedAt = at("2026-08-05T03:00:00.000Z");
    await upsertAlert(alert({ state: "resolved", resolvedAt: closedAt, lastSeenAt: closedAt }));
    await recordAlertEvent(
      event(open.id, { at: closedAt, kind: "resolved", fromState: "firing", toState: "resolved", runId: "run-2" }),
    );

    const reopenedAt = at("2026-08-09T03:00:00.000Z");
    const reopened = await upsertAlert(alert({ state: "firing", resolvedAt: null, lastSeenAt: reopenedAt }));

    expect(reopened.id).toBe(open.id);
    expect(reopened.state).toBe("firing");
    expect(reopened.resolvedAt).toBeNull();
    expect(reopened.firstSeenAt).toEqual(RAISED);
    expect(await listAlerts()).toHaveLength(1);
    // The earlier resolution is still in the record.
    expect((await listAlertEvents(open.id)).map((row) => row.kind)).toContain("resolved");
  });
});

describe("recordAlertEvent — what changed the alert, who, and when", () => {
  it("records the change, the actor and the instant", async () => {
    // ASSERTION 2. The alert row carries current state so the hot path does not
    // replay history; this table is why that current state can be trusted.
    const raised = await upsertAlert(alert());
    const actor = await actorUser("officer@reno.example");
    const closedAt = at("2026-08-05T09:30:00.000Z");

    await recordAlertEvent(
      event(raised.id, {
        at: closedAt,
        kind: "resolved",
        fromState: "firing",
        toState: "resolved",
        actor: actor.id,
        runId: null,
        reason: "renewed at the counter",
      }),
    );

    const [recorded] = await listAlertEvents(raised.id);
    expect(recorded).toMatchObject({
      alertId: raised.id,
      at: closedAt,
      kind: "resolved",
      fromState: "firing",
      toState: "resolved",
      actor: actor.id,
      runId: null,
      reason: "renewed at the counter",
    });
  });

  it("keeps an engine resolve distinguishable from a logged human resolve", async () => {
    // The case the card singles out: "a human resolve is the case that must
    // never be indistinguishable from an automatic one". Same kind, same
    // transition, different actor — one null, one a real user — and the run id
    // is what the engine's own resolution names.
    const raised = await upsertAlert(alert());
    const actor = await actorUser("officer@reno.example");

    await recordAlertEvent(
      event(raised.id, {
        at: at("2026-08-05T03:00:00.000Z"),
        kind: "resolved",
        fromState: "firing",
        toState: "resolved",
        actor: null,
        runId: "sweep-2026-08-05",
      }),
    );
    await recordAlertEvent(
      event(raised.id, {
        at: at("2026-08-06T03:00:00.000Z"),
        kind: "resolved",
        fromState: "firing",
        toState: "resolved",
        actor: actor.id,
        runId: null,
        reason: "confirmed with the client",
      }),
    );

    const events = await listAlertEvents(raised.id);
    expect(events.map((row) => row.actor)).toEqual([null, actor.id]);
    expect(events.map((row) => row.runId)).toEqual(["sweep-2026-08-05", null]);
  });

  it("carries no state change on a kind that changes none, and the reason a scope gave", async () => {
    // fromState and toState are null where the kind changes no state — a
    // reassert, or a stale flag. `stale_marked` also carries the incomplete
    // scope's reason, which is how the run that did not look says why.
    const raised = await upsertAlert(alert());
    await recordAlertEvent(
      event(raised.id, {
        kind: "stale_marked",
        fromState: null,
        toState: null,
        runId: "sweep-2026-08-04",
        reason: "no business calendar for AE",
      }),
    );

    const [recorded] = await listAlertEvents(raised.id);
    expect(recorded.kind).toBe("stale_marked");
    expect(recorded.fromState).toBeNull();
    expect(recorded.toState).toBeNull();
    expect(recorded.reason).toBe("no business calendar for AE");
  });

  it("appends every event, so two identical ones are two rows", async () => {
    // Append-only means no upsert and no dedupe key. Two runs that both
    // reasserted the same alert in the same second are two facts, and a store
    // that collapsed them would under-report how long a breach persisted.
    const raised = await upsertAlert(alert());
    await recordAlertEvent(event(raised.id, { kind: "reasserted", fromState: null, toState: null }));
    await recordAlertEvent(event(raised.id, { kind: "reasserted", fromState: null, toState: null }));

    expect(await listAlertEvents(raised.id)).toHaveLength(2);
    expect(await db.alertEvent.count()).toBe(2);
  });

  it("never rewrites or removes an earlier event, whatever else the store is asked to do", async () => {
    // The invariant behind "never updated, never deleted", asserted over a
    // sequence rather than a single call: across a raise, an escalation, a stale
    // flag, a resolution and a reopen, the event count never falls and the first
    // event read is byte-identical to its first reading. Any one of those steps
    // rewriting history would be invisible to a single-call test.
    const raised = await upsertAlert(alert({ areas: ["AE"] }));
    await recordAlertEvent(event(raised.id, { kind: "raised", toState: "firing" }));
    const [firstReading] = await listAlertEvents(raised.id);

    const closedAt = at("2026-08-05T03:00:00.000Z");
    const steps: (() => Promise<unknown>)[] = [
      () => upsertAlert(alert({ areas: ["AE", "EG"], severity: "major" })),
      () =>
        recordAlertEvent(
          event(raised.id, { at: at("2026-08-02T03:00:00.000Z"), kind: "severity_raised", fromState: null, toState: null }),
        ),
      () => upsertAlert(alert({ areas: [], stale: true })),
      () =>
        recordAlertEvent(
          event(raised.id, {
            at: at("2026-08-03T03:00:00.000Z"),
            kind: "stale_marked",
            fromState: null,
            toState: null,
            reason: "no business calendar for EG",
          }),
        ),
      () => upsertAlert(alert({ areas: [], state: "resolved", resolvedAt: closedAt })),
      () =>
        recordAlertEvent(
          event(raised.id, { at: closedAt, kind: "resolved", fromState: "firing", toState: "resolved" }),
        ),
      () => upsertAlert(alert({ areas: ["KW"], state: "firing", resolvedAt: null })),
    ];

    const counts = [await db.alertEvent.count()];
    for (const step of steps) {
      await step();
      counts.push(await db.alertEvent.count());
    }

    // Non-decreasing, stated as "already in ascending order".
    expect(counts).toEqual([...counts].sort((left, right) => left - right));
    expect(counts.at(-1)).toBe(4);
    expect((await listAlertEvents(raised.id))[0]).toEqual(firstReading);
  });

  it("lists an alert's events oldest first, and nobody else's", async () => {
    // The ordering case, with DISTINCT sort keys per convention TWO — and they
    // are instants, so ADR-038's collation divergence cannot reach them. A
    // history returned in an arbitrary order is not a history: the whole reason
    // this table exists is to say what happened in what order.
    const mine = await upsertAlert(alert({ fingerprint: FINGERPRINT }));
    const theirs = await upsertAlert(alert({ fingerprint: OTHER_FINGERPRINT }));

    await recordAlertEvent(event(mine.id, { at: at("2026-08-05T03:00:00.000Z"), kind: "resolved", fromState: "firing", toState: "resolved" }));
    await recordAlertEvent(event(mine.id, { at: at("2026-08-01T03:00:00.000Z"), kind: "raised", toState: "firing" }));
    await recordAlertEvent(event(mine.id, { at: at("2026-08-03T03:00:00.000Z"), kind: "acknowledged", fromState: "firing", toState: "acknowledged" }));
    await recordAlertEvent(event(theirs.id, { at: at("2026-08-02T03:00:00.000Z"), kind: "raised", toState: "firing" }));

    expect((await listAlertEvents(mine.id)).map((row) => row.kind)).toEqual([
      "raised",
      "acknowledged",
      "resolved",
    ]);
    expect((await listAlertEvents(theirs.id)).map((row) => row.alertId)).toEqual([theirs.id]);
  });

  it("answers an empty history rather than failing for an alert nothing has happened to", async () => {
    const raised = await upsertAlert(alert());
    expect(await listAlertEvents(raised.id)).toEqual([]);
  });
});

describe("AlertSource — who is expected to report, and when each last did", () => {
  const source = (over: Partial<NewAlertSource> = {}): NewAlertSource => ({
    sourceId: SOURCE,
    kind: "repeating",
    expectedEvery: null,
    lastRunAt: null,
    lastRunId: null,
    ...over,
  });

  it("records a source and its shape, and reads it back", async () => {
    const created = await upsertAlertSource(source());
    expect(created).toMatchObject({ sourceId: SOURCE, kind: "repeating", lastRunAt: null, lastRunId: null });
    expect(await getAlertSource(SOURCE)).toEqual(created);
  });

  it("keeps one row per source, moving when it last spoke in place", async () => {
    // Liveness is the half of ADR-020 that catches a detection engine which
    // stopped running — which looks exactly like a healthy system. A second row
    // would let one source read as both alive and dark.
    const first = await upsertAlertSource(source());
    const spokeAt = at("2026-08-09T03:00:00.000Z");
    const second = await upsertAlertSource(source({ lastRunAt: spokeAt, lastRunId: "sweep-2026-08-09" }));

    expect(second.sourceId).toBe(first.sourceId);
    expect(second.lastRunAt).toEqual(spokeAt);
    expect(second.lastRunId).toBe("sweep-2026-08-09");
    expect(await db.alertSource.count()).toBe(1);
  });

  it("distinguishes a source that has never spoken from one that is not configured at all", async () => {
    // Null lastRunAt means "registered, never reported"; a null row means "no
    // configuration". Conflating them is how a brand-new source either alarms
    // before anyone configures it or is never judged dark at all.
    await upsertAlertSource(source({ sourceId: "ingestion" }));
    expect((await getAlertSource("ingestion"))?.lastRunAt).toBeNull();
    expect(await getAlertSource("no-such-source")).toBeNull();
  });

  it("marks a fire_only source as such, because it cannot report clean", async () => {
    // It must never be judged by absence: absence from a report it can never
    // send is not evidence that anything cleared.
    const created = await upsertAlertSource(source({ sourceId: "smartops-siem", kind: "fire_only" }));
    expect(created.kind).toBe("fire_only");
    expect((await getAlertSource("smartops-siem"))?.kind).toBe("fire_only");
  });

  it("cannot hold two rows for one sourceId", async () => {
    // Forced through db, for the same reason as the alert's own unique.
    await upsertAlertSource(source());
    const refusal = await refusalFrom(db.alertSource.create({ data: { sourceId: SOURCE, kind: "repeating" } }));

    expect(refusal).toMatch(/[Uu]nique constraint/);
    expect(await db.alertSource.count()).toBe(1);
  });
});

describe("the suite obtained an engine and exercised the whole surface", () => {
  // ASSERTION 6, and it is checked rather than asserted in a comment. This
  // describe is LAST on purpose: `called` is filled by the tests above.
  it("ran against a real engine, with all four tables present", async () => {
    // ADR-038: a repository test never skips. If no engine could be obtained,
    // `integrationDatabase` throws at load and this file fails naming why — so
    // reaching here at all is half the assertion. The other half is that the
    // migration actually created the four cards' tables: a green run against a
    // schema with no alert table would be testing nothing.
    const [row] = await db.$queryRawUnsafe<{ one: number }[]>("SELECT 1 AS one");
    expect(row.one).toBe(1);
    expect(await db.alert.count()).toBe(0);
    expect(await db.alertArea.count()).toBe(0);
    expect(await db.alertEvent.count()).toBe(0);
    expect(await db.alertSource.count()).toBe(0);
  });

  it("exports every function these tests hold it to", () => {
    expect(
      store,
      `lib/services/alerts/repository.ts exports no prismaAlertStore; it exports: ${Object.keys(repository).join(", ") || "nothing"}`,
    ).toBeDefined();
    const missing = CONTRACT.filter((name) => typeof members()[name] !== "function");
    expect(missing, `not on the store, which carries: ${memberNames().join(", ") || "nothing"}`).toEqual([]);
  });

  it("exercises every function it exports", () => {
    // The assertion in its own words. An exported function nobody called here
    // is an uncoverable line by another name — the exact hole ADR-037 moved this
    // file into existence to close.
    const exported = memberNames();
    expect(exported.length, "the repository's store carries no function at all").toBeGreaterThan(0);

    const unexercised = exported.filter((name) => !called.has(name));
    expect(
      unexercised,
      "carried by lib/services/alerts/repository.ts's store but never called against a real engine",
    ).toEqual([]);
  });
});
