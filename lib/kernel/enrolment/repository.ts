// owns: JurisdictionEnrolment
import { db } from "@/lib/db";
import type { JurisdictionEnrolment, NewJurisdictionEnrolment } from "./index";

/** The one registration an entity has under a regime; the pair is unique. */
export async function enrolmentFor(
  legalEntityId: string,
  regimeId: string,
): Promise<JurisdictionEnrolment | null> {
  return db.jurisdictionEnrolment.findUnique({
    where: { legalEntityId_regimeId: { legalEntityId, regimeId } },
  });
}

export async function listEnrolments(
  filter: { legalEntityId?: string; regimeId?: string } = {},
): Promise<JurisdictionEnrolment[]> {
  return db.jurisdictionEnrolment.findMany({ where: filter, orderBy: { activeFrom: "desc" } });
}

/**
 * Records a registration, keyed on the (entity, regime) pair the schema makes
 * unique — so importing the same VAT certificate twice restates one row rather
 * than creating a second registration nobody can tell apart from the first.
 */
export async function recordEnrolment(
  input: NewJurisdictionEnrolment,
): Promise<JurisdictionEnrolment> {
  const { legalEntityId, regimeId, ...rest } = input;
  return db.jurisdictionEnrolment.upsert({
    where: { legalEntityId_regimeId: { legalEntityId, regimeId } },
    create: input,
    update: rest,
  });
}
