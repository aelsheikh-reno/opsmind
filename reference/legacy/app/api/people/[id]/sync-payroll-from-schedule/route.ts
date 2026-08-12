import { NextRequest, NextResponse } from "next/server";
import { requireWrite } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { syncPayrollForExit } from "@/lib/payrollExitSync";

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireWrite("payroll");
  if (denied) return denied;

  const { id } = await params;

  const person = await prisma.person.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      exitDate: true,
      document: { select: { id: true, docType: true } },
    },
  });

  if (!person) return NextResponse.json({ error: "Person not found" }, { status: 404 });
  if (!person.document || person.document.docType !== "employee_contract") {
    return NextResponse.json({ error: "No employee contract linked" }, { status: 400 });
  }

  const scheduleEntries = await prisma.paymentSchedule.findMany({
    where: { documentId: person.document.id, scheduleType: "salary" },
    orderBy: { dueDate: "asc" },
  });

  if (scheduleEntries.length === 0) {
    return NextResponse.json({ synced: 0, message: "No schedule entries found" });
  }

  const exitDate   = person.exitDate;
  const exitYear   = exitDate ? exitDate.getFullYear() : null;
  const exitMonth  = exitDate ? exitDate.getMonth() + 1 : null;

  const affectedRunIds = new Set<string>();
  let synced = 0;

  for (const entry of scheduleEntries) {
    const d     = entry.dueDate;
    const month = d.getMonth() + 1;
    const year  = d.getFullYear();

    // Skip months after the exit date — employee is no longer on payroll
    if (exitYear !== null && exitMonth !== null) {
      if (year > exitYear || (year === exitYear && month > exitMonth)) continue;
    }

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

    // Write the full schedule amount here — exit-month pro-ration is handled afterwards
    // by syncPayrollForExit, which bases it on the previous month's full payroll entry
    // rather than this month's own schedule amount.
    const targetSalary = entry.amount;
    const targetNote: string | null = null;

    const existing = await prisma.payrollEntry.findFirst({
      where: { payrollRunId: run.id, personId: id },
    });

    if (existing) {
      if (existing.isPaid) continue;

      const salaryDiff   = Math.abs(existing.salary - targetSalary) > 0.001;
      const currencyDiff = existing.currency !== entry.currency;
      const noteDiff     = (existing.note ?? null) !== targetNote;

      if (salaryDiff || currencyDiff || noteDiff) {
        await prisma.payrollEntry.update({
          where: { id: existing.id },
          data:  { salary: targetSalary, currency: entry.currency, note: targetNote },
        });
        synced++;
        affectedRunIds.add(run.id);
      }
    } else {
      await prisma.payrollEntry.create({
        data: {
          payrollRunId: run.id,
          personId:     id,
          employeeName: person.name,
          salary:       targetSalary,
          currency:     entry.currency,
          note:         targetNote,
        },
      });
      synced++;
      affectedRunIds.add(run.id);
    }
  }

  for (const runId of affectedRunIds) {
    const agg = await prisma.payrollEntry.aggregate({
      where: { payrollRunId: runId },
      _sum:  { salary: true },
    });
    await prisma.payrollRun.update({
      where: { id: runId },
      data:  { totalAmount: agg._sum.salary ?? 0 },
    });
  }

  if (person.exitDate) {
    await syncPayrollForExit(id, person.exitDate);
  }

  return NextResponse.json({ synced });
}
