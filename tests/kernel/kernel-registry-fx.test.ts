// The registry/FX/audit assertions of tasks/backlog.yaml#kernel-registry-fx:
//   1. "Document types carry field schema, retention policy and ingestion
//      rules as data"
//   2. "FX rates live in their own table with an asOf date; snapshots are
//      never recomputed"
//   3. "Audit entries are append-only; erasure redacts rather than deletes"
//
// Traced to: components-kernel.md rows 15 (Document Type Registry), 16 (FX)
// and 18 (Audit); data-model.md's DocumentType and FxRate cards;
// data-retention.md, whose "How it works" is what retentionDeadline() below
// computes; ADR-023 ("erasure = redaction, not deletion"); and
// operations-scheduling.md's FX refresh row ("Upsert by (base,quote,asOf)").
// The Prisma shapes themselves — column types, the (base, quote, asOf)
// unique key, the absence of a soft-delete flag on AuditEntry — are already
// pinned in tests/kernel/kernel-schema.test.ts; this file is about the
// lib/kernel/{registry,fx,audit} access layer this node adds on top of them.
//
// ASSERTION 1 IS ONLY PARTLY BUILDABLE HERE, AND THAT IS STATED RATHER THAN
// PAPERED OVER. components-kernel.md lists "the ingestion rule catalogue"
// alongside the field schema and the retention policy, but
// docs/architecture/open-items.md records IngestionRule as one of the tables
// with "no field-level shape" anywhere in the spec — "a task reaching any of
// these finds a name in one cell of the ownership map and nothing else."
// Inventing one here would be exactly what spec-coverage-audit exists to
// prevent, so this file tests the field schema and the retention policy and
// says nothing about ingestion rules; DocumentType.fields is what the parser
// reads today.
//
// WHAT THE REPOSITORY LAYER IS NOT TESTED AGAINST HERE. Each repository.ts
// reaches PostgreSQL, and this environment has none reachable from a plain
// `vitest run` — the same limit tests/kernel/kernel-repositories.test.ts
// documents for the six earlier kernel repositories. What is checkable
// without one: the public surface's shapes, the two pure functions the
// components expose (retentionDeadline, redact), and static sweeps of the
// repository source for the properties assertions 2 and 3 turn on — an
// upsert keyed on (base, quote, asOf) with no nearest-date fallback invented
// here, and the total absence of a delete call anywhere near AuditEntry. The
// real-engine coverage lives in tests/integration/kernel/{registry,fx,audit}
// .test.ts, added in this same node under an allowlist amendment, in the
// convention kernel-repository-integration-tests established for
// document/enrolment/jurisdiction/legal-entity/person/regime.
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  blankNonCode,
  dbUsages,
  kernelModules,
  kernelPublicTypeBlocks,
  ownsDeclaration,
  publicDeclarations,
  type KernelModule,
} from "./kernel-source";

function moduleNamed(name: string): KernelModule {
  const found = kernelModules().find((candidate) => candidate.name === name);
  if (found === undefined) {
    throw new Error(`no lib/kernel/${name} folder — tasks/backlog.yaml#kernel-registry-fx produces it`);
  }
  return found;
}

function repositoryOf(name: string) {
  const repository = moduleNamed(name).repository;
  if (repository === undefined) throw new Error(`lib/kernel/${name} has no repository.ts`);
  return repository;
}

function memberType(blockName: string, member: string): string {
  const blocks = kernelPublicTypeBlocks();
  const block = blocks.find((candidate) => candidate.name === blockName);
  if (block === undefined) {
    throw new Error(`no exported type ${blockName}. Found: ${blocks.map((b) => b.name).join(", ")}`);
  }
  const found = block.members.find((member_) => member_.name === member);
  if (found === undefined) {
    throw new Error(`${blockName} has no member '${member}'. Members: ${block.members.map((m) => m.name).join(", ")}`);
  }
  return found.type;
}

function unionValuesOf(name: string): string[] {
  const declaration = publicDeclarations(moduleNamed("registry")).find((candidate) => candidate.name === name);
  if (declaration === undefined) throw new Error(`no exported type alias ${name} on lib/kernel/registry`);
  return [...declaration.signature.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]).sort();
}

async function loadIndex(name: string): Promise<Record<string, unknown>> {
  const kernelModule = moduleNamed(name);
  if (kernelModule.index === undefined) throw new Error(`lib/kernel/${name} has no index.ts`);
  return (await import(
    /* @vite-ignore */ pathToFileURL(kernelModule.index.path).href
  )) as Record<string, unknown>;
}

// --------------------------------------------------------- assertion 1 · registry --

describe("DocumentType registry", () => {
  // components-kernel.md:15 — "Field schemas + the ingestion rule catalogue +
  // retention policy per type"; data-model.md:181-190.
  it("carries the field schema as data", () => {
    expect(memberType("DocumentType", "fields")).toMatch(/:\s*unknown/);
  });

  it("carries the retention policy: years, basis, legal hold and erasure mode", () => {
    expect(memberType("DocumentType", "retentionYears")).toMatch(/number/);
    expect(memberType("DocumentType", "retentionBasis")).toMatch(/RetentionBasis/);
    expect(memberType("DocumentType", "legalHold")).toMatch(/boolean/);
    expect(memberType("DocumentType", "erasureMode")).toMatch(/ErasureMode/);
  });

  it("is versioned with an actor and a timestamp, not a history table (data-retention.md)", () => {
    expect(memberType("DocumentType", "updatedAt")).toMatch(/Date/);
    expect(memberType("DocumentType", "updatedByUserId")).toMatch(/string \| null/);
  });

  it("closes RetentionBasis to exactly the three bases data-retention.md names", () => {
    expect(unionValuesOf("RetentionBasis")).toEqual([
      "document_date",
      "end_of_financial_year",
      "end_of_tax_period",
    ]);
  });

  it("closes ErasureMode to exactly the two values ADR-023 names", () => {
    expect(unionValuesOf("ErasureMode")).toEqual(["full_delete", "redact_personal"]);
  });

  it("declares only DocumentType as its owned table, and touches nothing else", () => {
    const repository = repositoryOf("registry");
    expect(ownsDeclaration(repository.source).tables.map((table) => table.toLowerCase())).toEqual([
      "documenttype",
    ]);
    expect(new Set(dbUsages(repository.source).map((usage) => usage.delegate))).toEqual(
      new Set(["documentType"]),
    );
  });
});

describe("retentionDeadline", () => {
  it("adds retentionYears to the basis date, as a civil date at UTC midnight", async () => {
    const { retentionDeadline } = (await loadIndex("registry")) as {
      retentionDeadline: (
        type: { retentionYears: number; legalHold: boolean },
        basisDate: Date,
      ) => Date | null;
    };
    const basis = new Date(Date.UTC(2026, 0, 31)); // 2026-01-31
    const deadline = retentionDeadline({ retentionYears: 7, legalHold: false }, basis);
    expect(deadline?.toISOString()).toBe(new Date(Date.UTC(2033, 0, 31)).toISOString());
  });

  it("returns null while legalHold blocks the purge, regardless of age", async () => {
    const { retentionDeadline } = (await loadIndex("registry")) as {
      retentionDeadline: (type: { retentionYears: number; legalHold: boolean }, basisDate: Date) => Date | null;
    };
    expect(retentionDeadline({ retentionYears: 5, legalHold: true }, new Date(Date.UTC(2020, 0, 1)))).toBeNull();
  });

  it("does not mutate the basis date it is given", async () => {
    const { retentionDeadline } = (await loadIndex("registry")) as {
      retentionDeadline: (type: { retentionYears: number; legalHold: boolean }, basisDate: Date) => Date | null;
    };
    const basis = new Date(Date.UTC(2020, 5, 15));
    const before = basis.getTime();
    retentionDeadline({ retentionYears: 3, legalHold: false }, basis);
    expect(basis.getTime()).toBe(before);
  });

  it("rolls a 29 February basis forward the way JavaScript's own Date does over a non-leap span", async () => {
    const { retentionDeadline } = (await loadIndex("registry")) as {
      retentionDeadline: (type: { retentionYears: number; legalHold: boolean }, basisDate: Date) => Date | null;
    };
    const leapDay = new Date(Date.UTC(2024, 1, 29)); // 2024 is a leap year
    const deadline = retentionDeadline({ retentionYears: 1, legalHold: false }, leapDay);
    expect(deadline?.toISOString()).toBe(new Date(Date.UTC(2025, 2, 1)).toISOString());
  });
});

// -------------------------------------------------------------- assertion 2 · fx --

describe("FxRate — the store", () => {
  // data-model.md:193-201, and components-kernel.md:16 — "Own table replaces
  // the JSON blob in Setting; adapter fetches, kernel writes."
  it("carries rate as an exact decimal string, never a JavaScript number", () => {
    expect(memberType("FxRate", "rate")).toMatch(/:\s*string/);
  });

  it("looks a rate up as of a date, never as of \"now\"", () => {
    expect(memberType("FxRate", "asOf")).toMatch(/Date/);
  });

  it("declares only FxRate as its owned table, and touches nothing else", () => {
    const repository = repositoryOf("fx");
    expect(ownsDeclaration(repository.source).tables.map((table) => table.toLowerCase())).toEqual([
      "fxrate",
    ]);
    expect(new Set(dbUsages(repository.source).map((usage) => usage.delegate))).toEqual(
      new Set(["fxRate"]),
    );
  });

  it("writes rates keyed on (base, quote, asOf) — the daily upsert operations-scheduling.md specifies", () => {
    const repository = repositoryOf("fx");
    expect(repository.source).toMatch(/base_quote_asOf/);
    expect(repository.source).toMatch(/\.upsert\(/);
  });

  it("looks a rate up by exact match, inventing no nearest-date fallback here (CLAUDE.md rule 8)", () => {
    // Which day's rate stands in for a weekend with none of its own is a
    // business decision this component does not make. A `findFirst` ordered
    // by `asOf` with a `lte`/`gte` filter would be exactly that decision,
    // made silently in a place nobody asked it to be.
    const code = blankNonCode(repositoryOf("fx").source);
    expect(code).not.toMatch(/findFirst|lte\s*:|gte\s*:/);
  });
});

// ---------------------------------------------------------- assertion 3 · audit --

describe("AuditEntry — the append-only log", () => {
  it("carries the actor copied rather than joined, and the applied retention snapshot", () => {
    expect(memberType("AuditEntry", "actorUserId")).toMatch(/string \| null/);
    expect(memberType("AuditEntry", "actorName")).toMatch(/string \| null/);
    expect(memberType("AuditEntry", "appliedRetentionYears")).toMatch(/number \| null/);
    expect(memberType("AuditEntry", "appliedRetentionBasis")).toMatch(/RetentionBasis \| null/);
    expect(memberType("AuditEntry", "appliedErasureMode")).toMatch(/ErasureMode \| null/);
  });

  it("carries a redaction as a recorded change, not a missing row", () => {
    expect(memberType("AuditEntry", "redactedAt")).toMatch(/Date \| null/);
    expect(memberType("AuditEntry", "redactedBy")).toMatch(/string \| null/);
    expect(memberType("AuditEntry", "redactionReason")).toMatch(/string \| null/);
  });

  it("declares only AuditEntry as its owned table, and touches nothing else", () => {
    const repository = repositoryOf("audit");
    expect(ownsDeclaration(repository.source).tables.map((table) => table.toLowerCase())).toEqual([
      "auditentry",
    ]);
    expect(new Set(dbUsages(repository.source).map((usage) => usage.delegate))).toEqual(
      new Set(["auditEntry"]),
    );
  });

  it("makes no delete call anywhere in the repository — erasure redacts, it never deletes", () => {
    // ADR-023, components-kernel.md:18 — "erasure = redaction, not deletion".
    // blankNonCode so a `.delete(` inside a comment could never satisfy this
    // the way an actual call could defeat it.
    const code = blankNonCode(repositoryOf("audit").source);
    expect(code).not.toMatch(/\.delete(Many)?\(/);
  });

  it("exposes recordEntry to append and redactEntry to redact, and no generic update", () => {
    const names = publicDeclarations(moduleNamed("audit")).map((declaration) => declaration.name);
    expect(names).toEqual(expect.arrayContaining(["recordEntry", "redactEntry", "redact"]));
    expect(names.some((name) => /^update/i.test(name))).toBe(false);
  });
});

describe("redact", () => {
  const entry = {
    id: "audit-1",
    createdAt: new Date(Date.UTC(2026, 0, 1)),
    action: "purge",
    entityType: "Document",
    entityId: "doc-1",
    entityLabel: "Acme lease renewal",
    details: { note: "contains a home address" },
    actorUserId: "user-42",
    actorName: "Jane Doe",
    appliedRetentionYears: 7,
    appliedRetentionBasis: "document_date",
    appliedErasureMode: "redact_personal",
    redactedAt: null,
    redactedBy: null,
    redactionReason: null,
  };

  it("clears exactly entityLabel, details and actorName, and records who and why", async () => {
    const { redact } = (await loadIndex("audit")) as {
      redact: (entry: unknown, by: string, reason: string, at?: Date) => Record<string, unknown>;
    };
    const at = new Date(Date.UTC(2026, 7, 20));
    const redacted = redact(entry, "user:legal-ops", "PDPL erasure request #9", at);
    expect(redacted).toEqual({
      ...entry,
      entityLabel: null,
      details: null,
      actorName: null,
      redactedAt: at,
      redactedBy: "user:legal-ops",
      redactionReason: "PDPL erasure request #9",
    });
  });

  it("does not touch actorUserId, so the entry stays attributable after redaction", async () => {
    const { redact } = (await loadIndex("audit")) as {
      redact: (entry: unknown, by: string, reason: string, at?: Date) => Record<string, unknown>;
    };
    const redacted = redact(entry, "user:legal-ops", "PDPL erasure request #9");
    expect(redacted.actorUserId).toBe("user-42");
  });

  it("leaves the applied-policy snapshot and the entity identity standing", async () => {
    const { redact } = (await loadIndex("audit")) as {
      redact: (entry: unknown, by: string, reason: string, at?: Date) => Record<string, unknown>;
    };
    const redacted = redact(entry, "user:legal-ops", "reason");
    expect(redacted.entityType).toBe("Document");
    expect(redacted.entityId).toBe("doc-1");
    expect(redacted.appliedRetentionYears).toBe(7);
    expect(redacted.appliedRetentionBasis).toBe("document_date");
    expect(redacted.appliedErasureMode).toBe("redact_personal");
  });

  it("defaults redactedAt to the moment it runs, when none is given", async () => {
    const { redact } = (await loadIndex("audit")) as {
      redact: (entry: unknown, by: string, reason: string, at?: Date) => { redactedAt: Date };
    };
    const before = Date.now();
    const redacted = redact(entry, "user:legal-ops", "reason");
    expect(redacted.redactedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(redacted.redactedAt.getTime()).toBeLessThanOrEqual(Date.now());
  });
});
