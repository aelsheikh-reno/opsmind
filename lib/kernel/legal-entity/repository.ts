// owns: LegalEntity
import type { LegalEntity as LegalEntityRow } from "@prisma/client";
import { db } from "@/lib/db";
import type { EntityRole, LegalEntity, NewLegalEntity } from "./index";

const toEntity = ({ id, name, country, currency, active, role }: LegalEntityRow): LegalEntity => ({
  id,
  name,
  country,
  currency,
  active,
  role,
});

export async function getLegalEntity(id: string): Promise<LegalEntity | null> {
  const row = await db.legalEntity.findUnique({ where: { id } });
  return row && toEntity(row);
}

export async function listLegalEntities(
  filter: { role?: EntityRole; active?: boolean } = {},
): Promise<LegalEntity[]> {
  const rows = await db.legalEntity.findMany({ where: filter, orderBy: { name: "asc" } });
  return rows.map(toEntity);
}

/**
 * An exact name match, case-insensitive, and nothing looser. Fuzzy matching is
 * how the previous build created a second entity for every spelling of a
 * client; a near miss returns null here so the caller raises a work item rather
 * than picking a candidate (CLAUDE.md rule 8). Ranking name similarity, where
 * it is wanted at all, belongs to ingestion with a human at the end of it.
 */
export async function legalEntityByName(name: string): Promise<LegalEntity | null> {
  const row = await db.legalEntity.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
  });
  return row && toEntity(row);
}

export async function createLegalEntity(input: NewLegalEntity): Promise<LegalEntity> {
  return toEntity(await db.legalEntity.create({ data: input }));
}

export async function updateLegalEntity(
  id: string,
  patch: Partial<NewLegalEntity>,
): Promise<LegalEntity> {
  return toEntity(await db.legalEntity.update({ where: { id }, data: patch }));
}
