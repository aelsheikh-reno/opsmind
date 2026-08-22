// FX — the rate store. One row per (base, quote, asOf) date, replacing the
// JSON blob the legacy build kept in Setting under fx_rates_cache
// (components-kernel.md). An adapter fetches a day's rates and this component
// writes them; a settlement or a payroll month then copies the rate it used
// onto its own row, so a processed period keeps its rate forever and is never
// recomputed from here (schema.prisma's note on FxRate).
//
// This component states the rate; multiplying it into an amount is the
// caller's job, computed with whatever decimal handling that module already
// owns — the same boundary Regime draws around the law it stores versus the
// tax a module computes with it. Nothing here rounds a currency amount, so
// nothing here can invent a rounding rule nobody has settled (CLAUDE.md
// working style — ask before inventing a business rule).

export interface FxRate {
  id: string;
  /** ISO-4217. `rate` is the number of `quote` units one `base` unit buys. */
  base: string;
  quote: string;
  /**
   * An exact decimal string at full published precision, never a JavaScript
   * number — a rate multiplies money, and a binary rounding error here lands
   * directly in an amount (CLAUDE.md, money and dates).
   */
  rate: string;
  /** The date the rate is FOR. Rates are looked up as of a date, never "now". */
  asOf: Date;
}

export type NewFxRate = Omit<FxRate, "id">;

export { listRates, rateAsOf, recordRate } from "./repository";
