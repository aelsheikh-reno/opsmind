// `createMemoryAlertStore` — the default `AlertStore` a client gets when no
// store is supplied (lib/services/alerts/index.ts, AlertManagerDeps.store).
//
// WHY IT NEEDS ITS OWN FILE. It is a public export of
// tasks/backlog.yaml#service-alerts-raise carrying real dedupe logic — an
// identity key, an id, and `firstSeenAt` preservation — and, before this file,
// no test named it. `tests/services/alerts/port.test.ts` drives it implicitly
// by constructing a client with no store, and asserts nothing about what it
// keeps; the engine's own behaviour is measured next door against PostgreSQL.
// So every rule below could have been broken with the whole suite still green,
// which is the same finding that was raised about `raiseKind` and the same
// answer: executing is not being asserted about.
//
// WHAT IT IS HELD TO. Exactly what `prismaAlertStore` is held to in
// tests/integration/services/alerts/repository.test.ts, because the two are
// substitutable by construction — a caller swapping one for the other must not
// change what its alerts mean. The rules are the Alert card's
// (docs/architecture/data-model.md#alert-manager):
//
//   `@@unique([sourceId, fingerprint])`. "That uniqueness IS the dedupe:
//   reporting the same fingerprint twice updates one row and never creates a
//   second identity for one fact."
//   `firstSeenAt` — "When this identity first fired. Survives re-firing".
//   `sourceId`   — "Scopes the fingerprint — two sources may legitimately
//   compute the same one".
//   `fingerprint` — "OPAQUE to the engine: never split, never parsed".
//
// No file under lib/services/alerts/ was read by the author of these tests
// before they were written.
import { describe, expect, it } from "vitest";

import { createMemoryAlertStore } from "@/lib/services/alerts";
import type { AlertRecord } from "@/lib/services/alerts";
// One criterion for "which member writes a state change", in one place. It
// lives beside the integration cases because that is where it was first needed;
// a second copy of the rule here is a second thing to keep true.
import { atomicWriter, type AlertChangeLike } from "@/tests/integration/services/alerts/atomic";

const SOURCE = "deadline-monitor";
const FP = "reno:opsmind:deadline-monitor:document:1:expiry";
const OTHER = "reno:opsmind:deadline-monitor:document:2:expiry";
const RAISED = new Date("2026-08-01T03:00:00.000Z");
const LATER = new Date("2026-08-02T03:00:00.000Z");

const alert = (over: Partial<AlertRecord> = {}): AlertRecord => ({
  sourceId: SOURCE,
  fingerprint: FP,
  state: "firing",
  stale: false,
  severity: "minor",
  policyId: "expiry",
  areas: ["AE"],
  context: { dueDate: "2026-09-30" },
  firstSeenAt: RAISED,
  lastSeenAt: RAISED,
  resolvedAt: null,
  ...over,
});

const identity = (over: Partial<AlertRecord> = {}) => {
  const record = alert(over);
  return { sourceId: record.sourceId, fingerprint: record.fingerprint };
};

describe("the in-memory store answers about what it was given", () => {
  it("answers null for an identity nothing has raised", async () => {
    // resolveAlert is idempotent on an unknown fingerprint, so the layer above
    // must be able to ask about one that was never seen.
    const store = createMemoryAlertStore();
    expect(await store.getAlert(identity())).toBeNull();
  });

  it("reads an alert back with every field it was handed, and an id", async () => {
    const store = createMemoryAlertStore();
    const created = await store.upsertAlert(alert());

    expect(created).toMatchObject({ id: expect.any(String), ...alert() });
    expect(await store.getAlert(identity())).toEqual(created);
  });

  it("accepts an event without failing, whatever the store does with it", async () => {
    const store = createMemoryAlertStore();
    const created = await store.upsertAlert(alert());
    await expect(
      store.recordAlertEvent({ alertId: created.id, at: RAISED, kind: "raised", toState: "firing" }),
    ).resolves.not.toThrow();
  });
});

describe("the in-memory store dedupes on the identity, exactly as the real one does", () => {
  it("updates one record when the same identity arrives again, and never issues a second id", async () => {
    const store = createMemoryAlertStore();
    const first = await store.upsertAlert(alert());
    const second = await store.upsertAlert(
      alert({ state: "resolved", stale: true, severity: "major", policyId: "expiry-v2", lastSeenAt: LATER, resolvedAt: LATER }),
    );

    expect(second.id).toBe(first.id);
    expect(second).toMatchObject({ state: "resolved", stale: true, severity: "major", policyId: "expiry-v2" });
    expect(await store.getAlert(identity())).toEqual(second);
  });

  it("keeps the first sighting across a second write, because it survives re-firing", async () => {
    const store = createMemoryAlertStore();
    const first = await store.upsertAlert(alert());
    const second = await store.upsertAlert(alert({ firstSeenAt: LATER, lastSeenAt: LATER }));

    expect(second.firstSeenAt).toEqual(first.firstSeenAt);
    expect(second.lastSeenAt).toEqual(LATER);
  });

  it("scopes the fingerprint by source, so two sources may compute the same one", async () => {
    const store = createMemoryAlertStore();
    const mine = await store.upsertAlert(alert({ sourceId: "deadline-monitor" }));
    const theirs = await store.upsertAlert(alert({ sourceId: "ingestion" }));

    expect(theirs.id).not.toBe(mine.id);
    expect(await store.getAlert({ sourceId: "deadline-monitor", fingerprint: FP })).toMatchObject({ id: mine.id });
    expect(await store.getAlert({ sourceId: "ingestion", fingerprint: FP })).toMatchObject({ id: theirs.id });
  });

  it("treats two fingerprints from one source as two records", async () => {
    const store = createMemoryAlertStore();
    const one = await store.upsertAlert(alert({ fingerprint: FP }));
    const two = await store.upsertAlert(alert({ fingerprint: OTHER }));

    expect(two.id).not.toBe(one.id);
    expect(await store.getAlert(identity({ fingerprint: OTHER }))).toMatchObject({ id: two.id });
  });

  it("keeps apart two fingerprints that differ only inside an escape", async () => {
    // The identity is compared whole. `fingerprintFor` escapes `:` and `\`
    // inside a segment, so a key that split or normalised would merge two
    // identities and make an alert not merely wrong but invisible.
    const store = createMemoryAlertStore();
    const escaped = "reno:opsmind:deadline-monitor:document\\:1:expiry";
    const plain = "reno:opsmind:deadline-monitor:document:1:expiry";
    const one = await store.upsertAlert(alert({ fingerprint: escaped }));
    const two = await store.upsertAlert(alert({ fingerprint: plain }));

    expect(two.id).not.toBe(one.id);
    expect(await store.getAlert(identity({ fingerprint: escaped }))).toMatchObject({ fingerprint: escaped });
  });

  it("does not let a caller reach in and change an alert it already stored", async () => {
    // The real store cannot alias — the areas are rows. A double that hands
    // back the caller's own array behaves differently from production in a way
    // no assertion about values would ever show.
    const store = createMemoryAlertStore();
    const areas = ["AE", "EG"];
    await store.upsertAlert(alert({ areas }));
    areas.push("KW");

    expect(new Set((await store.getAlert(identity()))?.areas)).toEqual(new Set(["AE", "EG"]));
  });
});

describe("the in-memory store writes a state change through one member, as the port requires", () => {
  // THE DEFAULT STORE, AND NOTHING ANYWHERE CALLED THIS. `AlertManagerDeps.store`
  // falls back to this implementation, so it is what runs in any deployment
  // that has not bound the Prisma one — and the member every state change now
  // goes through was reachable from no test in the repository. Same finding as
  // `raiseKind` and as this file's own reason for existing: executing is not
  // being asserted about, and here it was not even executing.
  //
  // THE PORT'S MEMBER, NOT A NAME. Which member it is comes from the criterion
  // in tests/integration/services/alerts/atomic.ts — the one beyond the three
  // the rest of this file already drives — because no document fixes its
  // spelling and pinning one here would assert the spelling instead of the
  // distinction.
  const PORT_VERBS = ["getAlert", "upsertAlert", "recordAlertEvent"] as const;

  const raising: AlertChangeLike = {
    at: RAISED,
    kind: "raised",
    fromState: null,
    toState: "firing",
    actor: null,
    runId: null,
    reason: null,
  };

  // WHAT IS NOT ASSERTED HERE, AND WHY. This store keeps no history — it drops
  // the event — so nothing about the event is observable through its own
  // surface, and the claim that the event carries the id of the row the same
  // write produced is held against the Prisma store, where it can be read back
  // (tests/integration/services/alerts/repository.test.ts). Reaching for the
  // event by patching a member and watching it be called would be asserting an
  // internal call order, which is not this store's contract.

  it("stores the alert it is handed, and reads it back exactly as its own upsert does", async () => {
    // The failure this catches is the quiet one: a default store whose state
    // change resolves, answers a plausible row, and keeps nothing — after which
    // every raise in a host that injected no store is forgotten immediately and
    // the client still looks healthy.
    const store = createMemoryAlertStore();
    const { write } = atomicWriter(store, PORT_VERBS);

    const created = await write(alert(), raising);

    expect(created).toMatchObject({ id: expect.any(String), ...alert() });
    expect(await store.getAlert(identity()), "the state change kept nothing").toEqual(created);
  });

  it("dedupes on the identity and keeps the first sighting, so a re-raise is one record", async () => {
    // The Alert card's rule, held against THIS member rather than only against
    // `upsertAlert`: a second writer is a second place for the dedupe to be got
    // wrong, and this is the one every state change goes through. A copy of the
    // upsert that issued a fresh id, or that let `firstSeenAt` move, would pass
    // every case above this one.
    const store = createMemoryAlertStore();
    const { write } = atomicWriter(store, PORT_VERBS);

    const first = await write(alert(), raising);
    const second = await write(
      alert({ state: "acknowledged", severity: "major", firstSeenAt: LATER, lastSeenAt: LATER }),
      { ...raising, at: LATER, kind: "acknowledged", fromState: "firing", toState: "acknowledged" },
    );

    expect(second.id).toBe(first.id);
    expect(second.firstSeenAt).toEqual(RAISED);
    expect(second).toMatchObject({ state: "acknowledged", severity: "major", lastSeenAt: LATER });
    expect(await store.getAlert(identity())).toEqual(second);
  });

  it("scopes it by source, so two sources changing the same fingerprint are two records", async () => {
    // The other half of the identity key, on the same member. Collapsing them
    // would hide one product's alert behind another's.
    const store = createMemoryAlertStore();
    const { write } = atomicWriter(store, PORT_VERBS);

    const mine = await write(alert({ sourceId: "deadline-monitor" }), raising);
    const theirs = await write(alert({ sourceId: "ingestion" }), raising);

    expect(theirs.id).not.toBe(mine.id);
    expect(await store.getAlert({ sourceId: "ingestion", fingerprint: FP })).toMatchObject({ id: theirs.id });
  });
});
