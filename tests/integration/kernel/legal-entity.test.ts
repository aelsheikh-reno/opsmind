// lib/kernel/legal-entity/repository.ts against a real engine (ADR-038): all
// five exported functions, the name lookup that refuses to be fuzzy, the name
// ordering the list promises, and what a missing row answers.
import { beforeEach, describe, expect, it } from "vitest";
import { integrationDatabase, refusalFrom } from "../support/database";

const db = await integrationDatabase("legal-entity");
const { createLegalEntity, getLegalEntity, legalEntityByName, listLegalEntities, updateLegalEntity } =
  await import("@/lib/kernel/legal-entity");

describe("createLegalEntity and getLegalEntity", () => {
  it("stores the stated role and reads the entity back", async () => {
    const created = await createLegalEntity({
      name: "Reno Systems FZ-LLC",
      country: "AE",
      role: "self",
      currency: "AED",
    });
    expect(created).toEqual({
      id: expect.any(String),
      name: "Reno Systems FZ-LLC",
      country: "AE",
      currency: "AED",
      active: true,
      role: "self",
    });
    expect(await getLegalEntity(created.id)).toEqual(created);
  });

  it("defaults to active with no currency, and never to a role", async () => {
    const created = await createLegalEntity({ name: "Acme Trading LLC", country: "KW", role: "client" });
    expect(created.active).toBe(true);
    expect(created.currency).toBeNull();
  });

  it("answers null for an id that names nothing", async () => {
    expect(await getLegalEntity("no-such-entity")).toBeNull();
  });
});

describe("listLegalEntities", () => {
  beforeEach(async () => {
    await createLegalEntity({ name: "Zenith Consulting", country: "EG", role: "vendor" });
    await createLegalEntity({ name: "Acme Trading LLC", country: "KW", role: "client" });
    await createLegalEntity({ name: "Meridian Holdings", country: "BH", role: "client", active: false });
  });

  it("orders by name ascending", async () => {
    expect((await listLegalEntities()).map((entity) => entity.name)).toEqual([
      "Acme Trading LLC",
      "Meridian Holdings",
      "Zenith Consulting",
    ]);
  });

  it("narrows by role and by active, together", async () => {
    expect((await listLegalEntities({ role: "client" })).map((entity) => entity.name)).toEqual([
      "Acme Trading LLC",
      "Meridian Holdings",
    ]);
    expect((await listLegalEntities({ role: "client", active: true })).map((entity) => entity.name)).toEqual([
      "Acme Trading LLC",
    ]);
    expect(await listLegalEntities({ active: false })).toHaveLength(1);
  });
});

describe("legalEntityByName", () => {
  beforeEach(async () => {
    await createLegalEntity({ name: "Acme Trading LLC", country: "KW", role: "client" });
  });

  it("matches exactly, ignoring case", async () => {
    expect((await legalEntityByName("acme trading llc"))?.name).toBe("Acme Trading LLC");
    expect((await legalEntityByName("ACME TRADING LLC"))?.name).toBe("Acme Trading LLC");
  });

  it("answers null on a near miss rather than picking a candidate", async () => {
    // CLAUDE.md rule 8. A near match is a work item for a human, and the
    // previous build's fuzzy matching is what created one entity per spelling.
    expect(await legalEntityByName("Acme Trading")).toBeNull();
    expect(await legalEntityByName("Acme Trading L.L.C.")).toBeNull();
    expect(await legalEntityByName(" Acme Trading LLC")).toBeNull();
  });
});

describe("updateLegalEntity", () => {
  it("amends the row in place and leaves the rest alone", async () => {
    const created = await createLegalEntity({ name: "Acme Trading LLC", country: "KW", role: "client" });
    const updated = await updateLegalEntity(created.id, { active: false, currency: "KWD" });
    expect(updated).toEqual({ ...created, active: false, currency: "KWD" });
    expect(await db.legalEntity.count()).toBe(1);
  });

  it("refuses an id that names nothing, rather than creating one", async () => {
    expect(await refusalFrom(updateLegalEntity("no-such-entity", { active: false }))).toMatch(
      /[Rr]ecord to update not found|no-such-entity/,
    );
    expect(await listLegalEntities()).toEqual([]);
  });
});
