import { prisma } from "@/lib/prisma";

// Parses the full-month salary from a pro-rated entry when no PaymentSchedule entry is found.
// Note format: "Pro-rated: X/30 days"
export function reverseProRata(salary: number, note: string | null): number {
  if (!note) return salary;
  const match = note.match(/Pro-rated: (\d+)\/30 days/);
  if (match) {
    const days = parseInt(match[1]);
    return Math.round((salary * 30) / days * 100) / 100;
  }
  return salary;
}

// Read-only lookup of the full-month salary that exit-month pro-ration should be based on —
// the same "previous month's payroll" rule syncPayrollForExit applies, exposed separately so
// UI previews (e.g. the exit modal) can show the real figure before a save actually happens,
// instead of falling back to the person's flat `salary` field.
export async function getExitMonthBaseSalary(
  personId: string,
  exitDate: Date,
): Promise<{ baseSalary: number; currency: string } | null> {
  const exitYear = exitDate.getFullYear();
  const exitMonth = exitDate.getMonth() + 1;
  const prevMonth = exitMonth === 1 ? 12 : exitMonth - 1;
  const prevYear = exitMonth === 1 ? exitYear - 1 : exitYear;

  const prevEntry = await prisma.payrollEntry.findFirst({
    where: { personId, payrollRun: { month: prevMonth, year: prevYear } },
    select: { salary: true, note: true, currency: true },
  });
  if (prevEntry) {
    return { baseSalary: reverseProRata(prevEntry.salary, prevEntry.note), currency: prevEntry.currency };
  }

  // No previous-month entry yet (e.g. exit date set in the employee's first month) —
  // fall back to the exit month's own entry, then to the contract's scheduled amount.
  const exitMonthEntry = await prisma.payrollEntry.findFirst({
    where: { personId, payrollRun: { month: exitMonth, year: exitYear } },
    select: { salary: true, note: true, currency: true },
  });
  if (exitMonthEntry) {
    return { baseSalary: reverseProRata(exitMonthEntry.salary, exitMonthEntry.note), currency: exitMonthEntry.currency };
  }

  const monthStart = new Date(exitYear, exitMonth - 1, 1);
  const monthEnd = new Date(exitYear, exitMonth, 1);
  const schedule = await prisma.paymentSchedule.findFirst({
    where: {
      document: { person: { id: personId }, docType: "employee_contract" },
      dueDate: { gte: monthStart, lt: monthEnd },
    },
    select: { amount: true, currency: true },
  });
  if (schedule) return { baseSalary: schedule.amount, currency: schedule.currency };

  return null;
}

// When exitDate is set or cleared, sync all unpaid payroll entries for this person:
//   - entries in the exit month → pro-rate to daysWorked/30, using the PREVIOUS month's
//     full payroll entry as the salary base (UAE Labour Law standard, ÷ 30 days) — the
//     previous month is a known full-month amount, avoiding double pro-rating any
//     mid-month adjustment already applied to the exit month itself.
//   - entries in months after exit → delete
//   - entries before exit that were previously pro-rated → restore full salary
//   - exit cleared → restore pro-rated entry + re-enroll in any open future runs
//
// This is the single source of truth for exit-month pro-ration — call it after any
// operation that writes payroll entries for a person with an exit date (contract
// generation/renewal, schedule sync, or the exit date being set directly) so the
// previous-month-based calculation is never overwritten by a naive current-month one.
export async function syncPayrollForExit(personId: string, newExitDate: Date | null) {
  const entries = await prisma.payrollEntry.findMany({
    where: { personId, isPaid: false },
    include: { payrollRun: { select: { id: true, month: true, year: true } } },
  });

  const affectedRunIds = new Set<string>();

  if (!newExitDate) {
    // ── Exit cleared (rehire) ──────────────────────────────────────────────────

    // 1. Restore any pro-rated entry to full salary
    for (const entry of entries) {
      if (entry.note?.startsWith("Pro-rated")) {
        const fullSalary = reverseProRata(entry.salary, entry.note);
        await prisma.payrollEntry.update({
          where: { id: entry.id },
          data: { salary: fullSalary, note: null },
        });
        affectedRunIds.add(entry.payrollRunId);
      }
    }

    // 2. Re-enroll in existing open runs for the current month and onwards
    //    where the person is missing but has a scheduled payment.
    const now = new Date();
    const nowPeriod = now.getFullYear() * 100 + (now.getMonth() + 1);
    const personRunIds = new Set(entries.map((e) => e.payrollRunId));
    const personRecord = await prisma.person.findUnique({
      where: { id: personId },
      select: { name: true },
    });

    const openRuns = await prisma.payrollRun.findMany({
      where: { isProcessed: false, month: { not: null }, year: { not: null } },
      select: { id: true, month: true, year: true, currency: true },
    });

    for (const run of openRuns) {
      const runPeriod = run.year! * 100 + run.month!;
      if (runPeriod < nowPeriod) continue;   // skip past months
      if (personRunIds.has(run.id)) continue; // already enrolled

      const monthStart = new Date(run.year!, run.month! - 1, 1);
      const monthEnd = new Date(run.year!, run.month!, 1);
      const schedule = await prisma.paymentSchedule.findFirst({
        where: {
          document: { person: { id: personId }, docType: "employee_contract" },
          dueDate: { gte: monthStart, lt: monthEnd },
        },
        select: { amount: true, currency: true },
      });
      if (!schedule) continue;

      await prisma.payrollEntry.create({
        data: {
          payrollRunId: run.id,
          personId,
          employeeName: personRecord!.name,
          salary: schedule.amount,
          currency: schedule.currency,
        },
      });
      affectedRunIds.add(run.id);
    }

    // Recalculate totals
    for (const runId of affectedRunIds) {
      const agg = await prisma.payrollEntry.aggregate({ where: { payrollRunId: runId }, _sum: { salary: true } });
      await prisma.payrollRun.update({ where: { id: runId }, data: { totalAmount: agg._sum.salary ?? 0 } });
    }
    return;
  }

  if (entries.length === 0) return;

  // ── Exit date set / changed ────────────────────────────────────────────────
  const exitYear = newExitDate.getFullYear();
  const exitMonth = newExitDate.getMonth() + 1;

  for (const entry of entries) {
    const runMonth = entry.payrollRun.month!;
    const runYear = entry.payrollRun.year!;
    const isAfterExit = runYear > exitYear || (runYear === exitYear && runMonth > exitMonth);
    const isExitMonth = runYear === exitYear && runMonth === exitMonth;

    if (isAfterExit) {
      await prisma.payrollEntry.delete({ where: { id: entry.id } });
      affectedRunIds.add(entry.payrollRunId);
    } else if (isExitMonth) {
      const daysWorked = newExitDate.getDate();
      // Use the previous month's payroll entry as the salary base.
      // The exit month entry may itself already be pro-rated (e.g. syncPayrollForContract
      // pro-rated it because contractEnd falls mid-month, or contract generation copied a
      // raw schedule amount), so reverting it only undoes one layer. The previous month is
      // a full-month amount with no such ambiguity.
      const prevMonth = runMonth === 1 ? 12 : runMonth - 1;
      const prevYear  = runMonth === 1 ? runYear - 1 : runYear;
      const prevEntry = await prisma.payrollEntry.findFirst({
        where: { personId, payrollRun: { month: prevMonth, year: prevYear } },
        select: { salary: true, note: true },
      });
      const fullSalary = prevEntry
        ? reverseProRata(prevEntry.salary, prevEntry.note)
        : reverseProRata(entry.salary, entry.note);
      const proRated = Math.round((fullSalary / 30) * daysWorked * 100) / 100;
      await prisma.payrollEntry.update({
        where: { id: entry.id },
        data: { salary: proRated, note: `Pro-rated: ${daysWorked}/30 days` },
      });
      affectedRunIds.add(entry.payrollRunId);
    } else if (entry.note?.startsWith("Pro-rated")) {
      // Exit moved to a later month — restore this entry to full salary
      const fullSalary = reverseProRata(entry.salary, entry.note);
      await prisma.payrollEntry.update({
        where: { id: entry.id },
        data: { salary: fullSalary, note: null },
      });
      affectedRunIds.add(entry.payrollRunId);
    }
  }

  // Recalculate totals for all affected runs
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
}
