// Person — staff identity: HR record, payroll subject, claimant and project
// resource in one row. Deliberately not split per role (components-kernel.md):
// it is among the most referenced tables, and separating the roles would
// migrate half the schema to solve a problem that is not constraining delivery.
//
// Compensation is not here. Salary is effective-dated on SalaryTerm, owned by
// Payroll (ADR-022), so a raise never rewrites a month already paid; the hourly
// rates arrive the same way with kernel-rate-terms.
//
// This component also owns PersonEnrolment — the person's OWN registrations,
// the social insurance number in Egypt, the tax identifier in the UAE. They are
// rows rather than columns because one person can be registered in several
// jurisdictions at once, and a registration ends without the person leaving.
import type { ObligationType } from "@/lib/kernel/regime";

export interface Person {
  id: string;
  name: string;
  email: string | null;
  jobTitle: string | null;
  department: string | null;
  nationality: string | null;
  /**
   * The org chart. Required to resolve who approves what (components-kernel.md)
   * and null at the top of the chart, where there is nobody to report to.
   */
  managerId: string | null;
  contractStart: Date | null;
  contractEnd: Date | null;
  exitDate: Date | null;
  exitReason: string | null;
  /** "fulltime" | "parttime", carried from the legacy shape. */
  employmentType: string;
  /** An exact decimal string: contractual hours divide pay, and a float does not divide the way a contract does. */
  weeklyHours: string;
  payslipInContractCurrency: boolean;
  /** The employment contract, as evidence — the person is the record (rule 7). */
  documentId: string | null;
}

/**
 * A person's registration in one jurisdiction: the identifier, and the dates it
 * is valid between. Per jurisdiction and per obligation, because an employee
 * who moves between the UAE and Egypt holds both at once.
 */
export interface PersonEnrolment {
  id: string;
  personId: string;
  jurisdictionId: string;
  obligationType: ObligationType;
  /** The number itself — social insurance number, tax number. */
  identifier: string;
  activeFrom: Date;
  /** null means still registered. */
  activeTo: Date | null;
}

/** A name is required; everything else is filled in as HR learns it. */
export type NewPerson = Pick<Person, "name"> & Partial<Omit<Person, "id" | "name">>;
export type NewPersonEnrolment = Omit<PersonEnrolment, "id" | "activeTo"> &
  Partial<Pick<PersonEnrolment, "activeTo">>;

/**
 * The managers above a person, nearest first, read out of `managerId`.
 *
 * That chain is what the org chart is for — components-kernel.md calls it
 * "required to resolve approvers" — but WHICH manager approves WHAT is a policy
 * question owned by Authorization and by the approving module. This answers
 * only who is above whom.
 *
 * A cycle throws. The schema notes that a chain must not loop is an application
 * rule no column can state, and a chart that loops is wrong in a way an
 * approver lookup must not paper over by stopping quietly at an arbitrary point
 * (CLAUDE.md rule 8). A manager missing from `people` ends the chain instead: a
 * caller that passed a partial list gets a partial answer, which is not the
 * same defect as a cyclic chart.
 */
export function managerChain(people: Iterable<Person>, personId: string): Person[] {
  const byId = new Map<string, Person>([...people].map((person) => [person.id, person]));
  const chain: Person[] = [];
  const seen = new Set<string>([personId]);
  let next = byId.get(personId)?.managerId ?? null;
  while (next !== null) {
    if (seen.has(next)) {
      throw new Error(`The manager chain from ${personId} loops back to ${next}; the org chart is cyclic.`);
    }
    seen.add(next);
    const manager = byId.get(next);
    if (manager === undefined) break;
    chain.push(manager);
    next = manager.managerId;
  }
  return chain;
}

export {
  createPerson,
  getPerson,
  listPeople,
  listPersonEnrolments,
  recordPersonEnrolment,
  updatePerson,
} from "./repository";
