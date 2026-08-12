import { NextResponse } from "next/server";
import { requireWrite } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

export async function POST() {
  const denied = await requireWrite("payroll");
  if (denied) return denied;

  // Find all persons linked to an employee_contract that has a PaymentSchedule
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
          id: true,
          paymentSchedules: {
            orderBy: { dueDate: "asc" },
            select: { dueDate: true, amount: true, currency: true },
          },
        },
      },
    },
  });

  let totalSynced = 0;
  let personsUpdated = 0;

  for (const person of persons) {
    const schedule = person.document?.paymentSchedules ?? [];
    if (schedule.length === 0) continue;

    const affectedRunIds = new Set<string>();
    let synced = 0;

    for (const entry of schedule) {
      const d = entry.dueDate;
      const month = d.getMonth() + 1;
      const year  = d.getFullYear();

      let run = await prisma.payrollRun.findFirst({ where: { month, year } });
      if (!run) {
        run = await prisma.payrollRun.create({
          data: {
            period:      `${MONTHS[month - 1]} ${year}`,
            month,
            year,
            totalAmount: null,
            currency:    entry.currency,
          },
        });
      }

      if (run.isProcessed) continue;

      const existing = await prisma.payrollEntry.findFirst({
        where: { payrollRunId: run.id, personId: person.id },
      });

      if (existing) {
        if (Math.abs(existing.salary - entry.amount) > 0.001 || existing.currency !== entry.currency) {
          await prisma.payrollEntry.update({
            where: { id: existing.id },
            data: { salary: entry.amount, currency: entry.currency },
          });
          synced++;
          affectedRunIds.add(run.id);
        }
      } else {
        await prisma.payrollEntry.create({
          data: {
            payrollRunId: run.id,
            personId:     person.id,
            employeeName: person.name,
            salary:       entry.amount,
            currency:     entry.currency,
          },
        });
        synced++;
        affectedRunIds.add(run.id);
      }
    }

    for (const runId of affectedRunIds) {
      const agg = await prisma.payrollEntry.aggregate({
        where: { payrollRunId: runId },
        _sum: { salary: true },
      });
      await prisma.payrollRun.update({
        where: { id: runId },
        data: { totalAmount: agg._sum.salary ?? 0 },
      });
    }

    if (synced > 0) {
      totalSynced += synced;
      personsUpdated++;
    }
  }

  return NextResponse.json({ personsUpdated, totalSynced });
}
