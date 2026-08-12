/**
 * One-shot script to fix all existing payroll entries so they match the
 * per-month PaymentSchedule amounts defined in each person's employee contract.
 *
 * This fixes the bug where payroll entries were created/overwritten at the
 * flat basic salary instead of the per-month schedule amounts.
 *
 * Safe to run multiple times — it only updates entries where the amount differs
 * and skips processed (paid) payroll runs.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." node scripts/sync-payroll-from-schedule.mjs
 *   DATABASE_URL="postgresql://..." node scripts/sync-payroll-from-schedule.mjs --dry-run
 */

import { PrismaClient } from "@prisma/client";

const DRY_RUN = process.argv.includes("--dry-run");
const prisma = new PrismaClient();

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

async function main() {
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}\n`);

  const persons = await prisma.person.findMany({
    where: {
      document: {
        docType: "employee_contract",
        paymentSchedules: { some: {} },
      },
    },
    select: {
      id: true,
      name: true,
      document: {
        select: {
          paymentSchedules: {
            orderBy: { dueDate: "asc" },
            select: { dueDate: true, amount: true, currency: true },
          },
        },
      },
    },
  });

  console.log(`Found ${persons.length} person(s) with a PaymentSchedule.\n`);

  let totalCreated = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;

  for (const person of persons) {
    const schedule = person.document?.paymentSchedules ?? [];
    if (schedule.length === 0) continue;

    console.log(`→ ${person.name} (${schedule.length} schedule entries)`);

    const affectedRunIds = new Set();

    for (const entry of schedule) {
      const d = entry.dueDate;
      const month = d.getMonth() + 1;
      const year  = d.getFullYear();
      const label = `${MONTHS[month - 1]} ${year}`;

      let run = await prisma.payrollRun.findFirst({ where: { month, year } });
      if (!run) {
        if (!DRY_RUN) {
          run = await prisma.payrollRun.create({
            data: { period: `${MONTHS[month - 1]} ${year}`, month, year, totalAmount: null, currency: entry.currency },
          });
        }
        console.log(`  [${label}] PayrollRun missing${DRY_RUN ? " (would create)" : " — created"}`);
      }

      if (run?.isProcessed) {
        console.log(`  [${label}] SKIPPED (run is processed/paid)`);
        totalSkipped++;
        continue;
      }

      const existing = run ? await prisma.payrollEntry.findFirst({
        where: { payrollRunId: run.id, personId: person.id },
      }) : null;

      if (existing) {
        const amountDiffers = Math.abs(existing.salary - entry.amount) > 0.001;
        const currencyDiffers = existing.currency !== entry.currency;
        if (amountDiffers || currencyDiffers) {
          console.log(`  [${label}] UPDATE ${existing.currency} ${existing.salary} → ${entry.currency} ${entry.amount}`);
          if (!DRY_RUN) {
            await prisma.payrollEntry.update({
              where: { id: existing.id },
              data: { salary: entry.amount, currency: entry.currency },
            });
            affectedRunIds.add(run.id);
          }
          totalUpdated++;
        } else {
          totalSkipped++;
        }
      } else if (run) {
        console.log(`  [${label}] CREATE ${entry.currency} ${entry.amount}`);
        if (!DRY_RUN) {
          await prisma.payrollEntry.create({
            data: {
              payrollRunId: run.id,
              personId:     person.id,
              employeeName: person.name,
              salary:       entry.amount,
              currency:     entry.currency,
            },
          });
          affectedRunIds.add(run.id);
        }
        totalCreated++;
      }
    }

    // Recompute run totals
    if (!DRY_RUN) {
      for (const runId of affectedRunIds) {
        const agg = await prisma.payrollEntry.aggregate({ where: { payrollRunId: runId }, _sum: { salary: true } });
        await prisma.payrollRun.update({ where: { id: runId }, data: { totalAmount: agg._sum.salary ?? 0 } });
      }
    }
  }

  console.log(`\nDone.`);
  console.log(`  Created: ${totalCreated}`);
  console.log(`  Updated: ${totalUpdated}`);
  console.log(`  Skipped: ${totalSkipped}`);
  if (DRY_RUN) console.log(`\nRun without --dry-run to apply changes.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
