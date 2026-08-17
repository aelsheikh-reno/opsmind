// owns: DeadlineRegistration, ThresholdTable
//
// The only file in this module that reaches the database, and it touches those
// two tables only (CLAUDE.md rules 1 and 3). Calendars, regimes and documents
// belong to the Kernel: they arrive through the CalendarSource port on
// DeadlineDeps rather than through a join, which is what lets this module's
// tables move to their own store later (ADR-021).
//
// The client is imported, never constructed. `lib/db.ts` holds the single
// PrismaClient and therefore the single connection pool; a repository that
// built its own would give this module a pool of its own, and seven modules
// doing that is seven pools against a database sized for one application.
// Every module's repository copies this line.
import { db } from "@/lib/db";

import type { DeadlineInput, DeadlineRef, DeadlineStore } from "./index";

export const prismaDeadlineStore: DeadlineStore = {
  // Idempotent by fingerprint: re-registering a deadline whose date moved
  // updates the row rather than creating a second identity for one fact.
  upsertRegistration(input: DeadlineInput) {
    const { entityType, entityId, deadlineType, ...rest } = input;
    const where = { entityType_entityId_deadlineType: { entityType, entityId, deadlineType } };
    return db.deadlineRegistration.upsert({ where, create: input, update: rest });
  },

  async deleteRegistration(ref: DeadlineRef) {
    // deleteMany, not delete: deregistering something already gone is not an
    // error, and no state is kept about what was once watched.
    await db.deadlineRegistration.deleteMany({ where: ref });
  },

  // The whole set, every run. The report has to be complete or absence from it
  // would resolve alerts the run never looked at.
  listRegistrations() {
    return db.deadlineRegistration.findMany({ orderBy: { dueDate: "asc" } });
  },

  listThresholds() {
    return db.thresholdTable.findMany({ orderBy: { businessDaysBefore: "asc" } });
  },
};
