// owns: FxRate
import type { FxRate as FxRateRow } from "@prisma/client";
import { db } from "@/lib/db";
import type { FxRate, NewFxRate } from "./index";

// Decimal leaves the component as an exact string; see FxRate.rate.
const toFxRate = (row: FxRateRow): FxRate => ({ ...row, rate: row.rate.toString() });

/**
 * The rate for one pair on one exact date, or null when none was recorded for
 * it. There is deliberately no nearest-date fallback: which day's rate stands
 * in for a weekend or a holiday with no rate of its own is a business decision
 * this component does not make (CLAUDE.md rule 8) — a caller with no rate for
 * the date it needs gets told that plainly, rather than an unannounced
 * substitute it cannot see was substituted.
 */
export async function rateAsOf(base: string, quote: string, asOf: Date): Promise<FxRate | null> {
  const row = await db.fxRate.findUnique({ where: { base_quote_asOf: { base, quote, asOf } } });
  return row && toFxRate(row);
}

export async function listRates(
  filter: { base?: string; quote?: string } = {},
): Promise<FxRate[]> {
  const rows = await db.fxRate.findMany({ where: filter, orderBy: { asOf: "desc" } });
  return rows.map(toFxRate);
}

/**
 * Records one day's rate, keyed on the (base, quote, asOf) triple the schema
 * makes unique. operations-scheduling.md's daily refresh is specified as
 * "Upsert by (base,quote,asOf)": a provider that answers twice for the same
 * day restates the one row for it rather than creating a second snapshot that
 * would make "the rate as of that date" ambiguous.
 */
export async function recordRate(input: NewFxRate): Promise<FxRate> {
  const { base, quote, asOf, ...rest } = input;
  const row = await db.fxRate.upsert({
    where: { base_quote_asOf: { base, quote, asOf } },
    create: input,
    update: rest,
  });
  return toFxRate(row);
}
