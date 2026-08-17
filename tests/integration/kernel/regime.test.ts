// lib/kernel/regime/repository.ts against a real engine (ADR-038): all four
// exported functions, the exact-string rate, the two JSON columns and the
// difference between leaving one alone and writing SQL NULL to it.
import { beforeEach, describe, expect, it } from "vitest";
import { integrationDatabase, refusalFrom } from "../support/database";

const db = await integrationDatabase("regime");
const { createRegime, getRegime, listRegimes, updateRegime } = await import("@/lib/kernel/regime");

const UAE_VAT = {
  obligationType: "vat",
  name: "UAE VAT",
  rate: "0.05",
  deadlineDays: 28,
  thresholds: { registration: 375000, voluntary: 187500 },
  brackets: null,
} as const;

describe("createRegime and getRegime", () => {
  let jurisdictionId = "";

  beforeEach(async () => {
    jurisdictionId = (await db.jurisdiction.create({ data: { code: "AE", name: "United Arab Emirates" } })).id;
  });

  it("stores the law as data, with the rate as an exact string", async () => {
    const regime = await createRegime({ ...UAE_VAT, jurisdictionId });
    // toMatchObject, not toEqual: toRegime spreads the row, so the returned
    // object also carries createdAt, which the Regime interface does not name.
    expect(regime).toMatchObject({
      id: expect.any(String),
      jurisdictionId,
      obligationType: "vat",
      name: "UAE VAT",
      rate: "0.05",
      deadlineDays: 28,
      thresholds: { registration: 375000, voluntary: 187500 },
      brackets: null,
    });
    expect(await getRegime(regime.id)).toEqual(regime);
  });

  it("keeps a rate at full published precision", async () => {
    // Decimal(9,6). A rate multiplies money, so a rounded one lands in an
    // amount.
    const regime = await createRegime({ ...UAE_VAT, jurisdictionId, rate: "0.142857" });
    expect((await getRegime(regime.id))?.rate).toBe("0.142857");
  });

  it("round-trips banded rates through the brackets column", async () => {
    const brackets = [
      { upTo: 15000, rate: "0" },
      { upTo: 30000, rate: "0.025" },
      { upTo: null, rate: "0.10" },
    ];
    const regime = await createRegime({
      jurisdictionId,
      obligationType: "corporate_tax",
      name: "Egyptian income tax",
      rate: "0",
      deadlineDays: 120,
      thresholds: null,
      brackets,
    });
    expect((await getRegime(regime.id))?.brackets).toEqual(brackets);
    expect((await getRegime(regime.id))?.thresholds).toBeNull();
  });

  it("answers null for an id that names nothing", async () => {
    expect(await getRegime("no-such-regime")).toBeNull();
  });

  it("refuses a jurisdiction that does not exist", async () => {
    expect(
      await refusalFrom(createRegime({ ...UAE_VAT, jurisdictionId: "no-such-jurisdiction" })),
    ).toMatch(/[Ff]oreign key/);
    expect(await listRegimes()).toEqual([]);
  });
});

describe("listRegimes", () => {
  let uaeId = "";
  let egyptId = "";

  beforeEach(async () => {
    uaeId = (await db.jurisdiction.create({ data: { code: "AE", name: "United Arab Emirates" } })).id;
    egyptId = (await db.jurisdiction.create({ data: { code: "EG", name: "Egypt" } })).id;
    await createRegime({ ...UAE_VAT, jurisdictionId: uaeId });
    await createRegime({
      ...UAE_VAT,
      jurisdictionId: uaeId,
      obligationType: "corporate_tax",
      name: "UAE corporate tax",
      rate: "0.09",
      deadlineDays: 270,
    });
    await createRegime({
      ...UAE_VAT,
      jurisdictionId: egyptId,
      name: "Egyptian VAT",
      rate: "0.14",
      deadlineDays: 60,
    });
  });

  it("orders by name ascending", async () => {
    expect((await listRegimes()).map((regime) => regime.name)).toEqual([
      "Egyptian VAT",
      "UAE VAT",
      "UAE corporate tax",
    ]);
  });

  it("narrows by jurisdiction and by obligation, together", async () => {
    expect((await listRegimes({ jurisdictionId: uaeId })).map((regime) => regime.name)).toEqual([
      "UAE VAT",
      "UAE corporate tax",
    ]);
    expect((await listRegimes({ obligationType: "vat" })).map((regime) => regime.name)).toEqual([
      "Egyptian VAT",
      "UAE VAT",
    ]);
    expect(
      (await listRegimes({ jurisdictionId: uaeId, obligationType: "corporate_tax" })).map(
        (regime) => regime.rate,
      ),
    ).toEqual(["0.09"]);
    expect(await listRegimes({ jurisdictionId: egyptId, obligationType: "social_insurance" })).toEqual([]);
  });
});

describe("updateRegime", () => {
  let regimeId = "";

  beforeEach(async () => {
    const jurisdictionId = (
      await db.jurisdiction.create({ data: { code: "AE", name: "United Arab Emirates" } })
    ).id;
    regimeId = (await createRegime({ ...UAE_VAT, jurisdictionId })).id;
  });

  it("amends a rate in place without touching the thresholds", async () => {
    const updated = await updateRegime(regimeId, { rate: "0.055", deadlineDays: 30 });
    expect(updated.rate).toBe("0.055");
    expect(updated.deadlineDays).toBe(30);
    expect(updated.thresholds).toEqual({ registration: 375000, voluntary: 187500 });
  });

  it("writes SQL NULL only when the patch names the column", async () => {
    // Prisma distinguishes "leave this column alone" from "write NULL", and a
    // bare null means neither — which is what the DbNull mapping is for.
    const cleared = await updateRegime(regimeId, { thresholds: null });
    expect(cleared.thresholds).toBeNull();
    expect(cleared.rate).toBe("0.05");
    const renamed = await updateRegime(regimeId, { name: "UAE VAT (2026)" });
    expect(renamed.thresholds).toBeNull();
    expect(renamed.name).toBe("UAE VAT (2026)");
  });

  it("replaces the brackets when the patch carries them", async () => {
    const updated = await updateRegime(regimeId, { brackets: [{ upTo: null, rate: "0.05" }] });
    expect(updated.brackets).toEqual([{ upTo: null, rate: "0.05" }]);
  });

  it("refuses an id that names nothing, rather than creating one", async () => {
    expect(await refusalFrom(updateRegime("no-such-regime", { rate: "0.20" }))).toMatch(
      /[Rr]ecord to update not found|no-such-regime/,
    );
    expect(await listRegimes()).toHaveLength(1);
  });
});
