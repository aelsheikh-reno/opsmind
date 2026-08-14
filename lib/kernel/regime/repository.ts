// owns: Regime
//
// The one file in this component that reaches the database (CLAUDE.md rule 3),
// and it reaches it through the single client in lib/db.ts rather than building
// one of its own — seven components each with a pool is a failure that only
// appears under load (data-ownership.md).
import { Prisma } from "@prisma/client";
import type { Regime as RegimeRow } from "@prisma/client";
import { db } from "@/lib/db";
import type { NewRegime, ObligationType, Regime } from "./index";

// Decimal leaves the component as an exact string; see Regime.rate.
const toRegime = (row: RegimeRow): Regime => ({ ...row, rate: row.rate.toString() });

// Prisma distinguishes "leave this column alone" from "write SQL NULL", and a
// bare null means neither. DbNull is the JSON column's null.
const json = (value: unknown) =>
  value === null || value === undefined ? Prisma.DbNull : (value as Prisma.InputJsonValue);

export async function getRegime(id: string): Promise<Regime | null> {
  const row = await db.regime.findUnique({ where: { id } });
  return row && toRegime(row);
}

/**
 * Regimes matching a filter. There is deliberately no "the regime for this
 * jurisdiction and obligation" singular: the schema indexes that pair but does
 * not make it unique, so two rows can exist and picking one of them would be
 * guessing which law applies (CLAUDE.md rule 8). A caller that finds two has a
 * data problem a human has to settle.
 */
export async function listRegimes(
  filter: { jurisdictionId?: string; obligationType?: ObligationType } = {},
): Promise<Regime[]> {
  const rows = await db.regime.findMany({ where: filter, orderBy: { name: "asc" } });
  return rows.map(toRegime);
}

export async function createRegime(input: NewRegime): Promise<Regime> {
  const { thresholds, brackets, ...rest } = input;
  const row = await db.regime.create({
    data: { ...rest, thresholds: json(thresholds), brackets: json(brackets) },
  });
  return toRegime(row);
}

/** Amends a regime in place — a rate corrected, a deadline restated. */
export async function updateRegime(id: string, patch: Partial<NewRegime>): Promise<Regime> {
  const { thresholds, brackets, ...rest } = patch;
  const row = await db.regime.update({
    where: { id },
    data: {
      ...rest,
      ...("thresholds" in patch ? { thresholds: json(thresholds) } : {}),
      ...("brackets" in patch ? { brackets: json(brackets) } : {}),
    },
  });
  return toRegime(row);
}
