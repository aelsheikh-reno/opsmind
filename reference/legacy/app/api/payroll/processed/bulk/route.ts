import { prisma } from "@/lib/prisma";
import { getUsdRates } from "@/lib/fx";
import { NextRequest, NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { requireWrite } from "@/lib/permissions";

async function getPayrollExpenseIds(month: number, year: number): Promise<string[]> {
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd   = new Date(year, month, 1);
  const expenses = await prisma.expense.findMany({
    where: {
      personId: { not: null },
      AND: [
        { OR: [{ claimStatus: null }, { claimStatus: "approved" }] },
        { OR: [
          { payrollMonth: month, payrollYear: year },
          {
            payrollMonth: null,
            OR: [
              { dueOn: { gte: monthStart, lt: monthEnd } },
              { asanaCreatedAt: { gte: monthStart, lt: monthEnd } },
            ],
          },
        ]},
      ],
    },
    select: { id: true },
  });
  return expenses.map(e => e.id);
}

// PATCH /api/payroll/processed/bulk  — mark multiple runs as processed in one shot
export async function PATCH(req: NextRequest) {
  const denied = await requireWrite("payroll");
  if (denied) return denied;

  const { runIds } = await req.json() as { runIds: string[] };
  if (!Array.isArray(runIds) || runIds.length === 0) {
    return NextResponse.json({ error: "runIds required" }, { status: 400 });
  }

  // Only operate on runs that are not already processed
  const runs = await prisma.payrollRun.findMany({
    where: { id: { in: runIds }, isProcessed: false },
    include: {
      entries: {
        include: { person: { select: { documentId: true } } },
      },
    },
  });

  if (runs.length === 0) return NextResponse.json({ processed: 0 });

  const now = new Date();
  const lockSetting = await prisma.setting.findUnique({ where: { key: "lockRateOnProcessing" } });
  const shouldLock = lockSetting ? lockSetting.value === "true" : true;
  const snapshot = shouldLock ? JSON.stringify(await getUsdRates()) : null;

  for (const run of runs) {
    await prisma.payrollRun.update({
      where: { id: run.id },
      data: { isProcessed: true, processedAt: now, fxRateSnapshot: snapshot },
    });

    await prisma.payrollEntry.updateMany({
      where: { payrollRunId: run.id },
      data: { isPaid: true },
    });

    if (run.month !== null && run.year !== null) {
      const monthStart = new Date(run.year, run.month - 1, 1);
      const monthEnd   = new Date(run.year, run.month, 1);

      for (const entry of run.entries) {
        if (entry.person?.documentId) {
          await prisma.paymentSchedule.updateMany({
            where: {
              documentId: entry.person.documentId,
              dueDate: { gte: monthStart, lt: monthEnd },
              isPaid: false,
            },
            data: { isPaid: true },
          });
        }
      }

      const expenseIds = await getPayrollExpenseIds(run.month, run.year);
      for (const id of expenseIds) {
        await prisma.expense.update({ where: { id }, data: { completed: true } });
      }
    }

    for (const entry of run.entries) {
      if (entry.personId) {
        await audit({
          action: "payroll.processed",
          entityType: "person",
          entityId: entry.personId,
          entityLabel: entry.employeeName,
          details: { period: run.period, salary: entry.salary, currency: entry.currency },
        });
      }
    }
  }

  return NextResponse.json({ processed: runs.length });
}
