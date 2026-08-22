// lib/kernel/audit/repository.ts against a real engine (ADR-038): entries
// append rather than overwrite, entriesFor and listEntries read back in the
// order components-kernel.md's timelines expect, and redactEntry is the one
// write a row may receive after it exists — a redaction, never a delete
// (ADR-023).
//
// Added by the feature tester under the allowlist amendment recorded for
// kernel-registry-fx: tests/integration/kernel/ joined this node's produces
// list so the repository layer gets real-engine coverage the static sweep in
// tests/kernel/kernel-registry-fx.test.ts cannot provide on its own.
import { beforeEach, describe, expect, it } from "vitest";
import { integrationDatabase, refusalFrom } from "../support/database";

const db = await integrationDatabase("audit");
const { entriesFor, listEntries, recordEntry, redactEntry } = await import("@/lib/kernel/audit");

const stampedAt = async (id: string, iso: string): Promise<void> => {
  await db.auditEntry.update({ where: { id }, data: { createdAt: new Date(iso) } });
};

describe("recordEntry", () => {
  it("appends one entry, carrying the actor copied rather than joined", async () => {
    const entry = await recordEntry({
      action: "document.filed",
      entityType: "Document",
      entityId: "doc-1",
      entityLabel: "Acme lease renewal",
      details: { filename: "lease.pdf" },
      actorUserId: "user-1",
      actorName: "Jane Doe",
    });
    expect(entry).toMatchObject({
      id: expect.any(String),
      action: "document.filed",
      entityType: "Document",
      entityId: "doc-1",
      entityLabel: "Acme lease renewal",
      details: { filename: "lease.pdf" },
      actorUserId: "user-1",
      actorName: "Jane Doe",
      redactedAt: null,
      redactedBy: null,
      redactionReason: null,
    });
  });

  it("stores the applied-retention snapshot when the caller gives one", async () => {
    const entry = await recordEntry({
      action: "document.purged",
      entityType: "Document",
      entityId: "doc-2",
      appliedRetentionYears: 7,
      appliedRetentionBasis: "end_of_financial_year",
      appliedErasureMode: "full_delete",
    });
    expect(entry.appliedRetentionYears).toBe(7);
    expect(entry.appliedRetentionBasis).toBe("end_of_financial_year");
    expect(entry.appliedErasureMode).toBe("full_delete");
  });

  it("appends a second call as a new row rather than overwriting the first — the log is append-only", async () => {
    await recordEntry({ action: "document.filed", entityType: "Document", entityId: "doc-3" });
    await recordEntry({ action: "document.viewed", entityType: "Document", entityId: "doc-3" });
    expect(await entriesFor("Document", "doc-3")).toHaveLength(2);
  });
});

describe("entriesFor", () => {
  beforeEach(async () => {
    const first = await recordEntry({ action: "document.filed", entityType: "Document", entityId: "doc-4" });
    const second = await recordEntry({ action: "document.viewed", entityType: "Document", entityId: "doc-4" });
    const third = await recordEntry({ action: "document.purged", entityType: "Document", entityId: "doc-4" });
    await recordEntry({ action: "document.filed", entityType: "Document", entityId: "other-doc" });
    await stampedAt(first.id, "2026-01-01T09:00:00.000Z");
    await stampedAt(second.id, "2026-02-01T09:00:00.000Z");
    await stampedAt(third.id, "2026-03-01T09:00:00.000Z");
  });

  it("returns one entity's history oldest first — the order a timeline reads", async () => {
    expect((await entriesFor("Document", "doc-4")).map((entry) => entry.action)).toEqual([
      "document.filed",
      "document.viewed",
      "document.purged",
    ]);
  });

  it("never mixes another entity's entries in", async () => {
    expect(await entriesFor("Document", "no-such-doc")).toEqual([]);
  });
});

describe("listEntries", () => {
  beforeEach(async () => {
    const first = await recordEntry({ action: "regime.created", entityType: "Regime", entityId: "r-1" });
    const second = await recordEntry({ action: "document.filed", entityType: "Document", entityId: "d-1" });
    await stampedAt(first.id, "2026-01-01T09:00:00.000Z");
    await stampedAt(second.id, "2026-02-01T09:00:00.000Z");
  });

  it("returns everything newest first", async () => {
    expect((await listEntries()).map((entry) => entry.action)).toEqual([
      "document.filed",
      "regime.created",
    ]);
  });

  it("narrows by entityType", async () => {
    expect((await listEntries({ entityType: "Regime" })).map((entry) => entry.action)).toEqual([
      "regime.created",
    ]);
    expect(await listEntries({ entityType: "no-such-type" })).toEqual([]);
  });
});

describe("redactEntry", () => {
  it("clears entityLabel, details and actorName in place, and records who and why", async () => {
    const entry = await recordEntry({
      action: "document.filed",
      entityType: "Document",
      entityId: "doc-5",
      entityLabel: "Someone's payslip",
      details: { note: "contains a home address" },
      actorUserId: "user-9",
      actorName: "Jane Doe",
    });
    const redacted = await redactEntry(entry.id, "user:legal-ops", "PDPL erasure request #9");
    expect(redacted).toMatchObject({
      id: entry.id,
      action: "document.filed",
      entityType: "Document",
      entityId: "doc-5",
      entityLabel: null,
      details: null,
      actorName: null,
      redactedBy: "user:legal-ops",
      redactionReason: "PDPL erasure request #9",
    });
    expect(redacted.redactedAt).toBeInstanceOf(Date);
    // actorUserId survives — the entry stays attributable after redaction.
    expect(redacted.actorUserId).toBe("user-9");
  });

  it("leaves the row and its place in the timeline standing — the entry still reads back, never deleted", async () => {
    const entry = await recordEntry({ action: "document.filed", entityType: "Document", entityId: "doc-6" });
    await redactEntry(entry.id, "user:legal-ops", "reason");
    expect(await entriesFor("Document", "doc-6")).toHaveLength(1);
    expect(await listEntries()).toHaveLength(1);
  });

  it("refuses an id that names nothing", async () => {
    expect(await refusalFrom(redactEntry("no-such-entry", "user:legal-ops", "reason"))).toMatch(
      /No AuditEntry found|not found/i,
    );
  });
});
