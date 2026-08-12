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

// PATCH /api/payroll/processed?runId=xxx  — mark a run as processed and auto-pay matching schedule entries
export async function PATCH(req: NextRequest) {
  const denied = await requireWrite("payroll");
  if (denied) return denied;

  const runId = req.nextUrl.searchParams.get("runId");
  if (!runId) return NextResponse.json({ error: "runId required" }, { status: 400 });

  const run = await prisma.payrollRun.findUnique({
    where: { id: runId },
    include: {
      entries: {
        include: { person: { select: { documentId: true } } },
      },
    },
  });

  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const action = req.nextUrl.searchParams.get("action") ?? "mark";

  if (action === "unmark") {
    await prisma.payrollRun.update({
      where: { id: runId },
      data: { isProcessed: false, processedAt: null, fxRateSnapshot: null },
    });
    await prisma.payrollEntry.updateMany({ where: { payrollRunId: runId }, data: { isPaid: false } });

    if (run.month !== null && run.year !== null) {
      const ids = await getPayrollExpenseIds(run.month, run.year);
      for (const id of ids) {
        await prisma.expense.update({ where: { id }, data: { completed: false } });
      }
    }

    for (const entry of run.entries) {
      if (entry.personId) await audit({ action: "payroll.unprocessed", entityType: "person", entityId: entry.personId, entityLabel: entry.employeeName, details: { period: run.period } });
    }
    return NextResponse.json({ success: true });
  }

  const now = new Date();
  const lockSetting = await prisma.setting.findUnique({ where: { key: "lockRateOnProcessing" } });
  const shouldLock = lockSetting ? lockSetting.value === "true" : true;

  const snapshot = shouldLock ? JSON.stringify(await getUsdRates()) : null;

  await prisma.payrollRun.update({
    where: { id: runId },
    data: { isProcessed: true, processedAt: now, fxRateSnapshot: snapshot },
  });

  await prisma.payrollEntry.updateMany({ where: { payrollRunId: runId }, data: { isPaid: true } });

  // Mark PaymentSchedule entries as paid for each employee's contract month
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

    // Mark each expense as completed via its ID (mirrors /api/expenses/[id]/status)
    const ids = await getPayrollExpenseIds(run.month, run.year);
    for (const id of ids) {
      await prisma.expense.update({ where: { id }, data: { completed: true } });
    }
  }

  for (const entry of run.entries) {
    if (entry.personId) await audit({ action: "payroll.processed", entityType: "person", entityId: entry.personId, entityLabel: entry.employeeName, details: { period: run.period, salary: entry.salary, currency: entry.currency } });
  }
  return NextResponse.json({ success: true });
}
