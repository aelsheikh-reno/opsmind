// lib/kernel/fx/repository.ts against a real engine (ADR-038): the exact
// decimal string a Decimal(20,10) column must return, the (base, quote, asOf)
// upsert operations-scheduling.md's daily refresh specifies, and that a
// snapshot is looked up by exact date with no nearest-date fallback invented
// here (CLAUDE.md rule 8).
//
// Added by the feature tester under the allowlist amendment recorded for
// kernel-registry-fx: tests/integration/kernel/ joined this node's produces
// list so the repository layer gets real-engine coverage the static sweep in
// tests/kernel/kernel-registry-fx.test.ts cannot provide on its own.
import { describe, expect, it } from "vitest";
import { integrationDatabase } from "../support/database";

await integrationDatabase("fx");
const { listRates, rateAsOf, recordRate } = await import("@/lib/kernel/fx");

const day = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

describe("recordRate and rateAsOf", () => {
  it("stores the rate as an exact decimal string, never a float", async () => {
    await recordRate({ base: "USD", quote: "AED", rate: "3.6725", asOf: day("2026-08-01") });
    const found = await rateAsOf("USD", "AED", day("2026-08-01"));
    // Prisma's Decimal.toString() trims trailing zeros rather than padding to
    // the column's declared scale, so the exact value round-trips without the
    // scale's own trailing zeros.
    expect(found?.rate).toBe("3.6725");
  });

  it("keeps full published precision at ten fractional digits", async () => {
    await recordRate({ base: "EGP", quote: "AED", rate: "0.0763412589", asOf: day("2026-08-02") });
    const found = await rateAsOf("EGP", "AED", day("2026-08-02"));
    expect(found?.rate).toBe("0.0763412589");
  });

  it("upserts by (base, quote, asOf) — a second fetch for the same day restates the row, never doubling it", async () => {
    await recordRate({ base: "USD", quote: "AED", rate: "3.6725", asOf: day("2026-08-03") });
    await recordRate({ base: "USD", quote: "AED", rate: "3.6730", asOf: day("2026-08-03") });
    expect(await listRates({ base: "USD", quote: "AED" })).toHaveLength(1);
    expect((await rateAsOf("USD", "AED", day("2026-08-03")))?.rate).toBe("3.673");
  });

  it("keeps distinct rows for distinct dates — a snapshot is never recomputed onto an earlier one", async () => {
    await recordRate({ base: "USD", quote: "AED", rate: "3.6725", asOf: day("2026-08-04") });
    await recordRate({ base: "USD", quote: "AED", rate: "3.6790", asOf: day("2026-08-05") });
    expect((await rateAsOf("USD", "AED", day("2026-08-04")))?.rate).toBe("3.6725");
    expect((await rateAsOf("USD", "AED", day("2026-08-05")))?.rate).toBe("3.679");
  });

  it("answers null for a date with no rate of its own — no nearest-date fallback", async () => {
    await recordRate({ base: "USD", quote: "AED", rate: "3.6725", asOf: day("2026-08-06") });
    // A Friday with no rate of its own, one day after a rate that does exist.
    expect(await rateAsOf("USD", "AED", day("2026-08-07"))).toBeNull();
  });

  it("answers null for a pair nobody has ever recorded", async () => {
    expect(await rateAsOf("KWD", "BHD", day("2026-08-01"))).toBeNull();
  });
});

describe("listRates", () => {
  it("orders by asOf descending", async () => {
    await recordRate({ base: "GBP", quote: "AED", rate: "4.6", asOf: day("2026-07-01") });
    await recordRate({ base: "GBP", quote: "AED", rate: "4.7", asOf: day("2026-07-03") });
    await recordRate({ base: "GBP", quote: "AED", rate: "4.65", asOf: day("2026-07-02") });
    expect((await listRates({ base: "GBP", quote: "AED" })).map((rate) => rate.rate)).toEqual([
      "4.7",
      "4.65",
      "4.6",
    ]);
  });

  it("narrows by base and by quote, independently", async () => {
    await recordRate({ base: "USD", quote: "SAR", rate: "3.75", asOf: day("2026-07-10") });
    await recordRate({ base: "USD", quote: "KWD", rate: "0.307", asOf: day("2026-07-10") });
    await recordRate({ base: "EUR", quote: "SAR", rate: "4.05", asOf: day("2026-07-10") });
    expect((await listRates({ base: "USD" })).map((rate) => rate.quote).sort()).toEqual(["KWD", "SAR"]);
    expect((await listRates({ quote: "SAR" })).map((rate) => rate.base).sort()).toEqual(["EUR", "USD"]);
  });
});
