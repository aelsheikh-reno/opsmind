// owns: Person, PersonEnrolment
import type { Person as PersonRow } from "@prisma/client";
import { db } from "@/lib/db";
import type { ObligationType } from "@/lib/kernel/regime";
import type { NewPerson, NewPersonEnrolment, Person, PersonEnrolment } from "./index";

const toPerson = (row: PersonRow): Person => ({ ...row, weeklyHours: row.weeklyHours.toString() });

export async function getPerson(id: string): Promise<Person | null> {
  const row = await db.person.findUnique({ where: { id } });
  return row && toPerson(row);
}

/** Everyone, or the direct reports of one manager — the org chart, one level. */
export async function listPeople(filter: { managerId?: string } = {}): Promise<Person[]> {
  const rows = await db.person.findMany({ where: filter, orderBy: { name: "asc" } });
  return rows.map(toPerson);
}

export async function createPerson(input: NewPerson): Promise<Person> {
  return toPerson(await db.person.create({ data: input }));
}

/** Amends the HR record — a promotion, a manager change, a leaving date. */
export async function updatePerson(id: string, patch: Partial<NewPerson>): Promise<Person> {
  return toPerson(await db.person.update({ where: { id }, data: patch }));
}

/**
 * A person's registrations, newest first, optionally narrowed to a jurisdiction
 * or an obligation — which is how payroll finds the social insurance number to
 * calculate against for the country it is running.
 *
 * Deliberately no "as at a date" filter: whether a registration whose activeTo
 * is the 31st still covers the 31st is a business rule no document in this
 * build states, and guessing an inclusive or exclusive bound would put an
 * off-by-one day into a statutory calculation. The dates are returned; the
 * question goes to Ahmed before anything filters on them.
 */
export async function listPersonEnrolments(
  personId: string,
  filter: { jurisdictionId?: string; obligationType?: ObligationType } = {},
): Promise<PersonEnrolment[]> {
  return db.personEnrolment.findMany({
    where: { personId, ...filter },
    orderBy: { activeFrom: "desc" },
  });
}

export async function recordPersonEnrolment(input: NewPersonEnrolment): Promise<PersonEnrolment> {
  return db.personEnrolment.create({ data: input });
}
